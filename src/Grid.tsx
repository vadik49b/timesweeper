import { createSignal, createMemo, onMount, onCleanup, For, Index, Show } from 'solid-js'
import { makeEventListener } from '@solid-primitives/event-listener'
import { Title, Meta } from '@solidjs/meta'
import { addMinutes, intlFormat, parseISO } from 'date-fns'
import {
  closeEventStore,
  confirmEvent,
  type EventSyncState,
  getEvent,
  getSelectedParticipantName,
  openEventStore,
  pushRecentEvent,
  setSelectedParticipantName,
  subscribeEventSyncState,
  subscribeEvent,
  unconfirmEvent,
  updateEventSettings,
  updateParticipantSlot,
} from './db'
import Win95Field from './components/Win95Field'
import Win95Button from './components/Win95Button'
import Win95Dialog from './components/Win95Dialog'
import ErrorDialog from './components/ErrorDialog'
import AvailabilityLegend from './components/AvailabilityLegend'
import AvailabilityGrid from './components/AvailabilityGrid'
import ConfirmationSection from './components/ConfirmationSection'
import ParticipantStatusList from './components/ParticipantStatusList'
import MineIcon from './icons/MineIcon'
import {
  SLOT_DURATION,
  type AppEvent,
  buildDisplayModel,
  type DisplayModel,
  emptyParticipantSummaryGroups,
  findDuplicateName,
  getEventSlotCount,
  getNameKey,
  getParticipantSlotValue,
  getParticipantSummaryGroups,
  isEventConfirmed,
  participantStatusSummary,
  type ParticipantSummaryGroups,
  type SlotValue,
} from './event-helpers'

interface Props {
  eventId: string
}

const EMPTY_DISPLAY: DisplayModel = {
  slots: [],
  days: [],
  times: [],
  slotByDayTime: {},
}

const LOADING_MESSAGES = [
  'Loading event...',
  'Connecting to the event. First load on a new device can take a few seconds.',
  'Still connecting. This can take a little longer on a new device.',
]

export default function Grid(props: Props) {
  const [event, setEvent] = createSignal<AppEvent | null>(null)
  const [localReady, setLocalReady] = createSignal(false)
  const [loadingMessageIndex, setLoadingMessageIndex] = createSignal(0)
  const [newParticipantName, setNewParticipantName] = createSignal('')

  const display = createMemo(() => {
    const ev = event()

    return ev ? buildDisplayModel(ev.slotStartsUtcIso) : EMPTY_DISPLAY
  })
  const displaySlots = () => display().slots
  const days = () => display().days
  const times = () => display().times
  const slotByDayTime = () => display().slotByDayTime

  const [currentName, setCurrentName] = createSignal('')
  const currentParticipant = createMemo(() => {
    const ev = event()
    const name = currentName()

    if (!ev || !name) {
      return null
    }

    return ev.participants.find((entry) => entry.name === name) ?? null
  })
  const selectedSlots = createMemo(() => currentParticipant()?.slots ?? {})

  type ActiveModal = null | 'name-picker' | 'help' | 'confirm' | 'settings' | 'undo-confirm'
  const [activeModal, setActiveModal] = createSignal<ActiveModal>('name-picker')
  const [confirmSlotIndex, setConfirmSlotIndex] = createSignal<number | null>(null)
  const [settingsEventName, setSettingsEventName] = createSignal('')
  const [settingsParticipantNames, setSettingsParticipantNames] = createSignal<string[]>([])
  const [settingsNewParticipantNames, setSettingsNewParticipantNames] = createSignal<string[]>([''])
  const [showAllSettingsParticipants, setShowAllSettingsParticipants] = createSignal(false)
  const [dialogError, setDialogError] = createSignal('')
  const [copyStatus, setCopyStatus] = createSignal('')
  const [isBrowserOnline, setIsBrowserOnline] = createSignal(window.navigator.onLine)
  const [eventSyncState, setEventSyncState] = createSignal<EventSyncState>('connecting')

  let shareInputRef!: HTMLInputElement
  const pageUrl = `${window.location.origin}/e/${encodeURIComponent(props.eventId)}`
  const localTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone

  function goToLanding() {
    if (window.location.pathname !== '/') {
      window.history.pushState({}, '', '/')
      window.dispatchEvent(new PopStateEvent('popstate'))
    }
  }

  function toUtcStamp(utcMs: number) {
    const dt = new Date(utcMs)
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

  function peopleGroupsForSlot(slotIndex: number): ParticipantSummaryGroups {
    const ev = event()
    const slot = displaySlots()[slotIndex]

    return ev && slot
      ? getParticipantSummaryGroups(ev, currentName(), slot.startUtcIso)
      : emptyParticipantSummaryGroups()
  }

  async function cycleCell(slotIndex: number) {
    if (isConfirmed()) {
      return
    }

    const ev = event()
    const participant = currentParticipant()

    if (!ev || !participant) {
      return
    }

    const name = currentName()

    if (!name) {
      return
    }

    const slot = displaySlots()[slotIndex]!

    const prev = getParticipantSlotValue(participant, slot.startUtcIso)
    const next = (prev + 1) % 3

    if (prev === next) {
      return
    }

    const nextSlots = { ...participant.slots }

    if (next === 0) {
      delete nextSlots[slot.startUtcIso]
    } else {
      nextSlots[slot.startUtcIso] = next as SlotValue
    }

    await updateParticipantSlot(ev.id, name, slot.startUtcIso, next as SlotValue)

    const nextEvent: AppEvent = {
      ...ev,
      participants: ev.participants.map((entry) =>
        entry.name === participant.name
          ? {
              ...entry,
              slots: nextSlots,
            }
          : entry,
      ),
    }

    setEvent(nextEvent)

    if (navigator.vibrate) {
      navigator.vibrate(10)
    }
  }
  function openConfirm(slotIndex: number | null) {
    setConfirmSlotIndex(slotIndex ?? displaySlots()[0]?.slotIndex ?? null)
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

    const slotIndex = confirmSlotIndex()

    if (slotIndex === null || slotIndex < 0 || slotIndex >= getEventSlotCount(ev)) {
      return
    }

    const confirmedSlot = displaySlots()[slotIndex]!

    const updated: AppEvent = {
      ...ev,
      confirmedBy: confirmer,
      confirmedStartUtc: confirmedSlot.startUtcIso,
    }
    await confirmEvent(ev.id, confirmer, confirmedSlot.startUtcIso)
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
      confirmedBy: undefined,
      confirmedStartUtc: undefined,
    }
    await unconfirmEvent(ev.id)
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
    setSettingsNewParticipantNames([''])
    setShowAllSettingsParticipants(false)
    setDialogError('')
    setActiveModal('settings')
  }

  function removeSettingsParticipant(index: number) {
    setSettingsParticipantNames((prev) => prev.filter((_, i) => i !== index))
  }

  function addSettingsParticipantRow() {
    setSettingsNewParticipantNames((prev) => [...prev, ''])
  }

  function updateSettingsParticipantRow(index: number, value: string) {
    setSettingsNewParticipantNames((prev) =>
      prev.map((entry, entryIndex) => (entryIndex === index ? value : entry)),
    )
  }

  function removeSettingsParticipantRow(index: number) {
    setSettingsNewParticipantNames((prev) => {
      if (prev.length === 1) {
        return ['']
      }

      return prev.filter((_, entryIndex) => entryIndex !== index)
    })
  }

  const visibleSettingsParticipantNames = createMemo(() => {
    const all = settingsParticipantNames()

    if (showAllSettingsParticipants()) {
      return all
    }

    return all.slice(0, 5)
  })

  async function applyUpdatedEvent(updated: AppEvent, nextSelected: string) {
    await updateEventSettings(updated.id, {
      name: updated.name,
      participants: updated.participants,
    })
    setSelectedParticipantName(updated.id, nextSelected)
    pushRecentEvent({ id: updated.id, name: updated.name, created: updated.created })
    setEvent(updated)
    setCurrentName(nextSelected)
  }

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

    const nextParticipantNames = [...settingsParticipantNames(), ...settingsNewParticipantNames()]
      .map((name) => name.trim())
      .filter(Boolean)

    if (nextParticipantNames.length < 1) {
      setDialogError('Add at least one participant before saving.')

      return
    }

    const duplicateName = findDuplicateName(nextParticipantNames, [organizer])

    if (duplicateName) {
      setDialogError(`Duplicate name: "${duplicateName}". Use unique names.`)

      return
    }

    const existingByKey = new Map(
      ev.participants.map((participant) => [getNameKey(participant.name), participant]),
    )
    const updatedParticipants = [
      organizerParticipant,
      ...nextParticipantNames.map((name) => {
        const existing = existingByKey.get(getNameKey(name))

        if (existing) {
          return { ...existing, name }
        }

        return {
          name,
          slots: {},
        }
      }),
    ]

    const updated: AppEvent = {
      ...ev,
      name: nextEventName,
      participants: updatedParticipants,
    }
    const selectedKey = getNameKey(currentName())
    const nextSelected =
      updatedParticipants.find((participant) => getNameKey(participant.name) === selectedKey)
        ?.name ??
      updatedParticipants[0]?.name ??
      ''

    if (!nextSelected) {
      setDialogError('At least 2 participants are required.')

      return
    }

    await applyUpdatedEvent(updated, nextSelected)
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

  const confirmSlotPreview = createMemo<ParticipantSummaryGroups>(() => {
    const slot = displaySlots()[confirmSlotIndex() ?? -1]

    if (!slot) {
      return emptyParticipantSummaryGroups()
    }

    return peopleGroupsForSlot(slot.slotIndex)
  })
  const confirmSlotText = createMemo(() => {
    const slot = displaySlots()[confirmSlotIndex() ?? -1]

    return slot ? `${slot.dayLabel} at ${slot.timeLabel}` : ''
  })
  const introContext = createMemo(() => {
    const ev = event()

    if (!ev) {
      return 'Share the event link with anyone who needs to respond.'
    }

    const organizer = ev.participants[0]?.name ?? 'Unknown'
    const current = currentName()

    if (current && getNameKey(current) === getNameKey(organizer)) {
      return `You are organizing "${ev.name}" event.`
    }

    return `${organizer} is organizing "${ev.name}" event.`
  })
  const pageTitle = createMemo(() => {
    const ev = event()

    if (!ev) {
      return 'TimeSweeper — Group scheduling, no login needed'
    }

    return `${ev.name} — TimeSweeper`
  })
  const pageImage = `${window.location.origin}/anti-tank-mine-logo.png`

  const confirmedInfo = createMemo(() => {
    const ev = event()

    if (!ev || !isEventConfirmed(ev)) {
      return null
    }

    const confirmedStartUtc = ev.confirmedStartUtc!
    const startUtcDate = parseISO(confirmedStartUtc)
    const startUtcMs = startUtcDate.getTime()

    const confirmedSlot = displaySlots().find((slot) => slot.startUtcIso === confirmedStartUtc)
    const endDate = addMinutes(startUtcDate, SLOT_DURATION)
    const dayLabel = intlFormat(startUtcDate, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    })
    const heroDayLabel = intlFormat(startUtcDate, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    })
    const start = intlFormat(startUtcDate, {
      hour: 'numeric',
      minute: '2-digit',
    })
    const end = intlFormat(endDate, {
      hour: 'numeric',
      minute: '2-digit',
    })

    return {
      dayLabel,
      heroDayLabel,
      start,
      end,
      slotIndex: confirmedSlot?.slotIndex ?? null,
      startUtcMs,
      endUtcMs: endDate.getTime(),
    }
  })
  const isConfirmed = createMemo(() => !!confirmedInfo())
  const confirmedPeopleGroups = createMemo(() => {
    const info = confirmedInfo()

    if (!info || info.slotIndex === null) {
      return emptyParticipantSummaryGroups()
    }

    return peopleGroupsForSlot(info.slotIndex)
  })

  function summaryDetailsText() {
    const ev = event()
    const info = confirmedInfo()

    if (!ev || !info) {
      return ''
    }

    const createdBy = ev.participants[0]?.name ?? 'Unknown'
    const people = ev.participants.map((participant) => participant.name).join(', ')

    return [
      `Event: ${ev.name}`,
      `Created by: ${createdBy}`,
      `When: ${info.dayLabel} ${info.start}-${info.end} (${localTimezone})`,
      `Participants: ${people}`,
    ].join('\n')
  }

  function buildIcsExport() {
    const info = confirmedInfo()
    const ev = event()

    if (!info || !ev) {
      return null
    }

    const dtStart = toUtcStamp(info.startUtcMs)
    const dtEnd = toUtcStamp(info.endUtcMs)
    const createdBy = ev.participants[0]?.name ?? 'Unknown'
    const people = ev.participants.map((participant) => participant.name).join(', ')
    const description = [
      `Event: ${ev.name}`,
      `Status: confirmed`,
      `Link: ${pageUrl}`,
      `Created by: ${createdBy}`,
      `When: ${info.dayLabel} ${info.start} (${localTimezone})`,
      `Participants (${ev.participants.length}): ${people}`,
    ].join('\n')
    const payload = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//TimeSweeper//EN',
      'BEGIN:VEVENT',
      `UID:${ev.id}@timesweeper.app`,
      `DTSTAMP:${toUtcStamp(info.startUtcMs)}`,
      `DTSTART:${dtStart}`,
      `DTEND:${dtEnd}`,
      'STATUS:CONFIRMED',
      `SUMMARY:${icsEscape(`TimeSweeper: ${ev.name}`)}`,
      `DESCRIPTION:${icsEscape(description)}`,
      `URL:${icsEscape(pageUrl)}`,
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')
    const fileName = `${ev.name.replace(/\s+/g, '-').toLowerCase() || 'timesweeper'}.ics`
    const blob = new Blob([payload], { type: 'text/calendar;charset=utf-8' })

    return {
      blob,
      ev,
      fileName,
      payload,
      url: URL.createObjectURL(blob),
    }
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

  async function downloadIcs() {
    const exportData = buildIcsExport()

    if (!exportData) {
      return
    }

    const { blob, ev, fileName, url } = exportData
    const isTelegramWebView = /Telegram/i.test(navigator.userAgent)
    const canShareFiles =
      typeof File !== 'undefined' &&
      typeof navigator.canShare === 'function' &&
      typeof navigator.share === 'function'

    if (canShareFiles) {
      const file = new File([blob], fileName, { type: 'text/calendar;charset=utf-8' })

      if (navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({
            files: [file],
            title: ev.name,
            text: `Calendar file for ${ev.name}`,
          })
          setCopyStatus('Calendar file ready to share.')

          return
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') {
            return
          }
        }
      }
    }

    try {
      const a = document.createElement('a')
      a.href = url
      a.download = fileName
      a.rel = 'noopener noreferrer'
      a.target = '_blank'
      document.body.append(a)
      a.click()
      a.remove()

      if (isTelegramWebView) {
        setCopyStatus('If Telegram blocks the file, open this page in your browser and try again.')
      } else {
        setCopyStatus('Calendar file download started.')
      }
    } finally {
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    }
  }

  function selectParticipant(name: string) {
    const ev = event()

    if (!ev) {
      return
    }

    const exists = ev.participants.some((participant) => participant.name === name)

    if (!exists) {
      return
    }

    setSelectedParticipantName(ev.id, name)
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

    const existing = ev.participants.find(
      (participant) => getNameKey(participant.name) === getNameKey(trimmed),
    )

    if (existing) {
      setDialogError(
        `"${existing.name}" is already on the participant list. Choose a different name, or select "${existing.name}" from the list if that is you.`,
      )

      return
    }

    const updated: AppEvent = {
      ...ev,
      participants: [...ev.participants, { name: trimmed, slots: {} }],
    }
    await applyUpdatedEvent(updated, trimmed)
    setNewParticipantName('')
    setActiveModal(null)
  }

  function initializeSelectedParticipant(ev: AppEvent) {
    const savedName = getSelectedParticipantName(ev.id)
    const exists = savedName ? ev.participants.some((p) => p.name === savedName) : false

    if (savedName && exists) {
      setCurrentName(savedName)
      setActiveModal(null)
    } else {
      setActiveModal('name-picker')
    }
  }

  function applyLoadedEvent(next: AppEvent) {
    const previous = event()

    setEvent(next)

    if (
      !previous ||
      previous.id !== next.id ||
      previous.name !== next.name ||
      previous.created !== next.created
    ) {
      pushRecentEvent({ id: next.id, name: next.name, created: next.created })
    }

    if (!previous) {
      initializeSelectedParticipant(next)
    }
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

  function onParticipantPickerChange(name: string) {
    if (!name) {
      return
    }

    selectParticipant(name)
  }

  // Global event listeners + initial load
  onMount(() => {
    let unsubscribe: (() => void) | null = null
    let unsubscribeSyncState: (() => void) | null = null
    let isDisposed = false
    const loadingMessageTimer = window.setInterval(() => {
      if (!event()) {
        setLoadingMessageIndex((index) => (index + 1) % LOADING_MESSAGES.length)
      }
    }, 3000)

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
        openConfirm(null)
      }
    }

    makeEventListener(document, 'keydown', onKeyDown)
    makeEventListener(window, 'online', () => setIsBrowserOnline(true))
    makeEventListener(window, 'offline', () => setIsBrowserOnline(false))
    unsubscribeSyncState = subscribeEventSyncState(setEventSyncState)

    onCleanup(() => {
      window.clearInterval(loadingMessageTimer)

      if (unsubscribe) {
        unsubscribe()
      }

      if (unsubscribeSyncState) {
        unsubscribeSyncState()
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
            applyLoadedEvent(next)
          }
        })

        const initial = await getEvent(props.eventId)

        if (isDisposed) {
          return
        }

        if (initial) {
          applyLoadedEvent(initial)
        }
      } catch {
      } finally {
        setLocalReady(true)
      }
    }

    initialize().catch(() => {})
  })

  const loadingOverlayText = createMemo(() => LOADING_MESSAGES[loadingMessageIndex()])
  const connectionBarText = createMemo(() => {
    if (!localReady()) {
      return ''
    }

    if (!isBrowserOnline()) {
      return "Offline. Changes will sync when you're back online."
    }

    if (eventSyncState() === 'reconnecting') {
      return 'Reconnecting...'
    }

    return ''
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
                  Timezone: <b>{localTimezone}</b>
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
                          ! {introContext()} Share this page with anyone who needs to respond. Fill
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
                                value={pageUrl}
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
                                onClick={() => copyLink(pageUrl)}
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
                                slotByDayTime={slotByDayTime()}
                                selectedSlots={selectedSlots()}
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
                              currentName={currentName()}
                              displaySlots={displaySlots()}
                              onConfirmSlot={(slot) => {
                                setConfirmSlotIndex(slot.slotIndex)
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
                            <Win95Button onClick={() => copyLink(pageUrl)}>Copy link</Win95Button>
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
                              selectParticipant(participant.name)
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
              <div class="settings__participants-list">
                <table class="settings__participants-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th class="settings__participants-action-col">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={visibleSettingsParticipantNames()}>
                      {(participantName, index) => (
                        <tr>
                          <td class="settings__participant-name">{participantName}</td>
                          <td class="settings__participant-action-cell">
                            <Win95Button
                              size="small"
                              variant="toolbar"
                              class="settings__participant-remove"
                              onClick={() => removeSettingsParticipant(index())}
                            >
                              Remove
                            </Win95Button>
                          </td>
                        </tr>
                      )}
                    </For>
                    <Index each={settingsNewParticipantNames()}>
                      {(participantName, index) => (
                        <tr>
                          <td class="settings__participant-input-cell">
                            <Win95Field
                              kind="input"
                              name={`settingsNewParticipantName${index}`}
                              size="small"
                              value={participantName()}
                              placeholder="Name"
                              wrapperClass="settings__participant-input"
                              onInput={(value) => updateSettingsParticipantRow(index, value)}
                            />
                          </td>
                          <td class="settings__participant-action-cell">
                            <Win95Button
                              size="small"
                              variant="toolbar"
                              class="settings__participant-remove"
                              onClick={() => removeSettingsParticipantRow(index)}
                            >
                              Remove
                            </Win95Button>
                          </td>
                        </tr>
                      )}
                    </Index>
                  </tbody>
                </table>
              </div>
              <div class="settings__participants-actions">
                <Win95Button size="small" variant="toolbar" onClick={addSettingsParticipantRow}>
                  Add another row
                </Win95Button>
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
              <p class="confirm__lead">
                Confirm <strong>{confirmSlotText() || 'this time'}</strong> for everyone?
              </p>
              <p class="confirm__availability-label">Availability:</p>
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
        <Show when={connectionBarText()}>
          {(text) => <div class="grid-view__connection-bar">{text()}</div>}
        </Show>
      </div>
    </>
  )
}
