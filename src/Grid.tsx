import { createSignal, createMemo, createEffect, onMount, onCleanup, For, Show } from 'solid-js'
import type { JSX } from 'solid-js'
import { createStore, reconcile } from 'solid-js/store'
import './styles/grid.css'
import {
  clearSelectedParticipantName,
  closeEventStore,
  getEventJson,
  getEvent,
  getSelectedParticipantName,
  openEventStore,
  pushRecentEvent,
  setSelectedParticipantName,
  subscribeEventSyncState,
  subscribeEvent,
  updateEventSettings,
  updateParticipantSlot,
  updateParticipantSlots,
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
import StatusBar from './components/StatusBar'
import MineIcon from './icons/MineIcon'
import { DISPLAY_TIMEZONE_STORAGE_KEY, getTimezoneOptions } from './timezone-options'
import {
  type AppEvent,
  buildDisplayModel,
  type DisplayModel,
  findDuplicateName,
  getNameKey,
  getParticipantSlotValue,
  type SlotMap,
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
const EMPTY_SLOT_STARTS_UTC_ISO: string[] = []
const EMPTY_SLOT_MAP: SlotMap = {}

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

  const eventSlotStartsUtcIso = createMemo(
    () => event()?.slotStartsUtcIso ?? EMPTY_SLOT_STARTS_UTC_ISO,
    EMPTY_SLOT_STARTS_UTC_ISO,
    {
      equals: (a, b) => a.length === b.length && a.every((entry, index) => entry === b[index]),
    },
  )

  const display = createMemo(() => {
    const slotStartsUtcIso = eventSlotStartsUtcIso()

    return slotStartsUtcIso.length > 0
      ? buildDisplayModel(slotStartsUtcIso, displayTimezone())
      : EMPTY_DISPLAY
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
  const [selectedSlots, setSelectedSlots] = createStore<SlotMap>({})
  const selectedParticipantSlots = createMemo(() => currentParticipant()?.slots ?? EMPTY_SLOT_MAP)

  createEffect(() => {
    setSelectedSlots(reconcile(selectedParticipantSlots()))
  })

  type ActiveModal = null | 'name-picker' | 'settings'
  const [activeModal, setActiveModal] = createSignal<ActiveModal>('name-picker')
  const [settingsEventName, setSettingsEventName] = createSignal('')
  const [settingsParticipantNames, setSettingsParticipantNames] = createSignal<string[]>([])
  const [settingsNewParticipantNames, setSettingsNewParticipantNames] = createSignal<string[]>([''])
  const [showAllSettingsParticipants, setShowAllSettingsParticipants] = createSignal(false)
  const [dialogError, setDialogError] = createSignal('')
  const [copyStatus, setCopyStatus] = createSignal('')
  const [hasConnectedSync, setHasConnectedSync] = createSignal(false)
  const [pageErrorTitle, setPageErrorTitle] = createSignal('')
  const [pageErrorMessage, setPageErrorMessage] = createSignal('')

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

    const prev = getParticipantSlotValue({ slots: selectedSlots }, slot.startUtcIso)
    const next = (prev + 1) % 3

    if (prev === next) {
      return
    }

    const nextSlots = { ...selectedSlots }

    if (next === 0) {
      delete nextSlots[slot.startUtcIso]
    } else {
      nextSlots[slot.startUtcIso] = next as SlotValue
    }
    setSelectedSlots(reconcile(nextSlots))

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
    await updateParticipantSlot(ev.id, name, slot.startUtcIso, next as SlotValue)

    if (navigator.vibrate) {
      navigator.vibrate(10)
    }
  }

  async function paintCells(slotStartUtcIsos: string[], value: SlotValue) {
    const ev = event()
    const participant = currentParticipant()

    if (!ev || !participant) {
      return
    }

    const name = currentName()

    if (!name) {
      return
    }

    const nextSlotStartsUtcIso = [...new Set(slotStartUtcIsos)].filter(
      (slotStartUtcIso) =>
        getParticipantSlotValue({ slots: selectedSlots }, slotStartUtcIso) !== value,
    )

    if (nextSlotStartsUtcIso.length === 0) {
      return
    }

    const nextSlots = { ...selectedSlots }

    nextSlotStartsUtcIso.forEach((slotStartUtcIso) => {
      if (value === 0) {
        delete nextSlots[slotStartUtcIso]

        return
      }

      nextSlots[slotStartUtcIso] = value
    })

    setSelectedSlots(reconcile(nextSlots))

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

    await updateParticipantSlots(ev.id, name, nextSlotStartsUtcIso, value)

    if (navigator.vibrate) {
      navigator.vibrate(10)
    }
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
    let hasAcceptedStoreEvent = false
    const loadingMessageTimer = window.setInterval(() => {
      if (!event()) {
        setLoadingMessageIndex((index) => (index + 1) % LOADING_MESSAGES.length)
      }
    }, 3000)

    unsubscribeSyncState = subscribeEventSyncState((state) => {
      if (state !== 'connected') {
        return
      }

      setHasConnectedSync(true)

      if (hasAcceptedStoreEvent) {
        return
      }

      getEvent(props.eventId)
        .then((next) => {
          if (isDisposed || !next || hasAcceptedStoreEvent) {
            return
          }

          hasAcceptedStoreEvent = true
          applyLoadedEvent(next)
        })
        .catch((error) => {
          console.error('Failed to read connected event store', error)
        })
    })

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
          if (!next) {
            return
          }

          if (!hasAcceptedStoreEvent && !hasConnectedSync()) {
            return
          }

          hasAcceptedStoreEvent = true
          applyLoadedEvent(next)
        })

        const localEvent = await getEvent(props.eventId)

        if (isDisposed) {
          return
        }

        if (localEvent) {
          hasAcceptedStoreEvent = true
          applyLoadedEvent(localEvent)
          setLocalReady(true)

          return
        }

        const initialEvent = await getEventJson(props.eventId)

        if (isDisposed) {
          return
        }

        if (!initialEvent) {
          setActiveModal(null)
          setPageErrorTitle('Event Not Found')
          setPageErrorMessage(
            'We could not find that schedule. The link may be incomplete, or the event may no longer exist.',
          )
          setLocalReady(true)

          return
        }

        applyLoadedEvent(initialEvent)
        setLocalReady(true)
      } catch {
        if (isDisposed) {
          return
        }

        setActiveModal(null)
        setPageErrorTitle('Could Not Open Schedule')
        setPageErrorMessage('Check your connection and try opening the link again.')
        setLocalReady(true)
      }
    }

    initialize().catch(() => {})
  })

  const loadingOverlayText = createMemo(() => LOADING_MESSAGES[loadingMessageIndex()])
  const canCloseNamePicker = createMemo(() => {
    if (!event()) {
      return true
    }

    return !!currentName()
  })

  return (
    <>
      <div class="grid-view">
        <Show when={localReady() && !pageErrorMessage()} fallback={null}>
          <div class="grid-view__shell">
            <StatusBar class="grid-view__connection-bar" ready={localReady()} />
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
                          Copy
                        </Win95Button>
                        <div class="copy-status" aria-live="polite">
                          {copyStatus()}
                        </div>
                      </div>
                    </GridSection>

                    <GridSection number={2} title="Your availability">
                      <p class="grid-view__suggestions-helper grid-view__availability-helper">
                        <span>Click or drag squares to mark your availability:</span>
                        <AvailabilityLegend withLabels />
                      </p>
                      <div class="availability-grid-wrap">
                        <AvailabilityGrid
                          days={days()}
                          times={times()}
                          slotByDayTime={slotByDayTime()}
                          selectedSlots={selectedSlots}
                          onCycle={cycleCell}
                          onPaint={paintCells}
                        />
                      </div>
                    </GridSection>

                    <Show when={event()}>
                      {(loadedEvent) => (
                        <OverlapSection
                          event={loadedEvent()}
                          currentName={currentName()}
                          currentParticipant={currentParticipant()}
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
        <Show when={!!pageErrorMessage()}>
          <ErrorDialog
            title={pageErrorTitle()}
            message={pageErrorMessage()}
            onClose={() => {
              setPageErrorMessage('')
              goToLanding()
            }}
          />
        </Show>
      </div>
    </>
  )
}
