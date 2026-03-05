import { createSignal, createMemo, createEffect, onMount, onCleanup, For, Show } from 'solid-js'
import { createStore, reconcile } from 'solid-js/store'
import { makeEventListener } from '@solid-primitives/event-listener'
import {
  getEvent,
  getSelectedParticipant,
  saveEvent,
  setSelectedParticipant,
  updateParticipantSlots,
} from './db'
import {
  connectEventSocket,
  flushPendingSync,
  pullRemoteEvent,
  queueEventSync,
  queueParticipantSync,
} from './sync'
import Win95Field from './components/Win95Field'
import Win95Button from './components/Win95Button'
import Win95Dialog from './components/Win95Dialog'
import AvailabilityLegend from './components/AvailabilityLegend'
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

  type ActiveModal = null | 'name-picker' | 'help' | 'confirm'
  const [activeModal, setActiveModal] = createSignal<ActiveModal>('name-picker')
  const [confirmDay, setConfirmDay] = createSignal('')
  const [confirmTime, setConfirmTime] = createSignal('')
  const [selectedSummarySlot, setSelectedSummarySlot] = createSignal<{
    intersectionKey: string
    day: string
    time: string
  } | null>(null)
  const [summaryValidationError, setSummaryValidationError] = createSignal('')
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
  const visibleSummaryIntersections = createMemo(() => {
    const all = summaryIntersections()

    if (showAllSummaryRows()) {
      return all
    }

    return all.slice(0, 3)
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
    await flushPendingSync()
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

  function summaryCellMark(value: SlotValue) {
    if (value === 1) {
      return '✓'
    }

    if (value === 2) {
      return '?'
    }

    return ''
  }

  function summaryLegendGroups(groups: SummaryGroups) {
    const sortNames = (names: string[]) =>
      [...names].sort((a, b) => {
        if (a === 'You') {
          return -1
        }

        if (b === 'You') {
          return 1
        }

        return a.localeCompare(b)
      })

    const sections: Array<{ value: SlotValue; names: string[] }> = [
      { value: 1, names: sortNames(groups.yes) },
      { value: 2, names: sortNames(groups.maybe) },
      { value: 0, names: sortNames(groups.no) },
    ]

    return sections.filter((section) => section.names.length > 0)
  }

  function summaryLegendCount(groups: SummaryGroups) {
    const total = groups.yes.length + groups.maybe.length + groups.no.length
    const canAttend = groups.yes.length + groups.maybe.length

    if (groups.maybe.length > 0) {
      return `${canAttend}/${total}*`
    }

    return `${canAttend}/${total}`
  }

  function isSummarySlotSelected(intersectionKey: string, day: string, time: string) {
    const selected = selectedSummarySlot()

    if (!selected) {
      return false
    }

    return (
      selected.intersectionKey === intersectionKey &&
      selected.day === day &&
      selected.time === time
    )
  }

  function selectSummarySlot(intersectionKey: string, day: string, time: string) {
    setSummaryValidationError('')
    setSelectedSummarySlot({ intersectionKey, day, time })
  }

  function confirmSelectedSummarySlot() {
    const selected = selectedSummarySlot()

    if (!selected) {
      setSummaryValidationError('Please select a time first.')
      return
    }

    setSummaryValidationError('')
    openConfirm(selected.day, selected.time)
  }

  function renderAvailabilityCell(
    dayKey: string,
    dayLabel: string,
    timeLabel: string,
    timeIndex: number,
    rowIndex: number,
    colIndex: number,
  ) {
    return (
      <button
        type="button"
        classList={{
          'availability-grid__cell': true,
          'availability-grid__cell--yes': myState[dayKey]?.[timeIndex] === 1,
          'availability-grid__cell--maybe': myState[dayKey]?.[timeIndex] === 2,
          'availability-grid__cell--first-row': rowIndex === 0,
          'availability-grid__cell--first-col': colIndex === 0,
        }}
        aria-label={`${dayLabel} at ${timeLabel}. Current status: ${
          myState[dayKey]?.[timeIndex] === 1
            ? 'yes'
            : myState[dayKey]?.[timeIndex] === 2
              ? 'maybe'
              : 'no'
        }. Activate to cycle.`}
        disabled={isConfirmed()}
        onClick={() => cycleCell(dayKey, timeIndex)}
      >
        <Show when={myState[dayKey]?.[timeIndex] === 1}>
          <span class="availability-grid__icon">✔</span>
        </Show>
        <Show when={myState[dayKey]?.[timeIndex] === 2}>
          <span class="availability-grid__icon">?</span>
        </Show>
      </button>
    )
  }

  function openConfirm(day: string | null, time: string | null) {
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
    void flushPendingSync()
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
    void flushPendingSync()
    setEvent(updated)
  }

  function closeOpenDialog() {
    if (activeModal() === 'name-picker' && !event()) {
      goToLanding()

      return
    }

    if (activeModal()) setActiveModal(null)
  }

  function revealSharePanel() {
    setCopyStatus('')
    queueMicrotask(() => {
      shareInputRef?.focus()
      shareInputRef?.select()
    })
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
  const currentTimezone = createMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone)

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
      `Participants: ${participantsLine()}`,
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
      `Participants (${ev.participants.length}): ${participantsLine()}`,
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

    const now = Date.now()
    const idx = ev.participants.findIndex((p) => p.name === name)

    if (idx === -1) {
      return
    }

    const updated: AppEvent = {
      ...ev,
      participants: ev.participants.map((p, i) => (i === idx ? { ...p, visitedAt: now } : p)),
    }
    await saveEvent(updated)
    await setSelectedParticipant(updated.id, name)
    setEvent(updated)
    loadParticipantSlots(updated, name)
    setCurrentName(name)
    setActiveModal(null)
  }

  async function addParticipantFromPicker() {
    const trimmed = newParticipantName().trim()

    if (!trimmed) {
      return
    }

    const ev = event()

    if (!ev || ev.participants.length >= ev.maxParticipants) {
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
      visitedAt: Date.now(),
      updatedAt: null,
      version: 0,
    }
    const updated: AppEvent = { ...ev, participants: [...ev.participants, newP] }
    await saveEvent(updated)
    await queueEventSync(updated)
    await flushPendingSync()
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
  const confirmDayOptions = createMemo(() =>
    days().map((d) => ({ value: d.label, label: d.label })),
  )
  const confirmTimeOptions = createMemo(() =>
    times().map((t) => ({ value: t.label, label: t.label })),
  )
  createEffect(() => {
    if (!isConfirmed() && !activeModal()) {
      return
    }

    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    onCleanup(() => {
      document.body.style.overflow = prevOverflow
    })
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
            void flushPendingSync()
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
      void flushPendingSync()

      if (!event()) {
        void retryLoadFromWorker()
      }

      if (!wsConnected) {
        scheduleFallbackPoll()
      }
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void flushPendingSync()
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
      if (e.key === 'Escape') {
        e.preventDefault()
        closeOpenDialog()

        return
      }

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
          await flushPendingSync()
        }
      } catch {
        // Keep local-only mode when backend is unavailable.
      }
      await flushPendingSync().catch(() => {})
    })()
  })

  const loadingOverlayText = createMemo(() => {
    if (loadError() === 'network') {
      return 'Could not reach server to load this event.'
    }

    if (loadError() === 'not-found') {
      return 'Event not found in local cache or on server.'
    }

    return 'Loading participant list...'
  })

  return (
    <div class="grid-view">
      <Show when={localReady()} fallback={null}>
        <div class="grid-view__shell">
          <div class="grid-view__hero row row--between row--center">
            <a href="/" class="grid-view__brand" aria-label="Go to TimeSweeper home">
              <MineIcon size={18} /> TimeSweeper
            </a>
            <div class="grid-view__hero-actions row row--center row--gap-xs">
              <Win95Button variant="toolbar" onClick={() => setActiveModal('help')}>
                <span class="hk">H</span>elp
              </Win95Button>
              <a
                href="/"
                class="win95-button r win95-button--small"
                aria-label="Return to home"
              >
                Home
              </a>
              <span class="grid-view__hero-timezone">
                Timezone: <b>{currentTimezone()}</b>
              </span>
            </div>
          </div>

          <div class="grid-view__content">
            <Show when={event()}>
              {(loadedEvent) => <h2 class="grid-view__pane-title">{loadedEvent().name}</h2>}
            </Show>
            <section class="grid-view__intro-panel r">
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
                    aria-label="Switch participant name"
                  >
                    <span class="grid-controls__name">{currentName() || 'there'}</span>
                  </a>
                </Show>
                ! Follow the 3 easy steps below: share the event link, fill your availability, then choose and
                confirm the best suggested time once everyone has responded.
              </p>
            </section>

            {/* Single-column layout */}
            <h2 class="grid-view__pane-title grid-view__pane-title--steps">Steps</h2>
            <section class="grid-view__steps-panel r">
              <div class="grid-view__panels">
                <div class="grid-view__panel-frame">
                <section class="grid-view__section">
                  <div class="grid-view__section-header">
                    <span class="grid-view__section-number">1.</span>
                    <span>Share the link with your group</span>
                    <hr />
                  </div>
                  <div class="grid-view__section-body grid-view__section-body--title">
                    <label for="share-link" class="share-panel__label">
                      Share this link:
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
                      <div
                        classList={{
                          'availability-grid': true,
                          'availability-grid--horizontal': isDesktop(),
                        }}
                        style={{
                          '--days': String(Math.min(Math.max(days().length, 1), 7)),
                          '--times': String(Math.max(times().length, 1)),
                        }}
                      >
                        <Show
                          when={isDesktop()}
                          fallback={
                            <>
                              <div class="availability-grid__corner" />
                              <For each={days()}>
                                {(d) => <div class="availability-grid__day">{d.label}</div>}
                              </For>
                              <For each={times()}>
                                {(t, ti) => (
                                  <>
                                    <div class="availability-grid__time">{t.label}</div>
                                    <For each={days()}>
                                      {(d, di) =>
                                        renderAvailabilityCell(
                                          d.key,
                                          d.label,
                                          t.label,
                                          ti(),
                                          ti(),
                                          di(),
                                        )}
                                    </For>
                                  </>
                                )}
                              </For>
                            </>
                          }
                        >
                          <div class="availability-grid__corner" />
                          <For each={times()}>
                            {(t) => <div class="availability-grid__day availability-grid__day--time-head">{t.label}</div>}
                          </For>
                          <For each={days()}>
                            {(d, di) => (
                              <>
                                <div class="availability-grid__time availability-grid__time--day-head">
                                  {d.label}
                                </div>
                                <For each={times()}>
                                  {(t, ti) =>
                                    renderAvailabilityCell(
                                      d.key,
                                      d.label,
                                      t.label,
                                      ti(),
                                      di(),
                                      ti(),
                                    )}
                                </For>
                              </>
                            )}
                          </For>
                        </Show>
                      </div>
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
                    <Show
                      when={canShowSuggestions()}
                      fallback={
                        <div class="empty-text grid-view__panel-content--title-aligned">
                          Not enough participants yet to suggest times.
                        </div>
                      }
                    >
                      <Show
                        when={summaryIntersections().length > 0}
                        fallback={
                          <div class="empty-text grid-view__panel-content--title-aligned">
                            No candidate times yet
                          </div>
                        }
                      >
                        <div class="summary-table-wrap">
                          <div class="summary-list summary-list--scrollable">
                            <For each={visibleSummaryIntersections()}>
                              {(intersection) => {
                                const legendGroups = summaryLegendGroups(intersection.allGroups)

                                return (
                                  <fieldset class="summary-list__item">
                                    <legend class="summary-list__legend">
                                      <span class="summary-list__legend-count">
                                        {summaryLegendCount(intersection.allGroups)}
                                      </span>
                                      <span class="summary-list__legend-separator"> · </span>
                                      <span class="summary-table__name-groups">
                                        <For each={legendGroups}>
                                          {(group, groupIndex) => (
                                            <>
                                              <Show when={groupIndex() > 0}>
                                                <span class="summary-list__legend-separator"> · </span>
                                              </Show>
                                              <span class="summary-table__name-group">
                                                <span
                                                  classList={{
                                                    'summary-table__cell': true,
                                                    'summary-table__cell--mini': true,
                                                    'summary-table__cell--yes': group.value === 1,
                                                    'summary-table__cell--maybe': group.value === 2,
                                                    'summary-table__cell--no': group.value === 0,
                                                  }}
                                                >
                                                  {summaryCellMark(group.value)}
                                                </span>
                                                <span class="summary-table__stack-names">
                                                  {group.names.join(', ')}
                                                </span>
                                              </span>
                                            </>
                                          )}
                                        </For>
                                      </span>
                                    </legend>
                                    <div class="summary-list__body">
                                      <div class="summary-table__date-list">
                                        <For each={intersection.dates}>
                                          {(dateGroup) => (
                                            <div class="summary-table__date-row">
                                              <div class="summary-table__date-inline">
                                                <span class="summary-table__date-title">{dateGroup.day}:</span>
                                                <span class="summary-table__time-list">
                                                  <For each={dateGroup.times}>
                                                    {(timeEntry) => (
                                                      <label
                                                        classList={{
                                                          'summary-table__time-option': true,
                                                          'summary-table__time-option--selected': isSummarySlotSelected(
                                                            intersection.key,
                                                            timeEntry.day,
                                                            timeEntry.time,
                                                          ),
                                                        }}
                                                      >
                                                        <input
                                                          type="radio"
                                                          name="summary-slot"
                                                          class="summary-table__time-radio"
                                                          checked={isSummarySlotSelected(
                                                            intersection.key,
                                                            timeEntry.day,
                                                            timeEntry.time,
                                                          )}
                                                          onChange={() =>
                                                            selectSummarySlot(
                                                              intersection.key,
                                                              timeEntry.day,
                                                              timeEntry.time,
                                                            )
                                                          }
                                                          aria-label={`Select ${timeEntry.day} ${timeEntry.time} for confirmation`}
                                                        />
                                                        <span class="summary-table__time-label">{timeEntry.time}</span>
                                                      </label>
                                                    )}
                                                  </For>
                                                </span>
                                              </div>
                                            </div>
                                          )}
                                        </For>
                                      </div>
                                    </div>
                                  </fieldset>
                                )
                              }}
                            </For>
                          </div>
                          <Show
                            when={
                              summaryIntersections().some(
                                (intersection) => intersection.allGroups.maybe.length > 0,
                              ) || summaryIntersections().length > 3
                            }
                          >
                            <div class="summary-list__meta-row">
                              <Show
                                when={summaryIntersections().some(
                                  (intersection) => intersection.allGroups.maybe.length > 0,
                                )}
                              >
                                <div class="summary-list__maybe-note">
                                  * includes maybe responses
                                </div>
                              </Show>
                              <Show when={summaryIntersections().length > 3}>
                                <div class="summary-list__toggle-row">
                                  <Win95Button
                                    size="small"
                                    onClick={() => setShowAllSummaryRows(!showAllSummaryRows())}
                                  >
                                    <Show
                                      when={showAllSummaryRows()}
                                      fallback={`Show all ${summaryIntersections().length} variants`}
                                    >
                                      Show fewer variants
                                    </Show>
                                  </Win95Button>
                                </div>
                              </Show>
                            </div>
                          </Show>
                          <div class="summary-list__actions">
                            <div class="summary-list__actions-row">
                              <Win95Button class="dialog-btn" onClick={confirmSelectedSummarySlot}>
                                <span class="hk">C</span>onfirm selected time
                              </Win95Button>
                            </div>
                          </div>
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
              <div class="grid-view__confirmed-overlay">
                <div class="grid-view__confirmed-box r">
                  <div class="grid-view__confirmed-title">Time confirmed</div>
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
                      <b>Participants:</b> {participantsLine()}
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
                </div>
              </div>
            </Show>
          </div>
          {/* /grid-view__content */}
        </div>
        {/* /grid-view__shell */}

        {/* === DIALOGS === */}

        <Show when={activeModal() === 'name-picker'}>
          <Win95Dialog
            title="Choose participant"
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
                Choose your participant name to start editing availability.
              </p>
              <div class="participant-picker__list">
                <For each={event()?.participants ?? []}>
                  {(p) => (
                    <Win95Button
                      size="small"
                      class={`dialog-btn participant-picker__item${
                        currentName() === p.name ? ' participant-picker__item--selected' : ''
                      }`}
                      onClick={() => selectParticipant(p.name)}
                    >
                      {p.name}
                    </Win95Button>
                  )}
                </For>
              </div>
              <Show when={(event()?.participants.length ?? 0) < (event()?.maxParticipants ?? 5)}>
                <label class="participant-picker__label" for="new-participant-name">
                  I'm not in the list
                </label>
                <Win95Field
                  kind="input"
                  id="new-participant-name"
                  name="newParticipantName"
                  value={newParticipantName()}
                  placeholder="Your name"
                  wrapperClass="dialog__field"
                  onInput={setNewParticipantName}
                />
                <div class="dialog-buttons">
                  <Win95Button class="dialog-btn" onClick={addParticipantFromPicker}>
                    Add
                  </Win95Button>
                </div>
              </Show>
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
              <b>1.</b> Click your <b>name</b> and pick your participant name
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
              <b>4.</b> Open "Share this link with participants" and send the link to others
            </p>
            <p class="help__step">
              <b>5.</b> When the group agrees, click <b>Confirm</b>
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

        <Show when={activeModal() === 'confirm'}>
          <Win95Dialog
            title="Confirm Time"
            class="dialog--confirm"
            bodyClass="dialog-body--confirm"
            onClose={() => setActiveModal(null)}
          >
            <p class="confirm__lead">Confirm this time for everyone?</p>
            <label class="confirm__label" for="confirm-day">
              Day:
            </label>
            <Win95Field
              kind="select"
              id="confirm-day"
              name="confirmDay"
              size="small"
              value={confirmDay()}
              options={confirmDayOptions()}
              wrapperClass="confirm__field confirm__field--day"
              onChange={setConfirmDay}
            />
            <label class="confirm__label" for="confirm-time">
              Time:
            </label>
            <Win95Field
              kind="select"
              id="confirm-time"
              name="confirmTime"
              size="small"
              value={confirmTime()}
              options={confirmTimeOptions()}
              wrapperClass="confirm__field confirm__field--time"
              onChange={setConfirmTime}
            />
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
        <Show when={!!summaryValidationError()}>
          <Win95Dialog
            title="Cannot confirm yet"
            class="dialog--landing-error"
            bodyClass="dialog-body--landing-error"
            onClose={() => setSummaryValidationError('')}
          >
            <div class="landing-error__row">
              <span class="landing-error__icon" aria-hidden="true">
                !
              </span>
              <p class="landing-error__text">{summaryValidationError()}</p>
            </div>
            <div class="dialog-buttons landing-error__actions">
              <Win95Button class="dialog-btn" onClick={() => setSummaryValidationError('')}>
                OK
              </Win95Button>
            </div>
          </Win95Dialog>
        </Show>
      </Show>
    </div>
  )
}
