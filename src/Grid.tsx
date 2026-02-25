import { createSignal, createMemo, createEffect, onMount, onCleanup, For, Show } from 'solid-js'
import { createStore, reconcile } from 'solid-js/store'
import {
  getEvent,
  getSelectedParticipant,
  saveEvent,
  setSelectedParticipant,
  updateParticipantSlots,
} from './db'
import Win95Field from './components/Win95Field'
import Win95Button from './components/Win95Button'
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

type UndoEntry = { dk: string; ti: number; prev: number }

export default function Grid(props: Props) {
  const [event, setEvent] = createSignal<AppEvent | null>(null)
  const [isLoading, setIsLoading] = createSignal(true)
  const [showNamePicker, setShowNamePicker] = createSignal(false)
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

  type Dialog = null | 'share' | 'help' | 'confirm'
  const [dialog, setDialog] = createSignal<Dialog>(null)
  const [confirmDay, setConfirmDay] = createSignal('')
  const [confirmTime, setConfirmTime] = createSignal('')
  const [statusFlash, setStatusFlash] = createSignal('')
  const [copyStatus, setCopyStatus] = createSignal('')

  // Non-reactive drag state
  let dragging = false
  let dragTargetState = 0
  let draggedCells = new Set<string>()
  let dragUndoBatch: UndoEntry[] = []
  let undoStack: UndoEntry[][] = []
  let statusTimer: ReturnType<typeof setTimeout> | null = null
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

  const bestTimes = createMemo(() => {
    const d = days()
    const t = times()
    const slots: { day: string; time: string; score: number; dk: string; ti: number }[] = []
    d.forEach((day) =>
      t.forEach((slot, ti) => {
        const h = heat(day.key, ti)
        if (h > 0) slots.push({ day: day.label, time: slot.label, score: h, dk: day.key, ti })
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

  async function persistCurrentSlots() {
    const ev = event()
    if (!ev || !currentName()) return
    const spd = slotsPerDay(ev)
    const flat = recordToFlat(myState, ev.dates, spd)
    await updateParticipantSlots(ev.id, currentName(), flat, Date.now())
  }

  function dragStart(dk: string, ti: number) {
    dragging = true
    draggedCells = new Set()
    dragUndoBatch = []
    const prev = myState[dk]?.[ti] ?? 0
    dragTargetState = (prev + 1) % 3
    dragUndoBatch.push({ dk, ti, prev })
    setMyState(dk, ti, dragTargetState)
    draggedCells.add(`${dk}-${ti}`)
    if (navigator.vibrate) navigator.vibrate(10)
  }

  function dragOver(dk: string, ti: number) {
    const key = `${dk}-${ti}`
    if (draggedCells.has(key)) return
    const prev = myState[dk]?.[ti] ?? 0
    dragUndoBatch.push({ dk, ti, prev })
    setMyState(dk, ti, dragTargetState)
    draggedCells.add(key)
    if (navigator.vibrate) navigator.vibrate(5)
  }

  function dragEnd() {
    if (!dragging) return
    dragging = false
    if (dragUndoBatch.length > 0) undoStack.push([...dragUndoBatch])
    dragUndoBatch = []
    draggedCells = new Set()
    persistCurrentSlots()
  }

  function doUndo() {
    if (!undoStack.length) return
    const batch = undoStack.pop()!
    batch.forEach((u) => setMyState(u.dk, u.ti, u.prev))
    persistCurrentSlots()
  }

  function openConfirm(day: string | null, time: string | null) {
    setConfirmDay(day ?? days()[0]?.label ?? '')
    setConfirmTime(time ?? times()[0]?.label ?? '')
    setDialog('confirm')
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
    setEvent(updated)
    flashStatus('Confirmed time updated')
    setDialog(null)
  }

  function undoConfirmedTime() {
    const ev = event()
    if (!ev) return
    const updated: AppEvent = { ...ev, status: 'open', confirmedSlot: undefined }
    void saveEvent(updated)
    setEvent(updated)
    flashStatus('Confirmation removed')
  }

  function closeOpenDialog() {
    if (showNamePicker()) {
      setShowNamePicker(false)
      return
    }
    if (dialog()) setDialog(null)
  }

  function flashStatus(message: string) {
    setStatusFlash(message)
    if (statusTimer) clearTimeout(statusTimer)
    statusTimer = setTimeout(() => setStatusFlash(''), 2000)
  }

  function openShareDialog() {
    setCopyStatus('')
    setDialog('share')
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

  const currentParticipant = createMemo(() =>
    event()?.participants.find((p) => p.name === currentName()),
  )
  const currentTimezone = createMemo(
    () => currentParticipant()?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
  )

  const confirmedInfo = createMemo(() => {
    const ev = event()
    if (!ev || ev.status !== 'confirmed' || !ev.confirmedSlot) return null
    const dayLabel = formatDateLabel(ev.confirmedSlot.date)
    const start = times().find((t) => t.value === ev.confirmedSlot!.startTime)?.label ?? ev.confirmedSlot.startTime
    return {
      dayLabel,
      start,
      slot: ev.confirmedSlot,
    }
  })

  const confirmedSummary = createMemo(() => {
    const info = confirmedInfo()
    if (!info) return ''
    return `Confirmed: ${info.dayLabel} ${info.start}`
  })

  async function copyConfirmedSummary() {
    const summary = confirmedSummary()
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
    const payload = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//TimeSweeper//EN',
      'BEGIN:VEVENT',
      `UID:${ev.id}@timesweeper.app`,
      `DTSTAMP:${toUtcStamp(info.slot.date, info.slot.startTime)}`,
      `DTSTART:${dtStart}`,
      `DTEND:${dtEnd}`,
      `SUMMARY:${ev.name}`,
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
    setShowNamePicker(false)
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
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      slots: new Array(ev.dates.length * spd).fill(0) as SlotValue[],
      visitedAt: Date.now(),
      updatedAt: null,
    }
    const updated: AppEvent = { ...ev, participants: [...ev.participants, newP] }
    await saveEvent(updated)
    await setSelectedParticipant(updated.id, trimmed)
    setEvent(updated)
    loadParticipantSlots(updated, trimmed)
    setCurrentName(trimmed)
    setNewParticipantName('')
    setShowNamePicker(false)
  }

  const currentLabel = createMemo(
    () => participantList().find((p) => p.key === currentName())?.label ?? currentName(),
  )

  const eventUrl = createMemo(() => `${window.location.origin}/e/${props.eventId}`)
  const dayCountClass = createMemo(() => `grid-table--days-${Math.min(Math.max(days().length, 1), 7)}`)
  const heatmapDayCountClass = createMemo(
    () => `heatmap-grid--days-${Math.min(Math.max(days().length, 1), 7)}`,
  )
  const confirmDayOptions = createMemo(() => days().map((d) => ({ value: d.label, label: d.label })))
  const confirmTimeOptions = createMemo(() =>
    times().map((t) => ({ value: t.label, label: t.label })),
  )
  const statusLeft = createMemo(() => {
    if (statusFlash()) return statusFlash()
    const parts = [currentName() ? `Editing: ${currentLabel()}` : 'No participants yet']
    if (confirmedInfo()) parts.push(`Confirmed | ${confirmedInfo()!.dayLabel} ${confirmedInfo()!.start}`)
    return parts.join(' | ')
  })

  createEffect(() => {
    if (dialog() !== 'share') return
    queueMicrotask(() => {
      shareInputRef.focus()
      shareInputRef.select()
    })
  })

  // Global event listeners + initial load
  onMount(async () => {
    const ev = await getEvent(props.eventId)
    if (ev) {
      setEvent(ev)
      const savedName = await getSelectedParticipant(ev.id)
      const exists = savedName ? ev.participants.some((p) => p.name === savedName) : false
      if (savedName && exists) {
        loadParticipantSlots(ev, savedName)
        setCurrentName(savedName)
        setShowNamePicker(false)
      } else {
        setShowNamePicker(true)
      }
    }
    setIsLoading(false)

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
        openShareDialog()
      }
      if (e.key === 'F3') {
        e.preventDefault()
        openShareDialog()
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

    const onTouchMove = (e: TouchEvent) => {
      if (!dragging) return
      e.preventDefault()
      const touch = e.touches[0]
      const el = document.elementFromPoint(touch.clientX, touch.clientY) as HTMLElement | null
      if (el?.dataset.day) dragOver(el.dataset.day, parseInt(el.dataset.ti!))
    }

    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('mouseup', dragEnd)
    document.addEventListener('mouseleave', dragEnd)
    document.addEventListener('touchmove', onTouchMove, { passive: false })
    document.addEventListener('touchend', dragEnd)
    document.addEventListener('touchcancel', dragEnd)

    onCleanup(() => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('mouseup', dragEnd)
      document.removeEventListener('mouseleave', dragEnd)
      document.removeEventListener('touchmove', onTouchMove)
      document.removeEventListener('touchend', dragEnd)
      document.removeEventListener('touchcancel', dragEnd)
    })
  })

  const RANKS = ['1.', '2.', '3.']

  return (
    <div class="grid-view">
      <Show when={!isLoading()} fallback={<div class="grid-view__loading">Loading...</div>}>
        <Show
          when={event()}
          fallback={<div class="grid-view__loading">Event not found on this device.</div>}
        >
        <div class="grid-view__window r">
          {/* Title bar */}
          <div class="win95-window__title-bar">
            <span class="grid-view__title">
              <MineIcon size={16} /> TimeSweeper — {event()!.name}
            </span>
            <div class="win95-window__title-buttons">
              <div class="win95-window__title-button r" onClick={goToLanding}>
                ×
              </div>
            </div>
          </div>

          <div class="grid-view__window-body">
            {/* Minesweeper-style control deck */}
            <div class="grid-view__deck s">
              <div class="grid-view__deck-left">
                <div class="grid-view__deck-display">
                  Hi <span class="grid-controls__name">{currentName() || 'there'}</span>!
                </div>
                <Win95Button class="grid-view__deck-modify" onClick={() => setShowNamePicker(true)}>
                  Switch...
                </Win95Button>
              </div>
              <div class="grid-view__deck-actions">
                <Win95Button class="grid-view__deck-share" onClick={openShareDialog}>
                  <span class="hk">S</span>hare
                </Win95Button>
                <Win95Button class="grid-view__deck-help" onClick={() => setDialog('help')}>
                  <span class="hk">H</span>elp
                </Win95Button>
              </div>
            </div>
            {/* Two-panel layout */}
            <div class="grid-view__panels">
              {/* Panel: Your availability */}
              <div class="grid-view__panel">
                <div class="grid-view__panel-frame s">
                  <div class="grid-view__panel-header" onClick={() => setEditCollapsed(!editCollapsed())}>
                    <div class="grid-view__panel-toggle">{editCollapsed() ? '▸' : '▾'}</div>
                    <span>Your availability ({currentTimezone()})</span>
                    <hr />
                  </div>
                  <Show when={!editCollapsed()}>
                    <div class="grid-view__panel-body">
                      <div class="grid-view__legend">
                        <AvailabilityLegend withLabels />
                      </div>
                      <div class={`availability-grid ${dayCountClass()}`}>
                        <div class="availability-grid__corner" />
                        <For each={days()}>{(d) => <div class="availability-grid__day">{d.label}</div>}</For>
                        <For each={times()}>
                          {(t, ti) => (
                            <>
                              <div class="availability-grid__time">{t.label}</div>
                              <For each={days()}>
                                {(d) => (
                                  <div
                                    classList={{
                                      "availability-grid__cell": true,
                                      "availability-grid__cell--yes": myState[d.key]?.[ti()] === 1,
                                      "availability-grid__cell--maybe": myState[d.key]?.[ti()] === 2,
                                    }}
                                    onMouseDown={(e) => {
                                      e.preventDefault()
                                      dragStart(d.key, ti())
                                    }}
                                    onMouseEnter={() => {
                                      if (dragging) dragOver(d.key, ti())
                                    }}
                                    onTouchStart={(e) => {
                                      e.preventDefault()
                                      dragStart(d.key, ti())
                                    }}
                                    data-day={d.key}
                                    data-ti={String(ti())}
                                  >
                                    <Show when={myState[d.key]?.[ti()] === 1}>
                                      <span class="availability-grid__icon">✔</span>
                                    </Show>
                                    <Show when={myState[d.key]?.[ti()] === 2}>
                                      <span class="availability-grid__icon">?</span>
                                    </Show>
                                  </div>
                                )}
                              </For>
                            </>
                          )}
                        </For>
                      </div>
                    </div>
                  </Show>
                </div>
              </div>

              {/* Panel: Results + Group heatmap */}
              <div class="grid-view__panel">
                <div class="grid-view__panel-frame s">
                  {/* Results sub-panel */}
                  <div class="grid-view__panel-header" onClick={() => setBestCollapsed(!bestCollapsed())}>
                    <div class="grid-view__panel-toggle">{bestCollapsed() ? '▸' : '▾'}</div>
                    <span>
                      Suggestions · {participantsWithAvailability()}/{totalParticipants()} shared availability
                    </span>
                    <hr />
                  </div>
                  <Show when={!bestCollapsed()}>
                    <div class="grid-view__panel-body">
                      <Show when={confirmedInfo()}>
                        <div class="confirmed-box s">
                          <div class="confirmed-box__title">Confirmed time</div>
                          <div class="confirmed-box__line">{confirmedSummary()}</div>
                          <div class="confirmed-box__actions">
                            <Win95Button onClick={downloadIcs}>Download .ics</Win95Button>
                            <Win95Button onClick={copyConfirmedSummary}>Copy summary</Win95Button>
                            <Win95Button onClick={undoConfirmedTime}>Undo</Win95Button>
                          </div>
                        </div>
                      </Show>
                      <Show
                        when={canShowSuggestions()}
                        fallback={
                          <div class="results__empty">
                            Not enough participants yet to suggest times.
                          </div>
                        }
                      >
                        <Show
                          when={bestTimes().length > 0}
                          fallback={<div class="results__empty">No suggested times yet</div>}
                        >
                          <div class="results">
                            <For each={bestTimes()}>
                              {(slot, i) => {
                                const myVal = () => myState[slot.dk]?.[slot.ti] ?? 0
                                const breakdown = () => {
                                  const parts: string[] = []
                                  if (myVal() === 1)
                                    parts.push('<span class="results__tag results__tag--yes">✔ You</span>')
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
                                    classList={{ 'results__row': true, 'results__row--best': i() === 0 }}
                                  >
                                    <div class="results__main">
                                    <div class="results__line">
                                        <span class="results__rank">{RANKS[i()]}</span>{' '}
                                        <b>
                                          {slot.day} {slot.time}
                                        </b>{' '}
                                        · {slot.score}/{totalParticipants()}
                                      </div>
                                      <div
                                        class="results__breakdown"
                                        innerHTML={breakdown()}
                                      />
                                    </div>
                                    <div
                                      class="dialog-btn r"
                                      classList={{ 'results__confirm-btn': true }}
                                      onClick={() => openConfirm(slot.day, slot.time)}
                                    >
                                      <span class="hk">C</span>onfirm
                                    </div>
                                  </div>
                                )
                              }}
                            </For>
                            <div class="results__custom">
                              <div
                                class="dialog-btn r"
                                classList={{ 'results__custom-btn': true }}
                                onClick={() => openConfirm(null, null)}
                              >
                                Pick a different time...
                              </div>
                            </div>
                          </div>
                        </Show>
                      </Show>
                    </div>
                  </Show>

                  {/* Group heatmap sub-panel */}
                  <div
                    class="grid-view__panel-header"
                    classList={{ 'grid-view__panel-header--spaced': true }}
                    onClick={() => setGroupCollapsed(!groupCollapsed())}
                  >
                    <div class="grid-view__panel-toggle">{groupCollapsed() ? '▸' : '▾'}</div>
                    <span>Group availability</span>
                    <hr />
                  </div>
                  <Show when={!groupCollapsed()}>
                    <div class="grid-view__panel-body">
                      <div class="heatmap-legend">
                        <span>
                          <span class="heatmap-legend__swatch heatmap-legend__swatch--0" />0
                        </span>
                        <span>
                          <span class="heatmap-legend__swatch heatmap-legend__swatch--1" />
                          <b class="heatmap-legend__value heatmap-legend__value--1">1</b>
                        </span>
                        <span>
                          <span class="heatmap-legend__swatch heatmap-legend__swatch--2" />
                          <b class="heatmap-legend__value heatmap-legend__value--2">2</b>
                        </span>
                        <span>
                          <span class="heatmap-legend__swatch heatmap-legend__swatch--3" />
                          <b class="heatmap-legend__value heatmap-legend__value--3">3</b>
                        </span>
                      </div>
                      <div class={`heatmap-grid ${heatmapDayCountClass()}`}>
                        <div class="heatmap-grid__corner" />
                        <For each={days()}>{(d) => <div class="heatmap-grid__day">{d.label}</div>}</For>
                        <For each={times()}>
                          {(t, ti) => (
                            <>
                              <div class="heatmap-grid__time">{t.label}</div>
                              <For each={days()}>
                                {(d) => {
                                  const h = () => heat(d.key, ti())
                                  return (
                                    <div
                                      classList={{
                                        "heatmap-grid__cell": true,
                                        "heatmap-grid__cell--0": h() === 0,
                                        "heatmap-grid__cell--1": h() === 1,
                                        "heatmap-grid__cell--2": h() === 2,
                                        "heatmap-grid__cell--3": h() >= 3,
                                      }}
                                    >
                                      <span
                                        class={`heatmap-grid__value heatmap-grid__value--${Math.min(h(), 5)}`}
                                      >
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
                    </div>
                  </Show>
                </div>
              </div>
            </div>
            {/* /panels */}

            {/* Status bar */}
            <div class="grid-view__status-bar">
              <div class="grid-view__status-segment st">{statusLeft()}</div>
              <div class="grid-view__status-segment st">timesweeper.app</div>
            </div>

            {/* Function bar */}
            <div class="grid-view__function-bar">
              <div class="grid-view__function-item" onClick={doUndo}>
                <span class="grid-view__function-key">F1</span> <span class="hk">U</span>ndo
              </div>
              <div class="grid-view__function-item" onClick={openShareDialog}>
                <span class="grid-view__function-key">F3</span> <span class="hk">S</span>hare
              </div>
              <div class="grid-view__function-item" onClick={() => openConfirm(null, null)}>
                <span class="grid-view__function-key">F5</span> <span class="hk">C</span>onfirm
              </div>
            </div>
          </div>
          {/* /grid-view__window-body */}
        </div>
        {/* /grid-view__window */}

        {/* === DIALOGS === */}

        <Show when={showNamePicker()}>
          <div class="dialog-overlay">
            <div class="dialog dialog--name-picker r">
              <div class="win95-window__title-bar">
                <span>Choose participant</span>
                <div class="win95-window__title-buttons">
                  <div class="win95-window__title-button r" onClick={() => setShowNamePicker(false)}>
                    ×
                  </div>
                </div>
              </div>
              <div class="dialog-body">
                <p class="participant-picker__lead">Choose your participant name to start editing availability.</p>
                <div class="participant-picker__list">
                  <For each={event()!.participants}>
                    {(p) => (
                      <div
                        class="dialog-btn r participant-picker__item"
                        classList={{ 'participant-picker__item--selected': currentName() === p.name }}
                        onClick={() => selectParticipant(p.name)}
                      >
                        {p.name}
                      </div>
                    )}
                  </For>
                </div>
                <Show when={event()!.participants.length < event()!.maxParticipants}>
                  <label class="participant-picker__label">I'm not in the list</label>
                  <Win95Field
                    kind="input"
                    value={newParticipantName()}
                    placeholder="Participant name"
                    wrapperClass="dialog__field"
                    controlClass="dialog__control"
                    onInput={setNewParticipantName}
                  />
                  <div class="dialog-buttons">
                    <div class="dialog-btn r" onClick={addParticipantFromPicker}>
                      Add participant
                    </div>
                  </div>
                </Show>
              </div>
            </div>
          </div>
        </Show>

        <Show when={dialog() === 'share'}>
          <div class="dialog-overlay">
            <div class="dialog r">
              <div class="win95-window__title-bar">
                <span>Share Link</span>
                <div class="win95-window__title-buttons">
                  <div class="win95-window__title-button r" onClick={() => setDialog(null)}>
                    ×
                  </div>
                </div>
              </div>
              <div class="dialog-body">
                <label>Send this link to participants:</label>
                <Win95Field
                  kind="input"
                  type="url"
                  value={eventUrl()}
                  readOnly
                  wrapperClass="dialog__field"
                  controlClass="dialog__control"
                  inputRef={(el) => {
                    shareInputRef = el
                  }}
                  onClick={() => shareInputRef.select()}
                />
                <div class="dialog-buttons">
                  <div class="dialog-btn r" onClick={() => copyLink(eventUrl())}>
                    <span class="hk">C</span>opy
                  </div>
                  <div class="dialog-btn r" onClick={() => setDialog(null)}>
                    Close
                  </div>
                </div>
                <div class="copy-status">{copyStatus()}</div>
              </div>
            </div>
          </div>
        </Show>

        <Show when={dialog() === 'help'}>
          <div class="dialog-overlay">
            <div class="dialog dialog--help r">
              <div class="win95-window__title-bar">
                <span>Help — TimeSweeper</span>
                <div class="win95-window__title-buttons">
                  <div class="win95-window__title-button r" onClick={() => setDialog(null)}>
                    ×
                  </div>
                </div>
              </div>
              <div class="dialog-body dialog-body--help">
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
                  <b>3.</b> Click and drag to fill multiple cells at once
                </p>
                <p class="help__step">
                  <b>4.</b> Check "Group availability" to see when everyone is free
                </p>
                <p class="help__step">
                  <b>5.</b> Click <b>Share</b> to send the link to others
                </p>
                <p class="help__step help__step--last">
                  <b>6.</b> When the group agrees, click <b>Confirm</b>
                </p>
                <p class="help__keys">
                  <b>Keyboard shortcuts:</b>
                  <br />
                  <span class="help__key-line">F1 / U — Undo</span>
                  <br />
                  <span class="help__key-line">S — Share link</span>
                  <br />
                  <span class="help__key-line">Ctrl+Z — Undo</span>
                </p>
                <div class="dialog-buttons">
                  <div class="dialog-btn r" onClick={() => setDialog(null)}>
                    OK
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Show>

        <Show when={dialog() === 'confirm'}>
          <div class="dialog-overlay">
            <div class="dialog dialog--confirm r">
              <div class="win95-window__title-bar">
                <span>Confirm Time</span>
                <div class="win95-window__title-buttons">
                  <div class="win95-window__title-button r" onClick={() => setDialog(null)}>
                    ×
                  </div>
                </div>
              </div>
              <div class="dialog-body dialog-body--confirm">
                <p class="confirm__lead">Confirm this time for everyone?</p>
                <label class="confirm__label">Day:</label>
                <Win95Field
                  kind="select"
                  value={confirmDay()}
                  options={confirmDayOptions()}
                  wrapperClass="confirm__field confirm__field--day"
                  controlClass="confirm__control"
                  onChange={setConfirmDay}
                />
                <label class="confirm__label">Time:</label>
                <Win95Field
                  kind="select"
                  value={confirmTime()}
                  options={confirmTimeOptions()}
                  wrapperClass="confirm__field confirm__field--time"
                  controlClass="confirm__control"
                  onChange={setConfirmTime}
                />
                <p class="confirm__note">
                  Everyone will see the confirmed time.
                  <br />
                  This can be undone later.
                </p>
                <div class="dialog-buttons">
                  <div class="dialog-btn r" onClick={doConfirm}>
                    <span class="hk">C</span>onfirm
                  </div>
                  <div class="dialog-btn r" onClick={() => setDialog(null)}>
                    Cancel
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Show>
        </Show>
      </Show>
    </div>
  )
}
