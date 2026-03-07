import { createSignal, createMemo, createEffect, onMount, onCleanup, For, Show } from 'solid-js'
import { createStore, reconcile } from 'solid-js/store'
import { makeEventListener } from '@solid-primitives/event-listener'
import { Title, Meta } from '@solidjs/meta'
import {
  getEvent,
  getSelectedParticipant,
  saveEvent,
  setSelectedParticipant,
  updateParticipantSlots,
} from './db'
import {
  queueEventSync,
  queueParticipantSync,
  requestSyncFlush,
} from './sync-write'
import { connectEventSocket, pullRemoteEvent } from './sync-live'
import Win95Field from './components/Win95Field'
import Win95Button from './components/Win95Button'
import Win95Dialog from './components/Win95Dialog'
import ErrorDialog from './components/ErrorDialog'
import AvailabilityLegend from './components/AvailabilityLegend'
import AvailabilityGrid from './components/AvailabilityGrid'
import StatusMiniCell from './components/StatusMiniCell'
import MineIcon from './icons/MineIcon'
import {
  type AppEvent,
  type SlotValue,
  type Participant,
  slotsPerDay,
  computeTimeSlots,
  formatDateLabel,
  flatToRecord,
  recordToFlat,
} from './types'

interface Props {
  eventId: string
}

type SummaryCell = { name: string; value: SlotValue; isCurrent: boolean }
type SummaryGroups = { yes: string[]; maybe: string[]; no: string[] }
type SummaryIntersectionTime = {
  day: string
  dk: string
  time: string
  ti: number
}
type SummaryIntersectionDate = {
  day: string
  dk: string
  times: SummaryIntersectionTime[]
}
type SummaryIntersection = {
  key: string
  allGroups: SummaryGroups
  score: number
  canAttend: number
  kind: 'best' | 'almost' | 'partial'
  dates: SummaryIntersectionDate[]
}
type SummarySplitRow = {
  key: string
  groups: SummaryGroups
  yesCount: number
  maybeCount: number
  noCount: number
  kind: 'best' | 'almost' | 'partial'
  slots: SummaryIntersectionTime[]
}

const SPLIT_ROWS_PREVIEW_COUNT = 10

export default function Grid(props: Props) {
  const [event, setEvent] = createSignal<AppEvent | null>(null)
  const [localReady, setLocalReady] = createSignal(false)
  const [loadError, setLoadError] = createSignal<'none' | 'not-found' | 'network'>('none')
  const [newParticipantName, setNewParticipantName] = createSignal('')

  const days = createMemo(() => {
    const ev = event()

    if (!ev) {
      return []
    }

    return ev.dates.map((ds) => ({ key: ds, label: formatDateLabel(ds) }))
  })

  const times = createMemo(() => {
    const ev = event()

    if (!ev) {
      return []
    }

    return computeTimeSlots(ev.timeRange)
  })

  const [myState, setMyState] = createStore<Record<string, number[]>>({})
  const [currentName, setCurrentName] = createSignal('')

  // Read-only slots for all other participants
  const others = createMemo(() => {
    const ev = event()

    if (!ev) return {}
    const cur = currentName()
    const spd = slotsPerDay(ev)
    const result: Record<string, Record<string, number[]>> = {}
    ev.participants.forEach((p) => {
      if (p.name === cur) {
        return
      }

      result[p.name] = flatToRecord(p.slots, ev.dates, spd)
    })

    return result
  })

  type ActiveModal = null | 'name-picker' | 'help' | 'confirm' | 'settings'
  const [activeModal, setActiveModal] = createSignal<ActiveModal>('name-picker')
  const [confirmDay, setConfirmDay] = createSignal('')
  const [confirmTime, setConfirmTime] = createSignal('')
  const [confirmCandidates, setConfirmCandidates] = createSignal<SummaryIntersectionTime[] | null>(
    null,
  )
  const [settingsEventName, setSettingsEventName] = createSignal('')
  const [settingsParticipantNames, setSettingsParticipantNames] = createSignal<string[]>([])
  const [settingsNewParticipantName, setSettingsNewParticipantName] = createSignal('')
  const [showAllSettingsParticipants, setShowAllSettingsParticipants] = createSignal(false)
  const [dialogError, setDialogError] = createSignal('')
  const [showAllSummaryRows, setShowAllSummaryRows] = createSignal(false)
  const [isDesktop, setIsDesktop] = createSignal(false)
  const [copyStatus, setCopyStatus] = createSignal('')

  let persistTimer: ReturnType<typeof setTimeout> | undefined
  let shareInputRef!: HTMLInputElement

  function goToLanding() {
    if (window.location.pathname !== '/') {
      window.history.pushState({}, '', '/')
      window.dispatchEvent(new PopStateEvent('popstate'))
    }
  }

  function addMinutes(hhmm: string, minutes: number) {
    const [h, m] = hhmm.split(':').map(Number)
    const total = h * 60 + m + minutes
    const wrapped = ((total % 1440) + 1440) % 1440
    const oh = Math.floor(wrapped / 60)
    const om = wrapped % 60

    return `${String(oh).padStart(2, '0')}:${String(om).padStart(2, '0')}`
  }

  function toUtcStamp(ds: string, hhmm: string) {
    const [y, m, d] = ds.split('-').map(Number)
    const [h, mm] = hhmm.split(':').map(Number)
    const dt = new Date(Date.UTC(y, m - 1, d, h, mm, 0))
    const stamp = dt.toISOString().replace(/[-:]/g, '')

    return stamp.slice(0, 15) + 'Z'
  }

  function icsEscape(text: string) {
    return text
      .replace(/\\/g, '\\\\')
      .replace(/\n/g, '\\n')
      .replace(/,/g, '\\,')
      .replace(/;/g, '\\;')
  }

  function eventLink() {
    return `${window.location.origin}/e/${props.eventId}`
  }

  // --- Logic ---
  const summaryIntersections = createMemo<SummaryIntersection[]>(() => {
    const ev = event()
    const d = days()
    const t = times()

    if (!ev || d.length === 0 || t.length === 0) {
      return []
    }

    const participantNames = [...ev.participants.map((p) => p.name)].sort((a, b) => {
      if (a === currentName()) {
        return -1
      }

      if (b === currentName()) {
        return 1
      }

      return 0
    })

    const dayOrder = new Map(ev.dates.map((dayKey, index) => [dayKey, index]))
    const intersections = new Map<
      string,
      {
        key: string
        allGroups: SummaryGroups
        score: number
        canAttend: number
        kind: 'best' | 'almost' | 'partial'
        times: SummaryIntersectionTime[]
      }
    >()

    d.forEach((day) => {
      t.forEach((slot, ti) => {
        const cells: SummaryCell[] = participantNames.map((name) => {
          const value =
            name === currentName()
              ? ((myState[day.key]?.[ti] ?? 0) as SlotValue)
              : ((others()[name]?.[day.key]?.[ti] ?? 0) as SlotValue)

          return {
            name,
            value,
            isCurrent: name === currentName(),
          }
        })
        const yesCount = cells.filter((cell) => cell.value === 1).length
        const maybeCount = cells.filter((cell) => cell.value === 2).length
        const canAttend = yesCount + maybeCount

        if (canAttend === 0) {
          return
        }

        const score = yesCount + maybeCount * 0.5
        const noCount = cells.length - canAttend
        const kind = noCount === 0 ? 'best' : noCount === 1 ? 'almost' : 'partial'
        const key = cells.map((cell) => String(cell.value)).join('')
        const allGroups: SummaryGroups = {
          yes: cells
            .filter((cell) => cell.value === 1)
            .map((cell) => (cell.isCurrent ? 'You' : cell.name)),
          maybe: cells
            .filter((cell) => cell.value === 2)
            .map((cell) => (cell.isCurrent ? 'You' : cell.name)),
          no: cells
            .filter((cell) => cell.value === 0)
            .map((cell) => (cell.isCurrent ? 'You' : cell.name)),
        }

        const existing = intersections.get(key)

        if (!existing) {
          intersections.set(key, {
            key,
            allGroups,
            score,
            canAttend,
            kind,
            times: [{ dk: day.key, ti, day: day.label, time: slot.label }],
          })

          return
        }

        existing.times.push({ dk: day.key, ti, day: day.label, time: slot.label })
      })
    })

    const entries: SummaryIntersection[] = [...intersections.values()].map((entry) => {
      const byDate = new Map<string, SummaryIntersectionDate>()
      entry.times.forEach((timeEntry) => {
        const dateGroup = byDate.get(timeEntry.dk)

        if (!dateGroup) {
          byDate.set(timeEntry.dk, {
            day: timeEntry.day,
            dk: timeEntry.dk,
            times: [timeEntry],
          })

          return
        }

        dateGroup.times.push(timeEntry)
      })

      const dates = [...byDate.values()]
        .sort((a, b) => {
          const aOrder = dayOrder.get(a.dk) ?? Number.MAX_SAFE_INTEGER
          const bOrder = dayOrder.get(b.dk) ?? Number.MAX_SAFE_INTEGER

          return aOrder - bOrder
        })
        .map((dateGroup) => ({
          ...dateGroup,
          times: [...dateGroup.times].sort((a, b) => a.ti - b.ti),
        }))

      return {
        key: entry.key,
        allGroups: entry.allGroups,
        score: entry.score,
        canAttend: entry.canAttend,
        kind: entry.kind,
        dates,
      }
    })

    const kindRank: Record<SummaryIntersection['kind'], number> = { best: 0, almost: 1, partial: 2 }

    entries.sort((a, b) => {
      if (kindRank[a.kind] !== kindRank[b.kind]) {
        return kindRank[a.kind] - kindRank[b.kind]
      }

      if (a.score !== b.score) {
        return b.score - a.score
      }

      if (a.canAttend !== b.canAttend) {
        return b.canAttend - a.canAttend
      }

      return b.dates.reduce((sum, day) => sum + day.times.length, 0) - a.dates.reduce((sum, day) => sum + day.times.length, 0)
    })

    return entries
  })
  const summarySplitRows = createMemo<SummarySplitRow[]>(() => {
    const intersections = summaryIntersections()
    const rows: SummarySplitRow[] = []

    intersections.forEach((intersection) => {
      const slots: SummaryIntersectionTime[] = []

      intersection.dates.forEach((dateGroup) => {
        dateGroup.times.forEach((timeEntry) => {
          slots.push(timeEntry)
        })
      })
      const first = slots[0]
      const groups = first ? peopleGroupsForSlot(first.dk, first.ti) : emptySummaryGroups()
      const yesCount = groups.yes.length
      const maybeCount = groups.maybe.length
      const noCount = groups.no.length

      rows.push({
        key: intersection.key,
        groups,
        yesCount,
        maybeCount,
        noCount,
        kind: intersection.kind,
        slots,
      })
    })

    return rows
  })
  const visibleSummarySplitRows = createMemo(() => {
    const all = summarySplitRows()

    if (showAllSummaryRows()) {
      return all
    }

    return all.slice(0, SPLIT_ROWS_PREVIEW_COUNT)
  })

  const participantsWithAvailability = createMemo(() => {
    const ev = event()

    if (!ev) {
      return 0
    }

    const spd = slotsPerDay(ev)

    return ev.participants.filter((p) => {
      if (p.name === currentName()) {
        return recordToFlat(myState, ev.dates, spd).some((v) => v > 0)
      }

      return p.slots.some((v) => v > 0)
    }).length
  })
  const canShowSuggestions = createMemo(() => participantsWithAvailability() >= 2)
  const suggestionsHelperText = createMemo(() => {
    const ev = event()
    const base = 'Suggestions update as people continue filling availability.'

    if (!ev) {
      return base
    }

    const pending = ev.participants
      .filter((participant) => {
        if (participant.name === currentName()) {
          return false
        }

        const hasUpdated = participant.updatedAt !== null
        const hasAnyAvailability = participant.slots.some((value) => value > 0)

        return !hasUpdated && !hasAnyAvailability
      })
      .map((participant) => participant.name)

    if (pending.length === 0) {
      return `${base} Everyone has seen the link you shared.`
    }

    return `${base} ${pending.join(', ')} haven't opened the link yet.`
  })

  function loadParticipantSlots(ev: AppEvent, name: string) {
    const spd = slotsPerDay(ev)
    const p = ev.participants.find((pp) => pp.name === name)

    if (p) {
      setMyState(reconcile(flatToRecord(p.slots, ev.dates, spd)))
    } else {
      const empty: Record<string, number[]> = {}
      ev.dates.forEach((ds) => {
        empty[ds] = new Array(spd).fill(0)
      })
      setMyState(reconcile(empty))
    }
  }

  function mergeRemoteIntoLocal(local: AppEvent, remote: AppEvent): AppEvent {
    const localByName = new Map(local.participants.map((p) => [p.name, p]))
    const mergedParticipants = remote.participants.map((rp) => {
      const lp = localByName.get(rp.name)

      if (!lp) {
        return rp
      }

      const lv = lp.version ?? 0
      const rv = rp.version ?? 0

      if (lv !== rv) {
        return lv > rv ? { ...rp, slots: lp.slots, updatedAt: lp.updatedAt, version: lv } : rp
      }
      const lu = lp.updatedAt ?? 0
      const ru = rp.updatedAt ?? 0

      return lu > ru ? { ...rp, slots: lp.slots, updatedAt: lp.updatedAt, version: lv } : rp
    })
    const mergedRemote: AppEvent = { ...remote, participants: mergedParticipants }

    return {
      ...mergedRemote,
      dates: local.dates,
      timeRange: local.timeRange,
      maxParticipants: local.maxParticipants,
    }
  }

  async function applyRemoteEvent(remote: AppEvent) {
    const local = event()

    if (!local) {
      setEvent(remote)
      const selected = currentName()

      if (selected && remote.participants.some((p) => p.name === selected)) {
        loadParticipantSlots(remote, selected)
      }
      void saveEvent(remote).catch(() => {})

      return
    }
    const next = mergeRemoteIntoLocal(local, remote)
    setEvent(next)
    const selected = currentName()

    if (selected && next.participants.some((p) => p.name === selected)) {
      loadParticipantSlots(next, selected)
    }
    void saveEvent(next).catch(() => {})
  }

  async function applyRemoteParticipantUpdate(
    eventId: string,
    participantName: string,
    slots: SlotValue[],
    updatedAt: number,
    version: number,
  ) {
    const ev = event()

    if (!ev || ev.id !== eventId) {
      return
    }

    const idx = ev.participants.findIndex((p) => p.name === participantName)

    if (idx === -1) {
      return
    }

    const currentVersion = ev.participants[idx].version ?? 0

    if (currentVersion > version) {
      return
    }

    const currentUpdated = ev.participants[idx].updatedAt ?? 0

    if (currentVersion === version && currentUpdated >= updatedAt) {
      return
    }

    const updated: AppEvent = {
      ...ev,
      participants: ev.participants.map((p, i) =>
        i === idx ? { ...p, slots, updatedAt, version } : p,
      ),
    }
    await saveEvent(updated)
    setEvent(updated)

    if (participantName === currentName()) {
      loadParticipantSlots(updated, participantName)
    }
  }

  async function persistCurrentSlots() {
    const ev = event()

    if (!ev || !currentName()) {
      return
    }

    const spd = slotsPerDay(ev)
    const flat = recordToFlat(myState, ev.dates, spd)
    const prevFlat = ev.participants.find((p) => p.name === currentName())?.slots ?? []

    if (
      prevFlat.length === flat.length &&
      prevFlat.every((value, index) => value === (flat[index] ?? 0))
    )

      return
    const updatedAt = Date.now()
    const prevVersion = ev.participants.find((p) => p.name === currentName())?.version ?? 0
    const nextVersion = prevVersion + 1
    await updateParticipantSlots(ev.id, currentName(), flat, updatedAt, nextVersion)
    setEvent({
      ...ev,
      participants: ev.participants.map((p) =>
        p.name === currentName() ? { ...p, slots: flat, updatedAt, version: nextVersion } : p,
      ),
    })
    await queueParticipantSync(ev.id, currentName(), flat, prevVersion, updatedAt)
    requestSyncFlush()
  }

  function schedulePersist() {
    clearTimeout(persistTimer)
    persistTimer = setTimeout(() => persistCurrentSlots(), 50)
  }

  function cycleCell(dk: string, ti: number) {
    if (isConfirmed()) {
      return
    }

    const prev = myState[dk]?.[ti] ?? 0
    const next = (prev + 1) % 3

    if (prev === next) {
      return
    }

    setMyState(dk, ti, next)

    if (navigator.vibrate) navigator.vibrate(10)
    schedulePersist()
  }

  function emptySummaryGroups(): SummaryGroups {
    return {
      yes: [],
      maybe: [],
      no: [],
    }
  }

  function peopleGroupsForSlot(dayKey: string, timeIndex: number): SummaryGroups {
    const ev = event()

    if (!ev) {
      return emptySummaryGroups()
    }

    const participantNames = [...ev.participants.map((p) => p.name)].sort((a, b) => {
      if (a === currentName()) {
        return -1
      }

      if (b === currentName()) {
        return 1
      }

      return a.localeCompare(b)
    })

    const groups = emptySummaryGroups()

    participantNames.forEach((name) => {
      const value =
        name === currentName()
          ? ((myState[dayKey]?.[timeIndex] ?? 0) as SlotValue)
          : ((others()[name]?.[dayKey]?.[timeIndex] ?? 0) as SlotValue)
      const displayName = name === currentName() ? 'You' : name

      if (value === 1) {
        groups.yes.push(displayName)

        return
      }

      if (value === 2) {
        groups.maybe.push(displayName)

        return
      }

      groups.no.push(displayName)
    })

    return groups
  }

  function statusNameGroups(groups: SummaryGroups) {
    return [
      { value: 1 as SlotValue, names: groups.yes },
      { value: 2 as SlotValue, names: groups.maybe },
      { value: 0 as SlotValue, names: groups.no },
    ].filter((group) => group.names.length > 0)
  }

  function timesByDayEntries(slots: SummaryIntersectionTime[]) {
    const timesByDay = new Map<string, string[]>()

    slots.forEach((slot) => {
      const existing = timesByDay.get(slot.day)

      if (existing) {
        existing.push(slot.time)

        return
      }

      timesByDay.set(slot.day, [slot.time])
    })

    return [...timesByDay.entries()]
  }

  function openConfirmFromSplitRow(row: SummarySplitRow) {
    const first = row.slots[0]

    setConfirmCandidates(row.slots)
    setConfirmDay(first?.day ?? days()[0]?.label ?? '')
    setConfirmTime(first?.time ?? times()[0]?.label ?? '')
    setActiveModal('confirm')
  }

  function openConfirm(day: string | null, time: string | null) {
    setConfirmCandidates(null)
    setConfirmDay(day ?? days()[0]?.label ?? '')
    setConfirmTime(time ?? times()[0]?.label ?? '')
    setActiveModal('confirm')
  }

  function doConfirm() {
    const ev = event()

    if (!ev) {
      return
    }

    const day = days().find((d) => d.label === confirmDay())
    const time = times().find((t) => t.label === confirmTime())

    if (!day || !time) {
      return
    }

    const updated: AppEvent = {
      ...ev,
      status: 'confirmed',
      confirmedSlot: {
        date: day.key,
        startTime: time.value,
        endTime: addMinutes(time.value, 30),
      },
    }
    void saveEvent(updated)
    void queueEventSync(updated)
    requestSyncFlush()
    setEvent(updated)
    setActiveModal(null)
  }

  function undoConfirmedTime() {
    const ev = event()

    if (!ev) {
      return
    }

    const updated: AppEvent = { ...ev, status: 'open', confirmedSlot: undefined }
    void saveEvent(updated)
    void queueEventSync(updated)
    requestSyncFlush()
    setEvent(updated)
  }

  function revealSharePanel() {
    setCopyStatus('')
    queueMicrotask(() => {
      shareInputRef?.focus()
      shareInputRef?.select()
    })
  }

  function openSettingsModal() {
    const ev = event()

    if (!ev) {
      return
    }

    setSettingsEventName(ev.name)
    setSettingsParticipantNames(ev.participants.slice(1).map((participant) => participant.name))
    setSettingsNewParticipantName('')
    setShowAllSettingsParticipants(false)
    setDialogError('')
    setActiveModal('settings')
  }

  function removeSettingsParticipant(index: number) {
    setSettingsParticipantNames((prev) => prev.filter((_, i) => i !== index))
  }

  function addSettingsParticipant() {
    const trimmed = settingsNewParticipantName().trim()

    if (!trimmed) {
      setDialogError('Enter a name.')

      return
    }

    const organizer = createdByName()
    const exists =
      organizer.trim().toLowerCase() === trimmed.toLowerCase() ||
      settingsParticipantNames().some(
      (name) => name.trim().toLowerCase() === trimmed.toLowerCase(),
      )

    if (exists) {
      setDialogError(`Duplicate name: "${trimmed}". Use a unique name.`)

      return
    }

    setSettingsParticipantNames((prev) => [...prev, trimmed])
    setSettingsNewParticipantName('')
  }

  const visibleSettingsParticipantNames = createMemo(() => {
    const all = settingsParticipantNames()

    if (showAllSettingsParticipants()) {
      return all
    }

    return all.slice(0, 5)
  })

  async function saveSettings() {
    const ev = event()

    if (!ev) {
      return
    }

    const nextEventName = settingsEventName().trim()

    if (!nextEventName) {
      setDialogError('Event name is required.')

      return
    }

    const organizer = createdByName()
    const organizerParticipant = ev.participants[0]

    if (!organizerParticipant) {
      setDialogError('Organizer is missing from this event.')

      return
    }

    const nextParticipantNames = settingsParticipantNames()
      .map((name) => name.trim())
      .filter(Boolean)

    if (nextParticipantNames.length < 1) {
      return
    }

    const uniqueNameKeys = new Set<string>()
    uniqueNameKeys.add(organizer.trim().toLowerCase())

    for (const name of nextParticipantNames) {
      const key = name.toLowerCase()

      if (uniqueNameKeys.has(key)) {
        setDialogError(`Duplicate name: "${name}". Use unique names.`)

        return
      }

      uniqueNameKeys.add(key)
    }

    const existingByKey = new Map(ev.participants.map((participant) => [participant.name.toLowerCase(), participant]))
    const spd = slotsPerDay(ev)
    const updatedParticipants = [
      organizerParticipant,
      ...nextParticipantNames.map((name) => {
      const existing = existingByKey.get(name.toLowerCase())

      if (existing) {
        return { ...existing, name }
      }

      const newParticipant: Participant = {
        name,
        timezone: '',
        slots: new Array(ev.dates.length * spd).fill(0) as SlotValue[],
        updatedAt: null,
        version: 0,
      }

      return newParticipant
      }),
    ]

    const updated: AppEvent = {
      ...ev,
      name: nextEventName,
      participants: updatedParticipants,
    }
    const selected = currentName()
    const nextSelected =
      updatedParticipants.find((participant) => participant.name === selected)?.name ??
      updatedParticipants[0]?.name ??
      ''

    if (!nextSelected) {
      setDialogError('At least 2 people are required.')

      return
    }

    await saveEvent(updated)
    await queueEventSync(updated)
    requestSyncFlush()
    await setSelectedParticipant(updated.id, nextSelected)

    setEvent(updated)
    setCurrentName(nextSelected)
    loadParticipantSlots(updated, nextSelected)
    setActiveModal(null)
  }

  async function copyLink(url: string) {
    let copied = false
    try {
      await navigator.clipboard.writeText(url)
      copied = true
    } catch {
      shareInputRef.focus()
      shareInputRef.select()

      if (document.execCommand) copied = document.execCommand('copy')
    }

    if (copied) {
      setCopyStatus('Copied to clipboard!')
    } else {
      setCopyStatus('Select and press Command+C')
    }
  }

  const createdByName = createMemo(() => event()?.participants[0]?.name ?? 'Unknown')
  const greetingContext = createMemo(() => {
    const ev = event()

    if (!ev) {
      return 'Share the event link with anyone who needs to respond.'
    }

    const organizer = createdByName()
    const current = currentName().trim().toLowerCase()

    if (current && current === organizer.toLowerCase()) {
      return `You are organizing "${ev.name}".`
    }

    return `${organizer} is organizing "${ev.name}".`
  })
  const currentTimezone = createMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone)
  const confirmSlotPreview = createMemo<SummaryGroups>(() => {
    const day = days().find((entry) => entry.label === confirmDay())
    const timeIndex = times().findIndex((entry) => entry.label === confirmTime())

    if (!day || timeIndex < 0) {
      return emptySummaryGroups()
    }

    return peopleGroupsForSlot(day.key, timeIndex)
  })
  const pageTitle = createMemo(() => {
    const ev = event()

    if (!ev) {
      return 'TimeSweeper — Group scheduling, no login needed'
    }

    return `${ev.name} — TimeSweeper`
  })
  const pageUrl = `${window.location.origin}/e/${encodeURIComponent(props.eventId)}`
  const pageImage = `${window.location.origin}/anti-tank-mine-logo.png`

  const confirmedInfo = createMemo(() => {
    const ev = event()

    if (!ev || ev.status !== 'confirmed' || !ev.confirmedSlot) {
      return null
    }

    const dayLabel = formatDateLabel(ev.confirmedSlot.date)
    const start =
      times().find((t) => t.value === ev.confirmedSlot!.startTime)?.label ??
      ev.confirmedSlot.startTime

    return {
      dayLabel,
      start,
      slot: ev.confirmedSlot,
    }
  })
  const isConfirmed = createMemo(() => !!confirmedInfo())

  const confirmedPickedLine = createMemo(() => {
    const info = confirmedInfo()

    if (!info) {
      return ''
    }

    return `${info.dayLabel} ${info.start} (${currentTimezone()})`
  })
  const participantsLine = createMemo(() => {
    const ev = event()

    if (!ev) {
      return ''
    }

    return ev.participants.map((p) => p.name).join(', ')
  })
  const summaryDetailsText = createMemo(() => {
    const ev = event()
    const info = confirmedInfo()

    if (!ev || !info) {
      return ''
    }

    const end = times().find((t) => t.value === info.slot.endTime)?.label ?? info.slot.endTime

    return [
      `Event: ${ev.name}`,
      `Created by: ${createdByName()}`,
      `When: ${info.dayLabel} ${info.start}-${end} (${currentTimezone()})`,
      `People: ${participantsLine()}`,
    ].join('\n')
  })

  async function copyConfirmedSummary() {
    const summary = summaryDetailsText()

    if (!summary) {
      return
    }

    try {
      await navigator.clipboard.writeText(summary)
    } catch {
    }
  }

  function downloadIcs() {
    const info = confirmedInfo()
    const ev = event()

    if (!info || !ev) {
      return
    }

    const dtStart = toUtcStamp(info.slot.date, info.slot.startTime)
    const dtEnd = toUtcStamp(info.slot.date, info.slot.endTime)
    const description = [
      `Event: ${ev.name}`,
      `Status: confirmed`,
      `Link: ${eventLink()}`,
      `Created by: ${createdByName()}`,
      `When: ${info.dayLabel} ${info.start} (${currentTimezone()})`,
      `People (${ev.participants.length}): ${participantsLine()}`,
    ].join('\n')
    const payload = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//TimeSweeper//EN',
      'BEGIN:VEVENT',
      `UID:${ev.id}@timesweeper.app`,
      `DTSTAMP:${toUtcStamp(info.slot.date, info.slot.startTime)}`,
      `DTSTART:${dtStart}`,
      `DTEND:${dtEnd}`,
      'STATUS:CONFIRMED',
      `SUMMARY:${icsEscape(`TimeSweeper: ${ev.name}`)}`,
      `DESCRIPTION:${icsEscape(description)}`,
      `URL:${icsEscape(eventLink())}`,
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')
    const blob = new Blob([payload], { type: 'text/calendar;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${ev.name.replace(/\s+/g, '-').toLowerCase() || 'timesweeper'}.ics`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function selectParticipant(name: string) {
    const ev = event()

    if (!ev) {
      return
    }

    const exists = ev.participants.some((participant) => participant.name === name)

    if (!exists) {
      return
    }

    await setSelectedParticipant(ev.id, name)
    loadParticipantSlots(ev, name)
    setCurrentName(name)
    setActiveModal(null)
  }

  async function addParticipantFromPicker() {
    const trimmed = newParticipantName().trim()

    if (!trimmed) {
      return
    }

    const ev = event()

    if (!ev) {
      return
    }

    const existing = ev.participants.find((p) => p.name.toLowerCase() === trimmed.toLowerCase())

    if (existing) {
      await selectParticipant(existing.name)

      return
    }

    const spd = slotsPerDay(ev)
    const newP: Participant = {
      name: trimmed,
      timezone: '',
      slots: new Array(ev.dates.length * spd).fill(0) as SlotValue[],
      updatedAt: null,
      version: 0,
    }
    const updated: AppEvent = { ...ev, participants: [...ev.participants, newP] }
    await saveEvent(updated)
    await queueEventSync(updated)
    requestSyncFlush()
    await setSelectedParticipant(updated.id, trimmed)
    setEvent(updated)
    loadParticipantSlots(updated, trimmed)
    setCurrentName(trimmed)
    setNewParticipantName('')
    setActiveModal(null)
  }

  async function initializeSelectedParticipant(ev: AppEvent) {
    const savedName = await getSelectedParticipant(ev.id)
    const exists = savedName ? ev.participants.some((p) => p.name === savedName) : false

    if (savedName && exists) {
      loadParticipantSlots(ev, savedName)
      setCurrentName(savedName)
      setActiveModal(null)
    } else {
      setActiveModal('name-picker')
    }
  }

  async function loadFromWorkerInBackground() {
    try {
      const remote = await pullRemoteEvent(props.eventId)

      if (remote) {
        await applyRemoteEvent(remote)
        void initializeSelectedParticipant(remote)
        setLoadError('none')

        return
      }
      setLoadError('not-found')
    } catch {
      setLoadError('network')
    }
  }

  async function retryLoadFromWorker() {
    setLoadError('none')
    await loadFromWorkerInBackground()
  }

  const eventUrl = createMemo(() => `${window.location.origin}/e/${props.eventId}`)
  const confirmDateTimeOptions = createMemo(() => {
    const candidates = confirmCandidates()

    if (!candidates || candidates.length === 0) {
      const options: Array<{ value: string; label: string }> = []

      days().forEach((day) => {
        times().forEach((time) => {
          options.push({
            value: `${day.label}||${time.label}`,
            label: `${day.label} ${time.label}`,
          })
        })
      })

      return options
    }

    return candidates.map((candidate) => ({
      value: `${candidate.day}||${candidate.time}`,
      label: `${candidate.day} ${candidate.time}`,
    }))
  })
  const confirmDateTimeValue = createMemo(() => `${confirmDay()}||${confirmTime()}`)

  function onConfirmDateTimeChange(next: string) {
    const [nextDay, nextTime] = next.split('||')

    if (!nextDay || !nextTime) {
      return
    }

    setConfirmDay(nextDay)
    setConfirmTime(nextTime)
  }
  const useParticipantSelect = createMemo(() => {
    const count = event()?.participants.length ?? 0

    return count > 5
  })
  const participantPickerOptions = createMemo(() => {
    const ev = event()

    if (!ev) {
      return []
    }

    return [
      { value: '', label: 'Select your name...' },
      ...ev.participants.map((participant) => ({ value: participant.name, label: participant.name })),
    ]
  })

  async function onParticipantPickerChange(name: string) {
    if (!name) {
      return
    }

    try {
      await selectParticipant(name)
    } catch {
    }
  }

  createEffect(() => {
    const options = confirmDateTimeOptions()
    const current = confirmDateTimeValue()

    if (options.length === 0) {
      return
    }

    if (!options.some((option) => option.value === current)) {
      onConfirmDateTimeChange(options[0].value)
    }
  })

  // Global event listeners + initial load
  onMount(() => {
    const desktopQuery = window.matchMedia('(min-width: 700px)')
    const onDesktopChange = () => {
      setIsDesktop(desktopQuery.matches)
    }

    onDesktopChange()
    desktopQuery.addEventListener('change', onDesktopChange)

    let wsConnected = false
    let fallbackPollTimer: number | undefined
    let fallbackPollDelay = 3000
    const fallbackPollMin = 3000
    const fallbackPollMax = 30000

    function clearFallbackPoll() {
      if (fallbackPollTimer === undefined) {
        return
      }

      window.clearTimeout(fallbackPollTimer)
      fallbackPollTimer = undefined
    }

    function scheduleFallbackPoll() {
      if (wsConnected || fallbackPollTimer !== undefined) {
        return
      }

      fallbackPollTimer = window.setTimeout(() => {
        fallbackPollTimer = undefined

        if (wsConnected || !navigator.onLine) {
          scheduleFallbackPoll()

          return
        }

        void pullRemoteEvent(props.eventId)
          .then((remote) => {
            if (remote) {
              void applyRemoteEvent(remote)
            }

            fallbackPollDelay = fallbackPollMin
          })
          .catch(() => {
            fallbackPollDelay = Math.min(fallbackPollDelay * 2, fallbackPollMax)
          })
          .finally(() => {
            requestSyncFlush()
            scheduleFallbackPoll()
          })
      }, fallbackPollDelay)
    }

    const disconnectSocket = connectEventSocket(
      props.eventId,
      (remote) => {
        void applyRemoteEvent(remote)
      },
      (eventId, participantName, slots, updatedAt, version) => {
        void applyRemoteParticipantUpdate(eventId, participantName, slots, updatedAt, version)
      },
      (connected) => {
        wsConnected = connected

        if (connected) {
          fallbackPollDelay = fallbackPollMin
          clearFallbackPoll()

          return
        }

        scheduleFallbackPoll()
      },
    )

    const onOnline = () => {
      requestSyncFlush()

      if (!event()) {
        void retryLoadFromWorker()
      }

      if (!wsConnected) {
        scheduleFallbackPoll()
      }
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        requestSyncFlush()
        void pullRemoteEvent(props.eventId)
          .then((remote) => {
            if (remote) void applyRemoteEvent(remote)
          })
          .catch(() => {})

        if (!wsConnected) {
          scheduleFallbackPoll()
        }
      }
    }
    makeEventListener(window, 'online', onOnline)
    makeEventListener(document, 'visibilitychange', onVisibilityChange)

    const onKeyDown = (e: KeyboardEvent) => {
      if (
        (e.target as HTMLElement).tagName === 'INPUT' ||
        (e.target as HTMLElement).tagName === 'SELECT'
      )

        return

      if (e.key === 's' || e.key === 'S') {
        e.preventDefault()
        revealSharePanel()
      }

      if (e.key === 'F3') {
        e.preventDefault()
        revealSharePanel()
      }

      if (e.key === 'F5') {
        e.preventDefault()
        openConfirm(null, null)
      }

    }

    makeEventListener(document, 'keydown', onKeyDown)

    onCleanup(() => {
      desktopQuery.removeEventListener('change', onDesktopChange)
      disconnectSocket()
      clearFallbackPoll()
    })

    let localEvent: AppEvent | undefined
    // Sync is background-only. Local event should render immediately if available.
    void (async () => {
      try {
        localEvent = await getEvent(props.eventId)

        if (localEvent) {
          setEvent(localEvent)
          await initializeSelectedParticipant(localEvent)
        }
      } catch {
        // Never block local rendering when sync/indexeddb init fails.
      } finally {
        setLocalReady(true)
      }

      try {
        await loadFromWorkerInBackground()

        if (!event() && localEvent) {
          // Event exists locally but not on server yet: seed remote once.
          await queueEventSync(localEvent)
          requestSyncFlush()
        }
      } catch {
        // Keep local-only mode when backend is unavailable.
      }
      requestSyncFlush()
    })()
  })

  const loadingOverlayText = createMemo(() => {
    if (loadError() === 'network') {
      return 'Could not reach server to load this event.'
    }

    if (loadError() === 'not-found') {
      return 'Event not found in local cache or on server.'
    }

    return 'Loading people...'
  })

  return (
    <>
      <Title>{pageTitle()}</Title>
      <Meta
        name="description"
        content="Share your availability for this event to help find a time that works for all."
      />
      <Meta property="og:type" content="website" />
      <Meta property="og:url" content={pageUrl} />
      <Meta property="og:title" content={pageTitle()} />
      <Meta
        property="og:description"
        content="Share your availability for this event to help find a time that works for all."
      />
      <Meta property="og:image" content={pageImage} />
      <Meta name="twitter:card" content="summary_large_image" />
      <Meta name="twitter:title" content={pageTitle()} />
      <Meta
        name="twitter:description"
        content="Share your availability for this event to help find a time that works for all."
      />
      <Meta name="twitter:image" content={pageImage} />
      <div class="grid-view">
        <Show when={localReady()} fallback={null}>
        <div class="grid-view__shell">
          <div class="grid-view__hero row row--between row--center">
            <a href="/" class="grid-view__brand" aria-label="Go to TimeSweeper home">
              <MineIcon size={18} /> TimeSweeper
            </a>
            <div class="grid-view__hero-actions row row--center">
              <span class="grid-view__hero-timezone">
                Timezone: <b>{currentTimezone()}</b>
              </span>
            </div>
          </div>

          <div class="grid-view__content">
            <section class="grid-view__steps-panel r">
              <div class="grid-view__panels">
                <div class="grid-view__panel-frame">
                <Show when={event()}>
                  {(loadedEvent) => (
                    <div class="grid-view__title-row">
                      <h2 class="grid-view__pane-title grid-view__pane-title--event">
                        {loadedEvent().name}
                      </h2>
                      <Win95Button
                        size="small"
                        variant="toolbar"
                        class="grid-view__title-settings"
                        onClick={openSettingsModal}
                      >
                        Settings
                      </Win95Button>
                    </div>
                  )}
                </Show>
                <p class="grid-view__intro-text">
                  Hi{' '}
                  <Show
                    when={!isConfirmed()}
                    fallback={<span class="grid-controls__name">{currentName() || 'there'}</span>}
                  >
                    <a
                      href="#"
                      class="grid-controls__name-link"
                      onClick={(event) => {
                        event.preventDefault()
                        setActiveModal('name-picker')
                      }}
                      aria-label="Switch name"
                    >
                      <span class="grid-controls__name">{currentName() || 'there'}</span>
                    </a>
                  </Show>
                  ! {greetingContext()} Share this link with anyone who needs to respond. Fill your availability. The app will suggest the
                  best times. Once a good option exists, anyone can confirm the event time.
                </p>
                <section class="grid-view__section">
                  <div class="grid-view__section-header">
                    <span class="grid-view__section-number">1.</span>
                    <span>Share the link with everyone</span>
                    <hr />
                  </div>
                  <div class="grid-view__section-body grid-view__section-body--title">
                    <label for="share-link" class="share-panel__label">
                      Event link:
                    </label>
                    <div class="share-panel__link-row row">
                      <Win95Field
                        kind="input"
                        id="share-link"
                        name="shareLink"
                        type="url"
                        size="small"
                        value={eventUrl()}
                        readOnly
                        wrapperClass="dialog__field share-panel__field"
                        inputRef={(el) => {
                          shareInputRef = el
                        }}
                        onClick={() => shareInputRef.select()}
                      />
                      <Win95Button
                        size="small"
                        variant="toolbar"
                        class="share-panel__copy-btn"
                        onClick={() => copyLink(eventUrl())}
                      >
                        <span class="hk">C</span>opy
                      </Win95Button>
                      <div class="copy-status" aria-live="polite">
                        {copyStatus()}
                      </div>
                    </div>
                  </div>
                </section>

                <section class="grid-view__section">
                  <div class="grid-view__section-header">
                    <span class="grid-view__section-number">2.</span>
                    <span>Mark your availability</span>
                    <hr />
                  </div>
                  <div class="grid-view__section-body">
                    <div
                      classList={{
                        'grid-view__legend': true,
                        'grid-view__legend--horizontal': isDesktop(),
                      }}
                    >
                      <AvailabilityLegend withLabels />
                    </div>
                    <div class="availability-grid-wrap">
                      <AvailabilityGrid
                        days={days()}
                        times={times()}
                        myState={myState}
                        isConfirmed={isConfirmed()}
                        onCycle={cycleCell}
                      />
                    </div>
                  </div>
                </section>

                <section class="grid-view__section">
                  <div class="grid-view__section-header">
                    <span class="grid-view__section-number">3.</span>
                    <span>Confirm time</span>
                    <hr />
                  </div>
                  <div class="grid-view__section-body">
                    <p class="grid-view__suggestions-helper grid-view__panel-content--title-aligned">
                      {suggestionsHelperText()}
                    </p>
                    <Show
                      when={canShowSuggestions()}
                      fallback={
                        <div class="empty-text grid-view__panel-content--title-aligned">
                          Not enough people yet to suggest times.
                        </div>
                      }
                    >
                      <Show
                        when={summarySplitRows().length > 0}
                        fallback={
                          <div class="empty-text grid-view__panel-content--title-aligned">
                            No candidate times yet
                          </div>
                        }
                      >
                        <div class="summary-table-wrap grid-view__panel-content--title-aligned">
                          <Show
                            when={isDesktop()}
                            fallback={
                              <div class="summary-slots-mobile-list">
                                <For each={visibleSummarySplitRows()}>
                                  {(splitRow) => (
                                    <button
                                      type="button"
                                      class="summary-slots-mobile-card"
                                      onClick={() => openConfirmFromSplitRow(splitRow)}
                                    >
                                      <div class="summary-slots-mobile-card__head">
                                        <div>
                                          <div class="summary-slots-mobile-card__label">
                                            Availability split
                                          </div>
                                          <div class="summary-slots-mobile-card__counts">
                                            {splitRow.yesCount} yes · {splitRow.maybeCount} maybe ·{' '}
                                            {splitRow.noCount} no
                                          </div>
                                        </div>
                                      </div>
                                      <div class="summary-slots-mobile-card__section">
                                        <div class="summary-slots-mobile-card__label">People</div>
                                        <div class="summary-slots-table__people-main">
                                          <For each={statusNameGroups(splitRow.groups)}>
                                            {(group) => (
                                              <div class="summary-slots-table__people-row">
                                                <StatusMiniCell value={group.value} />
                                                <span>{group.names.join(', ')}</span>
                                              </div>
                                            )}
                                          </For>
                                        </div>
                                      </div>
                                      <div class="summary-slots-mobile-card__section">
                                        <div class="summary-slots-mobile-card__label">Times</div>
                                        <For each={timesByDayEntries(splitRow.slots)}>
                                          {(dayGroup) => (
                                            <div class="summary-slots-table__times-row">
                                              <span class="summary-slots-table__times-day">
                                                {dayGroup[0]}:
                                              </span>{' '}
                                              <span class="summary-slots-table__times-list">
                                                {dayGroup[1].join(', ')}
                                              </span>
                                            </div>
                                          )}
                                        </For>
                                      </div>
                                    </button>
                                  )}
                                </For>
                              </div>
                            }
                          >
                            <div class="summary-slots-wrap">
                              <table class="summary-slots-table">
                                <thead>
                                <tr>
                                  <th>People</th>
                                  <th class="summary-slots-table__num">Yes</th>
                                  <th class="summary-slots-table__num">Maybe</th>
                                  <th class="summary-slots-table__num">No</th>
                                  <th>Times</th>
                                  <th class="summary-slots-table__action-col">Action</th>
                                </tr>
                                </thead>
                                <tbody>
                                  <For each={visibleSummarySplitRows()}>
                                    {(splitRow) => (
                                      <tr
                                        classList={{
                                          'summary-slots-table__row--best': splitRow.kind === 'best',
                                          'summary-slots-table__row--almost': splitRow.kind === 'almost',
                                          'summary-slots-table__row--partial': splitRow.kind === 'partial',
                                        }}
                                      >
                                        <td class="summary-slots-table__people-cell">
                                          <div class="summary-slots-table__people-main">
                                            <For each={statusNameGroups(splitRow.groups)}>
                                              {(group) => (
                                                <div class="summary-slots-table__people-row">
                                                  <StatusMiniCell
                                                    value={group.value}
                                                    class="status-mini-cell--aligned"
                                                  />
                                                  <span>{group.names.join(', ')}</span>
                                                </div>
                                              )}
                                            </For>
                                          </div>
                                        </td>
                                        <td class="summary-slots-table__num">{splitRow.yesCount}</td>
                                        <td class="summary-slots-table__num">{splitRow.maybeCount}</td>
                                        <td class="summary-slots-table__num">{splitRow.noCount}</td>
                                        <td class="summary-slots-table__times-cell">
                                          <For each={timesByDayEntries(splitRow.slots)}>
                                            {(dayGroup) => (
                                              <div class="summary-slots-table__times-row">
                                                <span class="summary-slots-table__times-day">
                                                  {dayGroup[0]}:
                                                </span>{' '}
                                                <span class="summary-slots-table__times-list">
                                                  {dayGroup[1].join(', ')}
                                                </span>
                                              </div>
                                            )}
                                          </For>
                                        </td>
                                        <td class="summary-slots-table__action-cell">
                                          <Win95Button
                                            size="small"
                                            variant="toolbar"
                                            onClick={() => openConfirmFromSplitRow(splitRow)}
                                          >
                                            Review
                                          </Win95Button>
                                        </td>
                                      </tr>
                                    )}
                                  </For>
                                </tbody>
                              </table>
                            </div>
                          </Show>
                          <Show when={summarySplitRows().length > SPLIT_ROWS_PREVIEW_COUNT}>
                            <div class="summary-list__meta-row">
                              <div class="summary-list__toggle-row">
                                <Win95Button
                                  size="small"
                                  onClick={() => setShowAllSummaryRows(!showAllSummaryRows())}
                                >
                                  <Show
                                    when={showAllSummaryRows()}
                                    fallback={`Show all ${summarySplitRows().length} groups`}
                                  >
                                    Show fewer groups
                                  </Show>
                                </Win95Button>
                              </div>
                            </div>
                          </Show>
                        </div>
                      </Show>
                    </Show>
                  </div>
                </section>
                </div>
              </div>
            </section>
            {/* /panels */}

            <Show when={isConfirmed()}>
              <Win95Dialog
                title="Time confirmed"
                class="dialog--confirmed"
                bodyClass="dialog-body--confirmed-overlay"

                showCloseButton={false}
              >
                <div class="grid-view__confirmed-details">
                  <div>
                    <b>Event:</b> {event()!.name}
                  </div>
                  <div>
                    <b>Created by:</b> {createdByName()}
                  </div>
                  <div>
                    <b>When:</b> {confirmedPickedLine()}
                  </div>
                  <div>
                    <b>People:</b> {participantsLine()}
                  </div>
                </div>
                <div class="grid-view__confirmed-actions grid-view__confirmed-actions--primary">
                  <Win95Button onClick={downloadIcs}>Download .ics</Win95Button>
                  <Win95Button onClick={copyConfirmedSummary}>Copy summary</Win95Button>
                </div>
                <div class="grid-view__confirmed-separator" />
                <div class="grid-view__confirmed-secondary">
                  <div class="grid-view__confirmed-undo-row">
                    <div class="grid-view__confirmed-undo-help">
                      Availability is locked because a time was picked.
                      <br />
                      Need changes? Undo confirmation first.
                    </div>
                    <Win95Button
                      class="grid-view__confirmed-undo-btn"
                      onClick={undoConfirmedTime}
                    >
                      Undo confirmation
                    </Win95Button>
                  </div>
                </div>
              </Win95Dialog>
            </Show>
          </div>
          {/* /grid-view__content */}
        </div>
        {/* /grid-view__shell */}

        <Show when={activeModal() === 'name-picker'}>
          <Win95Dialog
            title="Who dis?"
            class="dialog--name-picker"
            onClose={() => (event() ? setActiveModal(null) : goToLanding())}
          >
            <Show
              when={event()}
              fallback={
                <div class="participant-picker__loading">
                  <p class="participant-picker__lead">{loadingOverlayText()}</p>
                </div>
              }
            >
              <p class="participant-picker__lead">
                {createdByName()} is organizing "{event()?.name ?? 'this event'}" and wants to know
                when you're available.
              </p>
              <p class="participant-picker__label">Who are you?</p>
              <Show
                when={useParticipantSelect()}
                fallback={
                  <div class="participant-picker__list">
                    <For each={event()?.participants ?? []}>
                      {(participant) => (
                        <Win95Button
                          size="small"
                          class={`dialog-btn participant-picker__item${
                            currentName() === participant.name
                              ? ' participant-picker__item--selected'
                              : ''
                          }`}
                          onClick={() => {
                            void selectParticipant(participant.name)
                          }}
                        >
                          {participant.name}
                        </Win95Button>
                      )}
                    </For>
                  </div>
                }
              >
                <Win95Field
                  kind="select"
                  id="participant-picker-select"
                  name="participantPicker"
                  size="small"
                  value={currentName() || ''}
                  options={participantPickerOptions()}
                  wrapperClass="dialog__field participant-picker__select-field"
                  onChange={onParticipantPickerChange}
                />
              </Show>
              <label class="participant-picker__label" for="new-participant-name">
                Not on the list?
              </label>
              <Win95Field
                kind="input"
                id="new-participant-name"
                name="newParticipantName"
                value={newParticipantName()}
                placeholder="Enter your name"
                wrapperClass="dialog__field"
                onInput={setNewParticipantName}
              />
              <div class="dialog-buttons">
                <Win95Button class="dialog-btn" onClick={addParticipantFromPicker}>
                  Join
                </Win95Button>
              </div>
            </Show>
          </Win95Dialog>
        </Show>

        <Show when={activeModal() === 'help'}>
          <Win95Dialog
            title="Help — TimeSweeper"
            class="dialog--help"
            bodyClass="dialog-body--help"
            onClose={() => setActiveModal(null)}
          >
            <p class="help__lead">
              <b>How to use TimeSweeper:</b>
            </p>
            <p class="help__step">
              <b>1.</b> Click your <b>name</b> and pick your name
            </p>
            <p class="help__step">
              <b>2.</b> Click a cell to mark availability:
              <br />
              <AvailabilityLegend mini class="help__cycle" />
            </p>
            <p class="help__step">
              <b>3.</b> Check "Summary" to compare best and near-match slots
            </p>
            <p class="help__step">
              <b>4.</b> Open "Share this event link" and send it to others
            </p>
            <p class="help__step">
              <b>5.</b> When everyone agrees, click <b>Confirm</b>
            </p>
            <p class="help__keys">
              <b>Keyboard shortcuts:</b>
              <br />
              <span class="help__key-line">F3 / S — Focus share link</span>
            </p>
            <div class="dialog-buttons">
              <Win95Button class="dialog-btn" onClick={() => setActiveModal(null)}>
                OK
              </Win95Button>
            </div>
          </Win95Dialog>
        </Show>

        <Show when={activeModal() === 'settings'}>
          <Win95Dialog
            title="Event settings"
            class="dialog--settings"
            bodyClass="dialog-body--settings"
            onClose={() => setActiveModal(null)}
          >
            <label class="settings__label" for="settings-event-name">
              Event name:
            </label>
            <Win95Field
              kind="input"
              id="settings-event-name"
              name="settingsEventName"
              value={settingsEventName()}
              wrapperClass="dialog__field"
              onInput={setSettingsEventName}
            />
            <label class="settings__label" for="settings-organizer-name">
              Organizer:
            </label>
            <p class="settings__organizer">{createdByName()}</p>
            <p class="settings__label">Dates:</p>
            <p class="settings__organizer">Locked after event creation to keep everyone aligned.</p>
            <p class="settings__label">People:</p>
            <Show when={settingsParticipantNames().length === 0}>
              <p class="settings__note">Add at least one person before saving.</p>
            </Show>
            <div class="settings__participants-list">
              <For each={visibleSettingsParticipantNames()}>
                {(participantName, index) => (
                  <div class="settings__participant-row">
                    <span class="settings__participant-name">{participantName}</span>
                    <Win95Button
                      size="small"
                      variant="icon"
                      class="settings__participant-remove"
                      onClick={() => removeSettingsParticipant(index())}
                    >
                      ×
                    </Win95Button>
                  </div>
                )}
              </For>
            </div>
            <Show when={settingsParticipantNames().length > 5}>
              <div class="settings__participants-toggle">
                <Win95Button
                  size="small"
                  variant="toolbar"
                  onClick={() => setShowAllSettingsParticipants(!showAllSettingsParticipants())}
                >
                  <Show
                    when={showAllSettingsParticipants()}
                    fallback={`Show all ${settingsParticipantNames().length} people`}
                  >
                    Show fewer people
                  </Show>
                </Win95Button>
              </div>
            </Show>
            <label class="settings__label" for="settings-new-participant-name">
              Add person:
            </label>
            <div class="settings__add-row">
              <Win95Field
                kind="input"
                id="settings-new-participant-name"
                name="settingsNewParticipantName"
                value={settingsNewParticipantName()}
                placeholder="Name"
                wrapperClass="dialog__field settings__add-field"
                onInput={setSettingsNewParticipantName}
              />
              <Win95Button size="small" variant="toolbar" onClick={addSettingsParticipant}>
                Add
              </Win95Button>
            </div>
            <div class="dialog-buttons">
              <Win95Button class="dialog-btn" onClick={saveSettings}>
                Save
              </Win95Button>
              <Win95Button class="dialog-btn" onClick={() => setActiveModal(null)}>
                Cancel
              </Win95Button>
            </div>
          </Win95Dialog>
        </Show>

        <Show when={!!dialogError()}>
          <ErrorDialog message={dialogError()} onClose={() => setDialogError('')} />
        </Show>

        <Show when={activeModal() === 'confirm'}>
          <Win95Dialog
            title="Confirm Time"
            class="dialog--confirm"
            bodyClass="dialog-body--confirm"
            onClose={() => setActiveModal(null)}
          >
            <p class="confirm__lead">Confirm this time for everyone?</p>
            <Show when={(confirmCandidates()?.length ?? 0) > 1}>
              <p class="confirm__scope-note">
                Choose one of {(confirmCandidates()?.length ?? 0)} matching time variants.
              </p>
            </Show>
            <label class="confirm__label" for="confirm-date-time">
              Date and time:
            </label>
            <Win95Field
              kind="select"
              id="confirm-date-time"
              name="confirmDateTime"
              size="small"
              value={confirmDateTimeValue()}
              options={confirmDateTimeOptions()}
              wrapperClass="confirm__field confirm__field--date-time"
              onChange={onConfirmDateTimeChange}
            />
            <div class="confirm__preview s">
              <For each={statusNameGroups(confirmSlotPreview())}>
                {(group) => (
                  <div class="confirm__preview-row summary-slots-table__people-row">
                    <StatusMiniCell value={group.value} class="status-mini-cell--aligned" />
                    <span>{group.names.join(', ')}</span>
                  </div>
                )}
              </For>
            </div>
            <p class="confirm__note">
              Everyone will see the confirmed time.
              <br />
              This can be undone later.
            </p>
            <div class="dialog-buttons">
              <Win95Button class="dialog-btn" onClick={doConfirm}>
                <span class="hk">C</span>onfirm
              </Win95Button>
              <Win95Button class="dialog-btn" onClick={() => setActiveModal(null)}>
                Cancel
              </Win95Button>
            </div>
          </Win95Dialog>
        </Show>
        </Show>
      </div>
    </>
  )
}
