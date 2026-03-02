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
import GridAccordion from './components/GridAccordion'
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

type UndoEntry = { dk: string; ti: number; prev: number }
type SummaryCell = { name: string; value: SlotValue; isCurrent: boolean }
type SummaryGroups = { yes: string[]; maybe: string[]; no: string[] }
type SummaryRow = {
  dk: string
  ti: number
  day: string
  time: string
  score: number
  canAttend: number
  kind: 'best' | 'almost' | 'partial'
  missingNames: string[]
  myCell: SummaryCell
  allGroups: SummaryGroups
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

  const [editCollapsed, setEditCollapsed] = createSignal(false)
  const [bestCollapsed, setBestCollapsed] = createSignal(false)

  type ActiveModal = null | 'name-picker' | 'help' | 'confirm'
  const [activeModal, setActiveModal] = createSignal<ActiveModal>('name-picker')
  const [confirmDay, setConfirmDay] = createSignal('')
  const [confirmTime, setConfirmTime] = createSignal('')
  const [shareCollapsed, setShareCollapsed] = createSignal(false)
  const [copyStatus, setCopyStatus] = createSignal('')

  let undoStack: UndoEntry[][] = []
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
  const summaryRows = createMemo<SummaryRow[]>(() => {
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
    const rows: SummaryRow[] = []
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
        const missingNames = cells
          .filter((cell) => cell.value === 0)
          .map((cell) => (cell.isCurrent ? 'You' : cell.name))
        const myCell = cells.find((cell) => cell.isCurrent) ?? { name: 'You', value: 0, isCurrent: true }
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
        rows.push({
          dk: day.key,
          ti,
          day: day.label,
          time: slot.label,
          score,
          canAttend,
          kind,
          missingNames,
          myCell,
          allGroups,
        })
      })
    })
    const kindRank: Record<SummaryRow['kind'], number> = { best: 0, almost: 1, partial: 2 }
    rows.sort((a, b) => {
      if (kindRank[a.kind] !== kindRank[b.kind]) {
        return kindRank[a.kind] - kindRank[b.kind]
      }

      if (a.score !== b.score) {
        return b.score - a.score
      }

      if (a.canAttend !== b.canAttend) {
        return b.canAttend - a.canAttend
      }

      if (a.day !== b.day) {
        return a.day.localeCompare(b.day)
      }

      return a.time.localeCompare(b.time)
    })

    return rows
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

    undoStack.push([{ dk, ti, prev }])
    setMyState(dk, ti, next)

    if (navigator.vibrate) navigator.vibrate(10)
    schedulePersist()
  }

  function setCellValue(dk: string, ti: number, next: SlotValue) {
    if (isConfirmed()) {
      return
    }

    const prev = myState[dk]?.[ti] ?? 0

    if (prev === next) {
      return
    }

    undoStack.push([{ dk, ti, prev }])
    setMyState(dk, ti, next)

    if (navigator.vibrate) {
      navigator.vibrate(10)
    }

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

  function summaryNeedText(missingNames: string[]) {
    if (missingNames.length === 0) {
      return 'Works for everyone'
    }

    const missingYou = missingNames.includes('You')
    const others = missingNames.filter((name) => name !== 'You')

    if (!missingYou) {
      return `Ask ${others.join(', ')} if they can make it`
    }

    if (others.length === 0) {
      return 'Can you make it?'
    }

    return `Can you and ${others.join(', ')} make it?`
  }

  function doUndo() {
    if (isConfirmed()) {
      return
    }

    if (!undoStack.length) {
      return
    }

    const batch = undoStack.pop()!
    batch.forEach((u) => setMyState(u.dk, u.ti, u.prev))
    schedulePersist()
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
    setShareCollapsed(false)
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
      setCopyStatus('Copied to clipboard')
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

      if (e.key === 'F1') {
        e.preventDefault()
        doUndo()
      }

      if (e.key === 'u' || e.key === 'U') {
        e.preventDefault()
        doUndo()
      }

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

      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault()
        doUndo()
      }
    }

    makeEventListener(document, 'keydown', onKeyDown)

    onCleanup(() => {
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
        <div class="grid-view__window r">
          {/* Title bar */}
          <div class="win95-window__title-bar">
            <span class="grid-view__title">
              <MineIcon size={16} /> TimeSweeper — {event()?.name ?? 'Opening event'}
            </span>
            <div class="win95-window__title-buttons">
              <a
                href="/"
                class="win95-button r win95-button--small win95-window__title-button"
                aria-label="Close event and return to home"
              >
                ×
              </a>
            </div>
          </div>

          <div class="grid-view__window-body">
            {/* Minesweeper-style control deck */}
            <div class="grid-view__deck s row row--center row--gap-sm">
              <div class="grid-view__deck-left row row--center row--gap-sm">
                <div class="grid-view__deck-display">
                  Hi <span class="grid-controls__name">{currentName() || 'there'}</span>!
                </div>
                <Show when={!isConfirmed()}>
                  <Win95Button variant="toolbar" onClick={() => setActiveModal('name-picker')}>
                    Switch...
                  </Win95Button>
                </Show>
              </div>
              <div class="grid-view__deck-actions row row--center row--gap-xs">
                <Win95Button variant="toolbar" onClick={() => setActiveModal('help')}>
                  <span class="hk">H</span>elp
                </Win95Button>
              </div>
            </div>
            {/* Two-panel layout */}
            <div class="grid-view__panels">
              {/* Panel: Your availability */}
              <div class="grid-view__panel">
                <div class="grid-view__panel-frame s">
                  <GridAccordion
                    id="share"
                    title="Invite people"
                    collapsed={shareCollapsed()}
                    onToggle={() => setShareCollapsed(!shareCollapsed())}
                    bodyAlign="title"
                  >
                    <p class="share-panel__instruction">
                      Each person marks yes/maybe/no availability. TimeSweeper combines responses
                      and suggests the best times.
                    </p>
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
                    </div>
                    <div class="copy-status" aria-live="polite">
                      {copyStatus()}
                    </div>
                  </GridAccordion>

                  <GridAccordion
                    id="edit"
                    title={`Your availability (${currentTimezone()})`}
                    collapsed={editCollapsed()}
                    onToggle={() => setEditCollapsed(!editCollapsed())}
                    spaced
                  >
                    <div class="grid-view__legend">
                      <AvailabilityLegend withLabels />
                    </div>
                    <div
                      class="availability-grid"
                      style={{ '--days': String(Math.min(Math.max(days().length, 1), 7)) }}
                    >
                      <div class="availability-grid__corner" />
                      <For each={days()}>
                        {(d) => <div class="availability-grid__day">{d.label}</div>}
                      </For>
                      <For each={times()}>
                        {(t, ti) => (
                          <>
                            <div class="availability-grid__time">{t.label}</div>
                            <For each={days()}>
                              {(d, di) => (
                                <button
                                  type="button"
                                  classList={{
                                    'availability-grid__cell': true,
                                    'availability-grid__cell--yes': myState[d.key]?.[ti()] === 1,
                                    'availability-grid__cell--maybe': myState[d.key]?.[ti()] === 2,
                                    'availability-grid__cell--first-row': ti() === 0,
                                    'availability-grid__cell--first-col': di() === 0,
                                  }}
                                  aria-label={`${d.label} at ${t.label}. Current status: ${
                                    myState[d.key]?.[ti()] === 1
                                      ? 'yes'
                                      : myState[d.key]?.[ti()] === 2
                                        ? 'maybe'
                                        : 'no'
                                  }. Activate to cycle.`}
                                  disabled={isConfirmed()}
                                  onClick={() => cycleCell(d.key, ti())}
                                >
                                  <Show when={myState[d.key]?.[ti()] === 1}>
                                    <span class="availability-grid__icon">✔</span>
                                  </Show>
                                  <Show when={myState[d.key]?.[ti()] === 2}>
                                    <span class="availability-grid__icon">?</span>
                                  </Show>
                                </button>
                              )}
                            </For>
                          </>
                        )}
                      </For>
                    </div>
                  </GridAccordion>
                </div>
              </div>

              {/* Panel: Results + Group heatmap */}
              <div class="grid-view__panel">
                <div class="grid-view__panel-frame s">
                  {/* Results sub-panel */}
                  <GridAccordion
                    id="best"
                    title={`Summary (${currentTimezone()})`}
                    collapsed={bestCollapsed()}
                    onToggle={() => setBestCollapsed(!bestCollapsed())}
                  >
                    <Show
                      when={canShowSuggestions()}
                      fallback={
                        <div class="empty-text grid-view__panel-content--title-aligned">
                          Not enough participants yet to suggest times.
                        </div>
                      }
                    >
                      <Show
                        when={summaryRows().length > 0}
                        fallback={
                          <div class="empty-text grid-view__panel-content--title-aligned">
                            No candidate times yet
                          </div>
                        }
                      >
                        <div class="summary-table-wrap">
                          <table class="summary-table">
                            <thead>
                              <tr>
                                <th>Time</th>
                                <th class="summary-table__participant-col">You</th>
                                <th class="summary-table__participants-col">Summary</th>
                                <th class="summary-table__action-col">Action</th>
                              </tr>
                            </thead>
                            <tbody>
                              <For each={summaryRows()}>
                                {(row) => {
                                  return (
                                    <tr
                                      classList={{
                                        'summary-table__row': true,
                                        'summary-table__row--best': row.kind === 'best',
                                        'summary-table__row--almost': row.kind === 'almost',
                                      }}
                                    >
                                      <td class="summary-table__time">
                                        <b>
                                          {row.day} {row.time}
                                        </b>
                                      </td>
                                      <td class="summary-table__participant">
                                        <Show
                                          when={row.myCell.value === 0}
                                          fallback={
                                            <span
                                              classList={{
                                                'summary-table__cell': true,
                                                'summary-table__cell--yes': row.myCell.value === 1,
                                                'summary-table__cell--maybe': row.myCell.value === 2,
                                                'summary-table__cell--no': row.myCell.value === 0,
                                              }}
                                            >
                                              {summaryCellMark(row.myCell.value)}
                                            </span>
                                          }
                                        >
                                          <button
                                            type="button"
                                            classList={{
                                              'summary-table__cell': true,
                                              'summary-table__cell--yes': row.myCell.value === 1,
                                              'summary-table__cell--maybe': row.myCell.value === 2,
                                              'summary-table__cell--no': row.myCell.value === 0,
                                              'summary-table__cell--clickable': true,
                                            }}
                                            onClick={() => setCellValue(row.dk, row.ti, 1)}
                                            aria-label={`Set your availability to yes at ${row.day} ${row.time}`}
                                          >
                                            {summaryCellMark(row.myCell.value)}
                                          </button>
                                        </Show>
                                      </td>
                                      <td class="summary-table__participants">
                                        <div class="summary-table__kind">
                                          {summaryNeedText(row.missingNames)}
                                        </div>
                                        <div class="summary-table__stack">
                                          <Show when={row.allGroups.yes.length > 0}>
                                            <div class="summary-table__stack-row">
                                              <span
                                                classList={{
                                                  'summary-table__cell': true,
                                                  'summary-table__cell--yes': true,
                                                  'summary-table__cell--mini': true,
                                                }}
                                              >
                                                {summaryCellMark(1)}
                                              </span>
                                              <span class="summary-table__stack-names">
                                                {row.allGroups.yes.join(', ')}
                                              </span>
                                            </div>
                                          </Show>
                                          <Show when={row.allGroups.maybe.length > 0}>
                                            <div class="summary-table__stack-row">
                                              <span
                                                classList={{
                                                  'summary-table__cell': true,
                                                  'summary-table__cell--maybe': true,
                                                  'summary-table__cell--mini': true,
                                                }}
                                              >
                                                {summaryCellMark(2)}
                                              </span>
                                              <span class="summary-table__stack-names">
                                                {row.allGroups.maybe.join(', ')}
                                              </span>
                                            </div>
                                          </Show>
                                          <Show when={row.allGroups.no.length > 0}>
                                            <div class="summary-table__stack-row">
                                              <span
                                                classList={{
                                                  'summary-table__cell': true,
                                                  'summary-table__cell--no': true,
                                                  'summary-table__cell--mini': true,
                                                }}
                                              />
                                              <span class="summary-table__stack-names">
                                                {row.allGroups.no.join(', ')}
                                              </span>
                                            </div>
                                          </Show>
                                        </div>
                                      </td>
                                      <td class="summary-table__action">
                                        <Win95Button size="small" onClick={() => openConfirm(row.day, row.time)}>
                                          <span class="hk">C</span>onfirm
                                        </Win95Button>
                                      </td>
                                    </tr>
                                  )
                                }}
                              </For>
                            </tbody>
                          </table>
                          <div class="summary-table__footer">
                            Pick a row and confirm the final time.
                          </div>
                        </div>
                      </Show>
                    </Show>
                  </GridAccordion>

                </div>
              </div>
            </div>
            {/* /panels */}

            {/* Function bar */}
            <div class="grid-view__function-bar">
              <button type="button" class="grid-view__function-item" onClick={doUndo}>
                <span class="grid-view__function-key">F1</span> <span class="hk">U</span>ndo
              </button>
              <button
                type="button"
                class="grid-view__function-item"
                onClick={() => openConfirm(null, null)}
              >
                <span class="grid-view__function-key">F5</span> <span class="hk">C</span>onfirm
              </button>
            </div>
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
          {/* /grid-view__window-body */}
        </div>
        {/* /grid-view__window */}

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
              <b>1.</b> Click <b>Switch...</b> and pick your participant name
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
              <span class="help__key-line">F1 / U — Undo</span>
              <br />
              <span class="help__key-line">F3 / S — Focus share link</span>
              <br />
              <span class="help__key-line">Ctrl+Z — Undo</span>
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
      </Show>
    </div>
  )
}
