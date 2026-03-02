import { createSignal, createMemo, createEffect, onMount, onCleanup, For, Show } from 'solid-js'
import { createStore, reconcile } from 'solid-js/store'
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

export default function Grid(props: Props) {
  const [event, setEvent] = createSignal<AppEvent | null>(null)
  const [localReady, setLocalReady] = createSignal(false)
  const [loadError, setLoadError] = createSignal<'none' | 'not-found' | 'network'>('none')
  const [newParticipantName, setNewParticipantName] = createSignal('')

  const days = createMemo(() => {
    const ev = event()
    if (!ev) return []
    return ev.dates.map((ds) => ({ key: ds, label: formatDateLabel(ds) }))
  })

  const times = createMemo(() => {
    const ev = event()
    if (!ev) return []
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
      if (p.name === cur) return
      result[p.name] = flatToRecord(p.slots, ev.dates, spd)
    })
    return result
  })

  const participantList = createMemo(() => {
    const ev = event()
    if (!ev) return []
    return ev.participants.map((p) => ({ key: p.name, label: p.name }))
  })

  const [editCollapsed, setEditCollapsed] = createSignal(false)
  const [bestCollapsed, setBestCollapsed] = createSignal(false)
  const [groupCollapsed, setGroupCollapsed] = createSignal(false)

  type ActiveModal = null | 'name-picker' | 'help' | 'confirm'
  const [activeModal, setActiveModal] = createSignal<ActiveModal>('name-picker')
  const [confirmDay, setConfirmDay] = createSignal('')
  const [confirmTime, setConfirmTime] = createSignal('')
  const [statusFlash, setStatusFlash] = createSignal('')
  const [shareCollapsed, setShareCollapsed] = createSignal(false)
  const [copyStatus, setCopyStatus] = createSignal('')

  let undoStack: UndoEntry[][] = []
  let statusTimer: ReturnType<typeof setTimeout> | null = null
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
  function heat(dk: string, ti: number) {
    let c = 0
    const m = myState[dk]?.[ti] ?? 0
    if (m === 1) c += 1
    else if (m === 2) c += 0.5
    Object.values(others()).forEach((p) => {
      const v = p[dk]?.[ti] ?? 0
      if (v === 1) c += 1
      else if (v === 2) c += 0.5
    })
    return Math.round(c)
  }

  function slotContributorCount(dk: string, ti: number) {
    let count = 0
    if ((myState[dk]?.[ti] ?? 0) > 0) count += 1
    Object.values(others()).forEach((p) => {
      if ((p[dk]?.[ti] ?? 0) > 0) count += 1
    })
    return count
  }

  const bestTimes = createMemo(() => {
    const d = days()
    const t = times()
    const slots: { day: string; time: string; score: number; dk: string; ti: number }[] = []
    d.forEach((day) =>
      t.forEach((slot, ti) => {
        const h = heat(day.key, ti)
        const contributors = slotContributorCount(day.key, ti)
        if (h > 0 && contributors >= 2)
          slots.push({ day: day.label, time: slot.label, score: h, dk: day.key, ti })
      }),
    )
    slots.sort((a, b) => b.score - a.score)
    return slots.slice(0, 3)
  })

  const totalParticipants = createMemo(() => event()?.participants.length ?? 0)
  const participantsWithAvailability = createMemo(() => {
    const ev = event()
    if (!ev) return 0
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
      if (!lp) return rp
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
    if (!ev || ev.id !== eventId) return
    const idx = ev.participants.findIndex((p) => p.name === participantName)
    if (idx === -1) return
    const currentVersion = ev.participants[idx].version ?? 0
    if (currentVersion > version) return
    const currentUpdated = ev.participants[idx].updatedAt ?? 0
    if (currentVersion === version && currentUpdated >= updatedAt) return
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
    if (!ev || !currentName()) return
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
    if (isConfirmed()) return
    const prev = myState[dk]?.[ti] ?? 0
    const next = (prev + 1) % 3
    if (prev === next) return
    undoStack.push([{ dk, ti, prev }])
    setMyState(dk, ti, next)
    if (navigator.vibrate) navigator.vibrate(10)
    schedulePersist()
  }

  function doUndo() {
    if (isConfirmed()) return
    if (!undoStack.length) return
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
    if (!ev) return
    const day = days().find((d) => d.label === confirmDay())
    const time = times().find((t) => t.label === confirmTime())
    if (!day || !time) return
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
    flashStatus('Confirmed time updated')
    setActiveModal(null)
  }

  function undoConfirmedTime() {
    const ev = event()
    if (!ev) return
    const updated: AppEvent = { ...ev, status: 'open', confirmedSlot: undefined }
    void saveEvent(updated)
    void queueEventSync(updated)
    void flushPendingSync()
    setEvent(updated)
    flashStatus('Confirmation removed')
  }

  function closeOpenDialog() {
    if (activeModal() === 'name-picker' && !event()) {
      goToLanding()
      return
    }
    if (activeModal()) setActiveModal(null)
  }

  function flashStatus(message: string) {
    setStatusFlash(message)
    if (statusTimer) clearTimeout(statusTimer)
    statusTimer = setTimeout(() => setStatusFlash(''), 2000)
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
      flashStatus('Link copied to clipboard')
    } else {
      setCopyStatus('Select and press Command+C')
    }
  }

  const createdByName = createMemo(() => event()?.participants[0]?.name ?? 'Unknown')
  const currentTimezone = createMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone)

  const confirmedInfo = createMemo(() => {
    const ev = event()
    if (!ev || ev.status !== 'confirmed' || !ev.confirmedSlot) return null
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
    if (!info) return ''
    return `${info.dayLabel} ${info.start} (${currentTimezone()})`
  })
  const participantsLine = createMemo(() => {
    const ev = event()
    if (!ev) return ''
    return ev.participants.map((p) => p.name).join(', ')
  })
  const summaryDetailsText = createMemo(() => {
    const ev = event()
    const info = confirmedInfo()
    if (!ev || !info) return ''
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
    if (!summary) return
    try {
      await navigator.clipboard.writeText(summary)
      flashStatus('Summary copied')
    } catch {
      flashStatus('Copy failed')
    }
  }

  function downloadIcs() {
    const info = confirmedInfo()
    const ev = event()
    if (!info || !ev) return
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
    if (!ev) return
    const now = Date.now()
    const idx = ev.participants.findIndex((p) => p.name === name)
    if (idx === -1) return
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
    if (!trimmed) return
    const ev = event()
    if (!ev || ev.participants.length >= ev.maxParticipants) return

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

  const currentLabel = createMemo(
    () => participantList().find((p) => p.key === currentName())?.label ?? currentName(),
  )

  const eventUrl = createMemo(() => `${window.location.origin}/e/${props.eventId}`)
  const heatmapView = createMemo(() => {
    const d = days()
    const t = times()
    const values = t.map((_, ti) => d.map((day) => heat(day.key, ti)))
    if (d.length === 0 || t.length === 0) return { days: d, times: t, values }

    let minRow = t.length
    let maxRow = -1
    let minCol = d.length
    let maxCol = -1

    values.forEach((row, ri) => {
      row.forEach((value, ci) => {
        if (value <= 0) return
        if (ri < minRow) minRow = ri
        if (ri > maxRow) maxRow = ri
        if (ci < minCol) minCol = ci
        if (ci > maxCol) maxCol = ci
      })
    })

    // Hide the heatmap entirely when everyone is completely unavailable.
    if (maxRow === -1 || maxCol === -1) return { days: [], times: [], values: [] as number[][] }

    return {
      days: d.slice(minCol, maxCol + 1),
      times: t.slice(minRow, maxRow + 1),
      values: values.slice(minRow, maxRow + 1).map((row) => row.slice(minCol, maxCol + 1)),
    }
  })
  const confirmDayOptions = createMemo(() =>
    days().map((d) => ({ value: d.label, label: d.label })),
  )
  const confirmTimeOptions = createMemo(() =>
    times().map((t) => ({ value: t.label, label: t.label })),
  )
  const statusLeft = createMemo(() => {
    if (statusFlash()) return statusFlash()
    const parts = [currentName() ? `Editing: ${currentLabel()}` : 'No participants yet']
    if (confirmedInfo())
      parts.push(`Confirmed | ${confirmedInfo()!.dayLabel} ${confirmedInfo()!.start}`)
    return parts.join(' | ')
  })

  createEffect(() => {
    if (!isConfirmed() && !activeModal()) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    onCleanup(() => {
      document.body.style.overflow = prevOverflow
    })
  })

  // Global event listeners + initial load
  onMount(() => {
    const disconnectSocket = connectEventSocket(props.eventId, {
      onEventUpdated: (remote) => {
        void applyRemoteEvent(remote)
      },
      onParticipantUpdated: (eventId, participantName, slots, updatedAt, version) => {
        void applyRemoteParticipantUpdate(eventId, participantName, slots, updatedAt, version)
      },
    })

    const onOnline = () => {
      void flushPendingSync()
      if (!event()) void retryLoadFromWorker()
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void flushPendingSync()
        void pullRemoteEvent(props.eventId)
          .then((remote) => {
            if (remote) void applyRemoteEvent(remote)
          })
          .catch(() => {})
      }
    }
    const pollId = window.setInterval(() => {
      if (!navigator.onLine) return
      void pullRemoteEvent(props.eventId)
        .then((remote) => {
          if (remote) void applyRemoteEvent(remote)
        })
        .catch(() => {})
      void flushPendingSync()
    }, 15000)
    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisibilityChange)

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

    document.addEventListener('keydown', onKeyDown)

    onCleanup(() => {
      disconnectSocket()
      window.clearInterval(pollId)
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      document.removeEventListener('keydown', onKeyDown)
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

  const RANKS = ['1.', '2.', '3.']
  const loadingOverlayText = createMemo(() => {
    if (loadError() === 'network') return 'Could not reach server to load this event.'
    if (loadError() === 'not-found') return 'Event not found in local cache or on server.'
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
                  <label for="share-link" class="share-panel__label">Event link:</label>
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
                      <span class="hk">C</span>opy link
                    </Win95Button>
                  </div>
                  <div class="copy-status" aria-live="polite">{copyStatus()}</div>
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
                      {(d) => (
                        <div class="availability-grid__day">{d.label}</div>
                      )}
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
                  title={
                    <>
                      Suggestions · {participantsWithAvailability()}/{totalParticipants()} shared
                      availability
                    </>
                  }
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
                      when={bestTimes().length > 0}
                      fallback={
                        <div class="empty-text grid-view__panel-content--title-aligned">
                          No suggested times yet
                        </div>
                      }
                    >
                      <div class="results">
                        <For each={bestTimes()}>
                          {(slot, i) => {
                            const myVal = () => myState[slot.dk]?.[slot.ti] ?? 0
                            const breakdown = () => {
                              const parts: string[] = []
                              if (myVal() === 1)
                                parts.push(
                                  '<span class="results__tag results__tag--yes">✔ You</span>',
                                )
                              else if (myVal() === 2)
                                parts.push(
                                  '<span class="results__tag results__tag--maybe"><span class="results__maybe-mark">?</span> You</span>',
                                )
                              Object.entries(others()).forEach(([name, data]) => {
                                const v = data[slot.dk]?.[slot.ti] ?? 0
                                const n = name.charAt(0).toUpperCase() + name.slice(1)
                                if (v === 1)
                                  parts.push(
                                    `<span class="results__tag results__tag--yes">✔ ${n}</span>`,
                                  )
                                else if (v === 2)
                                  parts.push(
                                    `<span class="results__tag results__tag--maybe"><span class="results__maybe-mark">?</span> ${n}</span>`,
                                  )
                              })
                              return parts.join(' · ')
                            }
                            return (
                              <div
                                classList={{
                                  results__row: true,
                                  'results__row--best': i() === 0,
                                }}
                              >
                                <div class="results__main">
                                  <div class="results__line">
                                    <span class="results__rank">{RANKS[i()]}</span>{' '}
                                    <b>
                                      {slot.day} {slot.time}
                                    </b>{' '}
                                    · {slot.score}/{totalParticipants()}
                                  </div>
                                  <div class="results__breakdown" innerHTML={breakdown()} />
                                </div>
                                <Win95Button
                                  size="small"
                                  class="dialog-btn results__confirm-btn"
                                  onClick={() => openConfirm(slot.day, slot.time)}
                                >
                                  <span class="hk">C</span>onfirm
                                </Win95Button>
                              </div>
                            )
                          }}
                        </For>
                        <div class="results__custom">
                          <Win95Button
                            class="dialog-btn results__custom-btn"
                            onClick={() => openConfirm(null, null)}
                          >
                            Pick a different time...
                          </Win95Button>
                        </div>
                      </div>
                    </Show>
                  </Show>
                </GridAccordion>

                {/* Group heatmap sub-panel */}
                <GridAccordion
                  id="group"
                  title="Group availability"
                  collapsed={groupCollapsed()}
                  onToggle={() => setGroupCollapsed(!groupCollapsed())}
                  spaced
                >
                  <Show
                    when={heatmapView().days.length > 0 && heatmapView().times.length > 0}
                    fallback={
                      <div class="empty-text grid-view__panel-content--title-aligned">
                        Group availability will appear after someone marks a slot.
                      </div>
                    }
                  >
                    <div
                      class="heatmap-grid"
                      style={{
                        '--days': String(
                          Math.min(Math.max(heatmapView().days.length, 1), 7),
                        ),
                      }}
                    >
                      <div class="heatmap-grid__corner" />
                      <For each={heatmapView().days}>
                        {(d) => (
                          <div class="heatmap-grid__day">{d.label}</div>
                        )}
                      </For>
                      <For each={heatmapView().times}>
                        {(t, ti) => (
                          <>
                            <div class="heatmap-grid__time">{t.label}</div>
                            <For each={heatmapView().days}>
                              {(_, di) => {
                                const h = () => heatmapView().values[ti()]?.[di()] ?? 0
                                return (
                                  <div
                                    classList={{
                                      'heatmap-grid__cell': true,
                                      'heatmap-grid__cell--0': h() === 0,
                                      'heatmap-grid__cell--1': h() === 1,
                                      'heatmap-grid__cell--2': h() === 2,
                                      'heatmap-grid__cell--3': h() >= 3,
                                      'heatmap-grid__cell--first-row': ti() === 0,
                                      'heatmap-grid__cell--first-col': di() === 0,
                                    }}
                                  >
                                    <span class="heatmap-grid__value">
                                      {h() > 0 ? h() : ''}
                                    </span>
                                  </div>
                                )
                              }}
                            </For>
                          </>
                        )}
                      </For>
                    </div>
                  </Show>
                </GridAccordion>
              </div>
            </div>
          </div>
          {/* /panels */}

          {/* Status bar */}
          <div class="grid-view__status-bar row">
            <div class="grid-view__status-segment st">{statusLeft()}</div>
            <div class="grid-view__status-segment st">timesweeper.app</div>
          </div>

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
                    <Win95Button class="grid-view__confirmed-undo-btn" onClick={undoConfirmedTime}>
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
              <label class="participant-picker__label" for="new-participant-name">I'm not in the list</label>
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
        <Win95Dialog title="Help — TimeSweeper" class="dialog--help" bodyClass="dialog-body--help" onClose={() => setActiveModal(null)}>
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
            <b>3.</b> Check "Group availability" to see when everyone is free
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
          <label class="confirm__label" for="confirm-day">Day:</label>
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
          <label class="confirm__label" for="confirm-time">Time:</label>
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
