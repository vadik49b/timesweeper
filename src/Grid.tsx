import { createSignal, createMemo, onMount, onCleanup, For, Show } from 'solid-js'
import type { JSX } from 'solid-js'
import { makeEventListener } from '@solid-primitives/event-listener'
import { Title, Meta } from '@solidjs/meta'
import './styles/grid.css'
import {
  clearSelectedParticipantName,
  closeEventStore,
  type EventSyncState,
  getEvent,
  getSelectedParticipantName,
  openEventStore,
  pushRecentEvent,
  setSelectedParticipantName,
  subscribeEventSyncState,
  subscribeEvent,
  updateEventSettings,
  updateParticipantSlot,
} from './db'
import Win95Field from './components/Win95Field'
import Win95Button from './components/Win95Button'
import Win95Dialog from './components/Win95Dialog'
import ErrorDialog from './components/ErrorDialog'
import AvailabilityLegend from './components/AvailabilityLegend'
import AvailabilityGrid from './components/AvailabilityGrid'
import OverlapSection from './components/OverlapSection'
import GridSection from './components/GridSection'
import DialogActions from './components/DialogActions'
import SettingsDialog from './components/SettingsDialog'
import MineIcon from './icons/MineIcon'
import { DISPLAY_TIMEZONE_STORAGE_KEY, getTimezoneOptions } from './timezone-options'
import {
  type AppEvent,
  buildDisplayModel,
  type DisplayModel,
  findDuplicateName,
  getNameKey,
  getParticipantSlotValue,
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
  'Opening link...',
  'Opening this link for the first time can take a few seconds.',
  'Still opening. This can take a little longer on a new device.',
]

export default function Grid(props: Props) {
  const [event, setEvent] = createSignal<AppEvent | null>(null)
  const [localReady, setLocalReady] = createSignal(false)
  const [loadingMessageIndex, setLoadingMessageIndex] = createSignal(0)
  const [displayTimezone, setDisplayTimezone] = createSignal(
    localStorage.getItem(DISPLAY_TIMEZONE_STORAGE_KEY) ||
      Intl.DateTimeFormat().resolvedOptions().timeZone,
  )
  const timezoneOptions = createMemo(() => getTimezoneOptions(displayTimezone()))

  const display = createMemo(() => {
    const ev = event()

    return ev ? buildDisplayModel(ev.slotStartsUtcIso, displayTimezone()) : EMPTY_DISPLAY
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

  type ActiveModal = null | 'name-picker' | 'help' | 'settings'
  const [activeModal, setActiveModal] = createSignal<ActiveModal>('name-picker')
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

  function updateDisplayTimezone(timezone: string) {
    setDisplayTimezone(timezone)
    localStorage.setItem(DISPLAY_TIMEZONE_STORAGE_KEY, timezone)
  }

  function goToLanding() {
    if (window.location.pathname !== '/') {
      window.history.pushState({}, '', '/')
      window.dispatchEvent(new PopStateEvent('popstate'))
    }
  }

  async function cycleCell(slotIndex: number) {
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
    if (nextSelected) {
      setSelectedParticipantName(updated.id, nextSelected)
    } else {
      clearSelectedParticipantName(updated.id)
    }
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
      setDialogError('Title is required.')

      return
    }

    const organizer = event()?.participants[0]?.name ?? 'Unknown'
    const organizerParticipant = ev.participants[0]

    if (!organizerParticipant) {
      setDialogError('Organizer is missing.')

      return
    }

    const nextParticipantNames = [...settingsParticipantNames(), ...settingsNewParticipantNames()]
      .map((name) => name.trim())
      .filter(Boolean)

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
        ?.name ?? ''

    await applyUpdatedEvent(updated, nextSelected)
    setActiveModal(nextSelected ? null : 'name-picker')
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

  const introContext = createMemo(() => {
    const ev = event()

    if (!ev) {
      return 'Share this link with anyone who needs to respond.'
    }

    const organizer = ev.participants[0]?.name ?? 'Unknown'
    const current = currentName()

    if (current && getNameKey(current) === getNameKey(organizer)) {
      return `You set up "${ev.name}".`
    }

    return `${organizer} set up "${ev.name}".`
  })
  const pageTitle = createMemo(() => {
    const ev = event()

    if (!ev) {
      return 'TimeSweeper — Group scheduling, no login needed'
    }

    return `${ev.name} — TimeSweeper`
  })
  const pageImage = `${window.location.origin}/anti-tank-mine-logo.png`

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

  async function addParticipantFromPicker(
    submitEvent: SubmitEvent & { currentTarget: HTMLFormElement },
  ) {
    submitEvent.preventDefault()

    const formData = new FormData(submitEvent.currentTarget)
    const trimmed = String(formData.get('newParticipantName') ?? '').trim()

    if (!trimmed) {
      setDialogError('Enter your name.')

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

      return
    }

    const selected = currentName()
    const stillExists = selected
      ? next.participants.some((participant) => participant.name === selected)
      : false

    if (!stillExists) {
      clearSelectedParticipantName(next.id)
      setCurrentName('')
      setActiveModal('name-picker')
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
  const canCloseNamePicker = createMemo(() => {
    if (!event()) {
      return true
    }

    return !!currentName()
  })

  return (
    <>
      <Title>{pageTitle()}</Title>
      <Meta
        name="description"
        content="Share your availability to help find a time that works for everyone."
      />
      <Meta property="og:type" content="website" />
      <Meta property="og:url" content={pageUrl} />
      <Meta property="og:title" content={pageTitle()} />
      <Meta
        property="og:description"
        content="Share your availability to help find a time that works for everyone."
      />
      <Meta property="og:image" content={pageImage} />
      <Meta name="twitter:card" content="summary_large_image" />
      <Meta name="twitter:title" content={pageTitle()} />
      <Meta
        name="twitter:description"
        content="Share your availability to help find a time that works for everyone."
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
                <label class="grid-view__hero-timezone" for="display-timezone">
                  View in:
                </label>
                <Win95Field
                  kind="select"
                  id="display-timezone"
                  name="displayTimezone"
                  size="small"
                  value={displayTimezone()}
                  options={timezoneOptions()}
                  wrapperClass="grid-view__timezone-field"
                  onChange={updateDisplayTimezone}
                />
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
                      ! {introContext()} Share this page with anyone who needs to respond. Fill your
                      availability. The app will show the strongest overlaps.
                    </p>
                    <GridSection number={1} title="Share the link with everyone">
                      <label for="share-link" class="share-panel__label">
                        Link:
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
                    </GridSection>

                    <GridSection number={2} title="Your availability">
                      <p class="grid-view__suggestions-helper grid-view__availability-helper">
                        <span>Click squares to mark your availability:</span>
                        <AvailabilityLegend withLabels />
                      </p>
                      <div class="availability-grid-wrap">
                        <AvailabilityGrid
                          days={days()}
                          times={times()}
                          slotByDayTime={slotByDayTime()}
                          selectedSlots={selectedSlots()}
                          onCycle={cycleCell}
                        />
                      </div>
                    </GridSection>

                    <Show when={event()}>
                      {(loadedEvent) => (
                        <OverlapSection
                          event={loadedEvent()}
                          currentName={currentName()}
                          displaySlots={displaySlots()}
                        />
                      )}
                    </Show>
                  </div>
                </div>
              </section>
            </div>
            {/* /grid-view__content */}
          </div>
          {/* /grid-view__shell */}

          <Show when={activeModal() === 'name-picker'}>
            <Win95Dialog
              title="Choose your name"
              class="dialog--name-picker"
              onClose={
                canCloseNamePicker()
                  ? () => (event() ? setActiveModal(null) : goToLanding())
                  : undefined
              }
              showCloseButton={canCloseNamePicker()}
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
                  {event()?.participants[0]?.name ?? 'Unknown'} set up "
                  {event()?.name ?? 'this schedule'}" and wants to know when you're available.
                </p>
                <Show when={(event()?.participants.length ?? 0) > 0}>
                  <div class="participant-picker__existing">
                    <p class="participant-picker__label">Continue as:</p>
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
                  </div>
                </Show>
                <div class="participant-picker__new">
                  <label class="participant-picker__label" for="new-participant-name">
                    New here?
                  </label>
                  <form
                    onSubmit={
                      addParticipantFromPicker as JSX.EventHandler<HTMLFormElement, SubmitEvent>
                    }
                  >
                    <Win95Field
                      kind="input"
                      id="new-participant-name"
                      name="newParticipantName"
                      wrapperClass="dialog__field"
                    />
                    <DialogActions class="participant-picker__actions">
                      <Win95Button class="dialog-btn" type="submit">
                        Join as new participant
                      </Win95Button>
                    </DialogActions>
                  </form>
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
                <b>3.</b> Check the overlap table to compare the best and near-match slots
              </p>
              <p class="help__step">
                <b>4.</b> Copy the link and send it to others
              </p>
              <p class="help__step">
                <b>5.</b> Review the suggested overlaps
              </p>
              <p class="help__keys">
                <b>Keyboard shortcuts:</b>
                <br />
                <span class="help__key-line">F3 / S — Focus share link</span>
              </p>
              <DialogActions>
                <Win95Button class="dialog-btn" onClick={() => setActiveModal(null)}>
                  OK
                </Win95Button>
              </DialogActions>
            </Win95Dialog>
          </Show>

          <Show when={activeModal() === 'settings'}>
            <SettingsDialog
              eventName={settingsEventName()}
              organizerName={event()?.participants[0]?.name ?? 'Unknown'}
              participantNames={settingsParticipantNames()}
              visibleParticipantNames={visibleSettingsParticipantNames()}
              newParticipantNames={settingsNewParticipantNames()}
              showAllParticipants={showAllSettingsParticipants()}
              onEventNameInput={setSettingsEventName}
              onRemoveParticipant={removeSettingsParticipant}
              onAddParticipantRow={addSettingsParticipantRow}
              onUpdateParticipantRow={updateSettingsParticipantRow}
              onRemoveParticipantRow={removeSettingsParticipantRow}
              onToggleAllParticipants={() =>
                setShowAllSettingsParticipants(!showAllSettingsParticipants())
              }
              onSave={saveSettings}
              onCancel={() => setActiveModal(null)}
            />
          </Show>

          <Show when={!!dialogError()}>
            <ErrorDialog message={dialogError()} onClose={() => setDialogError('')} />
          </Show>
        </Show>
        <Show when={connectionBarText()}>
          {(text) => <div class="grid-view__connection-bar">{text()}</div>}
        </Show>
      </div>
    </>
  )
}
