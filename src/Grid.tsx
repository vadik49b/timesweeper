import { createSignal, createMemo, createEffect, onMount, onCleanup, For, Show } from 'solid-js'
import { makeEventListener } from '@solid-primitives/event-listener'
import { Title, Meta } from '@solidjs/meta'
import {
  closeEventStore,
  getEvent,
  getSelectedParticipantName,
  openEventStore,
  saveEvent,
  setSelectedParticipantName,
  subscribeEvent,
  updateParticipantSlots,
} from './db'
import Win95Field from './components/Win95Field'
import Win95Button from './components/Win95Button'
import Win95Dialog from './components/Win95Dialog'
import ErrorDialog from './components/ErrorDialog'
import AvailabilityLegend from './components/AvailabilityLegend'
import AvailabilityGrid from './components/AvailabilityGrid'
import ConfirmationSection, { type SummaryIntersectionTime } from './components/ConfirmationSection'
import ParticipantStatusList from './components/ParticipantStatusList'
import MineIcon from './icons/MineIcon'
import {
  type AppEvent,
  type SlotValue,
  type Participant,
  participantStatusSummary,
  slotsPerDay,
  computeTimeSlots,
  formatDateLabel,
  formatFullDateLabel,
  formatLongDateLabel,
  flatToRecord,
} from './event-helpers'

interface Props {
  eventId: string
}

type SummaryGroups = { yes: string[]; maybe: string[]; no: string[] }

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

  const [currentName, setCurrentName] = createSignal('')

  const myState = createMemo<Record<string, number[]>>(() => {
    const ev = event()
    const name = currentName()

    if (!ev || !name) {
      return {}
    }

    const participant = ev.participants.find((entry) => entry.name === name)

    if (!participant) {
      return {}
    }

    return flatToRecord(participant.slots, ev.dates, slotsPerDay(ev))
  })

  // Read-only slots for all other participants
  const others = createMemo(() => {
    const ev = event()

    if (!ev) {
      return {}
    }
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

  type ActiveModal = null | 'name-picker' | 'help' | 'confirm' | 'settings' | 'undo-confirm'
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
  const [copyStatus, setCopyStatus] = createSignal('')

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

  function getSlotIndex(ev: AppEvent, dayKey: string, timeIndex: number): number {
    const dayIndex = ev.dates.findIndex((date) => date === dayKey)

    if (dayIndex < 0) {
      return -1
    }

    return dayIndex * slotsPerDay(ev) + timeIndex
  }

  async function cycleCell(dk: string, ti: number) {
    if (isConfirmed()) {
      return
    }

    const ev = event()

    if (!ev) {
      return
    }

    const name = currentName()

    if (!name) {
      return
    }

    const participantIndex = ev.participants.findIndex((entry) => entry.name === name)

    if (participantIndex < 0) {
      return
    }

    const slotIndex = getSlotIndex(ev, dk, ti)

    if (slotIndex < 0) {
      return
    }

    const participant = ev.participants[participantIndex]
    const prev = participant.slots[slotIndex] ?? 0
    const next = (prev + 1) % 3

    if (prev === next) {
      return
    }

    const nextSlots = [...participant.slots]
    nextSlots[slotIndex] = next as SlotValue

    const updatedAt = Date.now()
    const nextVersion = (participant.version ?? 0) + 1
    await updateParticipantSlots(ev.id, name, nextSlots, updatedAt, nextVersion)

    const nextEvent: AppEvent = {
      ...ev,
      participants: ev.participants.map((entry, index) =>
        index === participantIndex
          ? {
              ...entry,
              slots: nextSlots,
              updatedAt,
              version: nextVersion,
            }
          : entry,
      ),
    }

    setEvent(nextEvent)

    if (navigator.vibrate) {
      navigator.vibrate(10)
    }
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
          ? ((myState()[dayKey]?.[timeIndex] ?? 0) as SlotValue)
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

  function openConfirm(day: string | null, time: string | null) {
    setConfirmCandidates(null)
    setConfirmDay(day ?? days()[0]?.label ?? '')
    setConfirmTime(time ?? times()[0]?.label ?? '')
    setActiveModal('confirm')
  }

  async function doConfirm() {
    const ev = event()

    if (!ev) {
      return
    }

    const confirmer = currentName().trim()

    if (!confirmer) {
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
      confirmedBy: confirmer,
      confirmedSlot: {
        date: day.key,
        startTime: time.value,
        endTime: addMinutes(time.value, 30),
      },
    }
    await saveEvent(updated)
    setEvent(updated)
    setActiveModal(null)
  }

  async function undoConfirmedTime() {
    const ev = event()

    if (!ev) {
      return
    }

    const updated: AppEvent = {
      ...ev,
      status: 'open',
      confirmedBy: undefined,
      confirmedSlot: undefined,
    }
    await saveEvent(updated)
    setEvent(updated)
    setActiveModal(null)
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

    const organizer = event()?.participants[0]?.name ?? 'Unknown'
    const exists =
      organizer.trim().toLowerCase() === trimmed.toLowerCase() ||
      settingsParticipantNames().some((name) => name.trim().toLowerCase() === trimmed.toLowerCase())

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

    const organizer = event()?.participants[0]?.name ?? 'Unknown'
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

    const existingByKey = new Map(
      ev.participants.map((participant) => [participant.name.toLowerCase(), participant]),
    )
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
      setDialogError('At least 2 participants are required.')

      return
    }

    await saveEvent(updated)
    await setSelectedParticipantName(updated.id, nextSelected)

    setEvent(updated)
    setCurrentName(nextSelected)
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

      if (document.execCommand) {
        copied = document.execCommand('copy')
      }
    }

    if (copied) {
      setCopyStatus('Copied to clipboard!')
    } else {
      setCopyStatus('Select and press Command+C')
    }
  }

  const confirmSlotPreview = createMemo<SummaryGroups>(() => {
    const day = days().find((entry) => entry.label === confirmDay())
    const timeIndex = times().findIndex((entry) => entry.label === confirmTime())

    if (!day || timeIndex < 0) {
      return emptySummaryGroups()
    }

    return peopleGroupsForSlot(day.key, timeIndex)
  })
  const introContext = createMemo(() => {
    const ev = event()

    if (!ev) {
      return 'Share the event link with anyone who needs to respond.'
    }

    const organizer = ev.participants[0]?.name ?? 'Unknown'
    const current = currentName().trim().toLowerCase()

    if (current && current === organizer.toLowerCase()) {
      return `You are organizing "${ev.name}" event.`
    }

    return `${organizer} is organizing "${ev.name}" event.`
  })
  const pageUrl = `${window.location.origin}/e/${encodeURIComponent(props.eventId)}`
  const pageImage = `${window.location.origin}/anti-tank-mine-logo.png`

  const confirmedInfo = createMemo(() => {
    const ev = event()

    if (!ev || ev.status !== 'confirmed' || !ev.confirmedSlot) {
      return null
    }

    const dayLabel = formatFullDateLabel(ev.confirmedSlot.date)
    const heroDayLabel = formatLongDateLabel(ev.confirmedSlot.date)
    const start =
      times().find((t) => t.value === ev.confirmedSlot!.startTime)?.label ??
      ev.confirmedSlot.startTime

    return {
      dayLabel,
      heroDayLabel,
      start,
      slot: ev.confirmedSlot,
    }
  })
  const isConfirmed = createMemo(() => !!confirmedInfo())
  const confirmedPeopleGroups = createMemo(() => {
    const ev = event()
    const info = confirmedInfo()

    if (!ev || !info) {
      return emptySummaryGroups()
    }

    const timeIndex = times().findIndex((time) => time.value === info.slot.startTime)

    if (timeIndex < 0) {
      return emptySummaryGroups()
    }

    return peopleGroupsForSlot(info.slot.date, timeIndex)
  })

  function summaryDetailsText() {
    const ev = event()
    const info = confirmedInfo()

    if (!ev || !info) {
      return ''
    }

    const end = times().find((t) => t.value === info.slot.endTime)?.label ?? info.slot.endTime
    const createdBy = ev.participants[0]?.name ?? 'Unknown'
    const people = ev.participants.map((participant) => participant.name).join(', ')
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone

    return [
      `Event: ${ev.name}`,
      `Created by: ${createdBy}`,
      `When: ${info.dayLabel} ${info.start}-${end} (${timezone})`,
      `Participants: ${people}`,
    ].join('\n')
  }

  async function copyConfirmedSummary() {
    const summary = summaryDetailsText()

    if (!summary) {
      return
    }

    try {
      await navigator.clipboard.writeText(summary)
    } catch {}
  }

  function downloadIcs() {
    const info = confirmedInfo()
    const ev = event()

    if (!info || !ev) {
      return
    }

    const dtStart = toUtcStamp(info.slot.date, info.slot.startTime)
    const dtEnd = toUtcStamp(info.slot.date, info.slot.endTime)
    const createdBy = ev.participants[0]?.name ?? 'Unknown'
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
    const people = ev.participants.map((participant) => participant.name).join(', ')
    const description = [
      `Event: ${ev.name}`,
      `Status: confirmed`,
      `Link: ${eventLink()}`,
      `Created by: ${createdBy}`,
      `When: ${info.dayLabel} ${info.start} (${timezone})`,
      `Participants (${ev.participants.length}): ${people}`,
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

    await setSelectedParticipantName(ev.id, name)
    setCurrentName(name)
    setActiveModal(null)
  }

  function selectParticipantSafely(name: string): void {
    selectParticipant(name).catch(() => {})
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
    await setSelectedParticipantName(updated.id, trimmed)
    setEvent(updated)
    setCurrentName(trimmed)
    setNewParticipantName('')
    setActiveModal(null)
  }

  async function initializeSelectedParticipant(ev: AppEvent) {
    const savedName = await getSelectedParticipantName(ev.id)
    const exists = savedName ? ev.participants.some((p) => p.name === savedName) : false

    if (savedName && exists) {
      setCurrentName(savedName)
      setActiveModal(null)
    } else {
      setActiveModal('name-picker')
    }
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
      ...ev.participants.map((participant) => ({
        value: participant.name,
        label: participant.name,
      })),
    ]
  })

  async function onParticipantPickerChange(name: string) {
    if (!name) {
      return
    }

    try {
      await selectParticipant(name)
    } catch {}
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
    let unsubscribe: (() => void) | null = null
    let isDisposed = false

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
      if (unsubscribe) {
        unsubscribe()
      }

      closeEventStore(props.eventId).catch((error) => {
        console.error('Failed to close event store', error)
      })

      isDisposed = true
    })

    const initialize = async () => {
      try {
        await openEventStore(props.eventId)

        if (isDisposed) {
          return
        }

        unsubscribe = await subscribeEvent(props.eventId, (next) => {
          if (next) {
            setEvent(next)
            setLoadError('none')

            return
          }

          setLoadError('not-found')
        })

        const initial = await getEvent(props.eventId)

        if (isDisposed) {
          return
        }

        if (initial) {
          setEvent(initial)
          await initializeSelectedParticipant(initial)
        } else {
          setLoadError('not-found')
        }
      } catch {
        setLoadError('network')
      } finally {
        setLocalReady(true)
      }
    }

    initialize().catch(() => {
      try {
        setLoadError('network')
      } catch {}
    })
  })

  const loadingOverlayText = createMemo(() => {
    if (loadError() === 'network') {
      return 'Could not reach server to load this event.'
    }

    if (loadError() === 'not-found') {
      return 'Event not found in local cache or on server.'
    }

    return 'Loading participants...'
  })

  return (
    <>
      <Title>
        {event()
          ? `${event()!.name} — TimeSweeper`
          : 'TimeSweeper — Group scheduling, no login needed'}
      </Title>
      <Meta
        name="description"
        content="Share your availability for this event to help find a time that works for all."
      />
      <Meta property="og:type" content="website" />
      <Meta property="og:url" content={pageUrl} />
      <Meta
        property="og:title"
        content={
          event()
            ? `${event()!.name} — TimeSweeper`
            : 'TimeSweeper — Group scheduling, no login needed'
        }
      />
      <Meta
        property="og:description"
        content="Share your availability for this event to help find a time that works for all."
      />
      <Meta property="og:image" content={pageImage} />
      <Meta name="twitter:card" content="summary_large_image" />
      <Meta
        name="twitter:title"
        content={
          event()
            ? `${event()!.name} — TimeSweeper`
            : 'TimeSweeper — Group scheduling, no login needed'
        }
      />
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
                  Timezone: <b>{Intl.DateTimeFormat().resolvedOptions().timeZone}</b>
                </span>
              </div>
            </div>

            <div class="grid-view__content">
              <Show
                when={isConfirmed()}
                fallback={
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
                          ! {introContext()} Share this link with anyone who needs to respond. Fill
                          your availability. The app will suggest the best times. Once a good option
                          exists, anyone can confirm the event time.
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
                            <div class="grid-view__legend">
                              <AvailabilityLegend withLabels />
                            </div>
                            <div class="availability-grid-wrap">
                              <AvailabilityGrid
                                days={days()}
                                times={times()}
                                myState={myState()}
                                isConfirmed={isConfirmed()}
                                onCycle={cycleCell}
                              />
                            </div>
                          </div>
                        </section>

                        <Show when={event()}>
                          {(loadedEvent) => (
                            <ConfirmationSection
                              event={loadedEvent()}
                              days={days()}
                              times={times()}
                              currentName={currentName()}
                              myState={myState()}
                              others={others()}
                              onReviewCandidates={(candidates) => {
                                const first = candidates[0]

                                setConfirmCandidates(candidates)
                                setConfirmDay(first?.day ?? days()[0]?.label ?? '')
                                setConfirmTime(first?.time ?? times()[0]?.label ?? '')
                                setActiveModal('confirm')
                              }}
                            />
                          )}
                        </Show>
                      </div>
                    </div>
                  </section>
                }
              >
                <Show when={event()}>
                  {(loadedEvent) => (
                    <section class="grid-view__confirmed-page">
                      <div class="grid-view__confirmed-hero r">
                        <div class="grid-view__confirmed-hero-body">
                          <h2 class="grid-view__confirmed-title">{loadedEvent().name}</h2>
                          <div class="grid-view__confirmed-when s">
                            <div class="grid-view__confirmed-when-label">When</div>
                            <div class="grid-view__confirmed-when-value">
                              {confirmedInfo()
                                ? `${confirmedInfo()!.heroDayLabel} at ${confirmedInfo()!.start}`
                                : ''}
                            </div>
                          </div>
                          <div class="grid-view__confirmed-details"></div>
                          <p class="grid-view__confirmed-share-note">
                            The event time is confirmed. You can share this page with everyone who
                            needs to see the final time.
                          </p>
                          <div class="grid-view__confirmed-actions grid-view__confirmed-actions--primary">
                            <Win95Button onClick={downloadIcs}>Download .ics</Win95Button>
                            <Win95Button onClick={copyConfirmedSummary}>Copy summary</Win95Button>
                            <Win95Button onClick={() => copyLink(eventUrl())}>
                              Copy link
                            </Win95Button>
                          </div>
                          <div class="grid-view__confirmed-copy-status" aria-live="polite">
                            {copyStatus()}
                          </div>
                        </div>
                      </div>

                      <div class="grid-view__confirmed-grid">
                        <div class="grid-view__confirmed-panel r">
                          <div class="grid-view__confirmed-panel-body">
                            <div class="grid-view__confirmed-details">
                              <div>
                                <b>Summary:</b> {participantStatusSummary(confirmedPeopleGroups())}
                              </div>
                            </div>
                            <ParticipantStatusList groups={confirmedPeopleGroups()} />
                          </div>
                        </div>

                        <div class="grid-view__confirmed-panel r">
                          <div class="grid-view__confirmed-panel-body">
                            <div class="grid-view__confirmed-details">
                              <div>
                                <b>Created by:</b> {event()?.participants[0]?.name ?? 'Unknown'}
                              </div>
                              <div>
                                <b>Time confirmed by:</b>{' '}
                                {event()?.confirmedBy?.trim() ||
                                  event()?.participants[0]?.name ||
                                  'Unknown'}
                              </div>
                            </div>
                            <div class="grid-view__confirmed-undo-copy">
                              Availability is locked because the event time was confirmed. If plans
                              change, scheduling can be reopened.
                            </div>
                            <Win95Button
                              class="grid-view__confirmed-undo-btn"
                              onClick={() => setActiveModal('undo-confirm')}
                            >
                              Undo confirmation
                            </Win95Button>
                          </div>
                        </div>
                      </div>
                    </section>
                  )}
                </Show>
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
                  {event()?.participants[0]?.name ?? 'Unknown'} is organizing "
                  {event()?.name ?? 'this event'}" and wants to know when you're available.
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
                              selectParticipantSafely(participant.name)
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
              <p class="settings__organizer">{event()?.participants[0]?.name ?? 'Unknown'}</p>
              <p class="settings__label">Dates:</p>
              <p class="settings__organizer">
                Locked after event creation to keep everyone aligned.
              </p>
              <p class="settings__label">Participants:</p>
              <Show when={settingsParticipantNames().length === 0}>
                <p class="settings__note">Add at least one participant before saving.</p>
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
                      fallback={`Show all ${settingsParticipantNames().length} participants`}
                    >
                      Show fewer participants
                    </Show>
                  </Win95Button>
                </div>
              </Show>
              <label class="settings__label" for="settings-new-participant-name">
                Add participant:
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
                  Choose one of {confirmCandidates()?.length ?? 0} matching time variants.
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
                <ParticipantStatusList groups={confirmSlotPreview()} />
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

          <Show when={activeModal() === 'undo-confirm'}>
            <Win95Dialog
              title="Undo confirmation"
              class="dialog--confirm"
              bodyClass="dialog-body--confirm"
              onClose={() => setActiveModal(null)}
            >
              <p class="confirm__lead">Reopen scheduling for this event?</p>
              <p class="confirm__note">
                The confirmed page will go away and everyone will be able to edit availability
                again.
              </p>
              <div class="dialog-buttons">
                <Win95Button class="dialog-btn" onClick={undoConfirmedTime}>
                  Undo confirmation
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
