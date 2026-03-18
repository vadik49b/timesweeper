import { createMergeableStore } from 'tinybase/mergeable-store'
import { createStore, type Store } from 'tinybase/store'
import { createIndexedDbPersister } from 'tinybase/persisters/persister-indexed-db'
import { createLocalPersister } from 'tinybase/persisters/persister-browser'
import { isValid, parseISO } from 'date-fns'
import {
  createWsSynchronizer,
  type WsSynchronizer,
} from 'tinybase/synchronizers/synchronizer-ws-client'
import ReconnectingWebSocket from 'reconnecting-websocket'
import { getEventSlotCount, type AppEvent, type Participant, type SlotValue } from './event-helpers'

const EVENT_META_TABLE = 'eventMeta'
const EVENT_NAME_CELL = 'name'
const EVENT_CREATED_CELL = 'created'
const EVENT_DATES_CELL = 'dates'
const EVENT_SLOT_MINUTES_CELL = 'slotMinutes'
const EVENT_DEFAULT_WINDOW_START_MIN_CELL = 'defaultWindowStartMin'
const EVENT_DEFAULT_WINDOW_END_MIN_CELL = 'defaultWindowEndMin'
const EVENT_DEFAULT_WINDOW_TIMEZONE_CELL = 'defaultWindowTimezone'
const EVENT_CONFIRMED_BY_CELL = 'confirmedBy'
const EVENT_CONFIRMED_START_UTC_CELL = 'confirmedStartUtc'
const PARTICIPANTS_TABLE = 'participants'
const PARTICIPANT_NAME_CELL = 'name'
const PARTICIPANT_ORDER_CELL = 'order'
const AVAILABILITY_TABLE = 'availability'
const RECENTLY_OPENED_EVENTS_VALUE = 'recentlyOpenedEvents'
const SELECTED_PARTICIPANTS_TABLE = 'selectedParticipants'
const SELECTED_PARTICIPANT_NAME_CELL = 'name'
const MAX_RECENT_EVENTS = 5

type EventRoomStore = ReturnType<typeof createMergeableStore>

export interface RecentEventSummary {
  id: string
  name: string
  created: number
}

let eventRoomId: string | null = null
let eventRoomStorePromise: Promise<EventRoomStore> | null = null
let eventRoomSynchronizer: WsSynchronizer<ReconnectingWebSocket> | null = null
let eventRoomSyncPromise: Promise<void> | null = null
const localStorePromise = createLocalStore()

function eventSyncUrl(eventId: string): string {
  const origin = import.meta.env.VITE_WS_ORIGIN

  if (!origin) {
    throw new Error('Missing VITE_WS_ORIGIN')
  }

  const url = new URL(origin)

  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.pathname = `/api/events/${encodeURIComponent(eventId)}`

  return url.toString()
}

function slotCellId(slotIndex: number): string {
  return `s${slotIndex}`
}

function parseSlotIndex(slotId: string): number | null {
  if (!slotId.startsWith('s')) {
    return null
  }

  const value = Number(slotId.slice(1))

  return Number.isInteger(value) && value >= 0 ? value : null
}

async function createLocalStore(): Promise<Store> {
  const store = createStore()

  store.setValuesSchema({
    [RECENTLY_OPENED_EVENTS_VALUE]: { type: 'array', default: [] },
  })

  store.setTablesSchema({
    [SELECTED_PARTICIPANTS_TABLE]: {
      [SELECTED_PARTICIPANT_NAME_CELL]: { type: 'string' },
    },
  })

  const persister = createLocalPersister(store, 'timesweeper-local-meta')

  await persister.load()
  await persister.startAutoSave()

  return store
}

export async function getSelectedParticipantName(eventId: string): Promise<string | null> {
  const localStore = await localStorePromise
  const selected = localStore.getCell(
    SELECTED_PARTICIPANTS_TABLE,
    eventId,
    SELECTED_PARTICIPANT_NAME_CELL,
  )

  return typeof selected === 'string' ? selected : null
}

export async function setSelectedParticipantName(
  eventId: string,
  participantName: string,
): Promise<void> {
  const localStore = await localStorePromise

  localStore.setCell(
    SELECTED_PARTICIPANTS_TABLE,
    eventId,
    SELECTED_PARTICIPANT_NAME_CELL,
    participantName,
  )
}

function readScheduleFromStore(
  store: Store,
  eventId: string,
): Pick<
  AppEvent,
  | 'dates'
  | 'slotMinutes'
  | 'defaultWindowStartMin'
  | 'defaultWindowEndMin'
  | 'defaultWindowTimezone'
> | null {
  const dates = store.getCell(EVENT_META_TABLE, eventId, EVENT_DATES_CELL)
  const slotMinutes = store.getCell(EVENT_META_TABLE, eventId, EVENT_SLOT_MINUTES_CELL)
  const defaultWindowStartMin = store.getCell(
    EVENT_META_TABLE,
    eventId,
    EVENT_DEFAULT_WINDOW_START_MIN_CELL,
  )
  const defaultWindowEndMin = store.getCell(
    EVENT_META_TABLE,
    eventId,
    EVENT_DEFAULT_WINDOW_END_MIN_CELL,
  )
  const defaultWindowTimezone = store.getCell(
    EVENT_META_TABLE,
    eventId,
    EVENT_DEFAULT_WINDOW_TIMEZONE_CELL,
  )
  const parsedDates = Array.isArray(dates)
    ? dates.filter((date): date is string => typeof date === 'string')
    : null
  const rawDatesLength = Array.isArray(dates) ? dates.length : -1

  if (
    !parsedDates ||
    parsedDates.length !== rawDatesLength ||
    typeof slotMinutes !== 'number' ||
    typeof defaultWindowStartMin !== 'number' ||
    typeof defaultWindowEndMin !== 'number' ||
    typeof defaultWindowTimezone !== 'string'
  ) {
    return null
  }

  return {
    dates: parsedDates,
    slotMinutes,
    defaultWindowStartMin,
    defaultWindowEndMin,
    defaultWindowTimezone,
  }
}

function readConfirmedFieldsFromStore(
  store: Store,
  eventId: string,
): Pick<AppEvent, 'confirmedBy' | 'confirmedStartUtc'> {
  const confirmedBy = store.getCell(EVENT_META_TABLE, eventId, EVENT_CONFIRMED_BY_CELL)
  const confirmedStartUtc = store.getCell(EVENT_META_TABLE, eventId, EVENT_CONFIRMED_START_UTC_CELL)

  if (
    typeof confirmedBy !== 'string' ||
    !confirmedBy.trim() ||
    typeof confirmedStartUtc !== 'string' ||
    !isValid(parseISO(confirmedStartUtc))
  ) {
    return {}
  }

  return {
    confirmedBy,
    confirmedStartUtc,
  }
}

function readParticipantsFromStore(store: Store, slotCount: number): Participant[] {
  if (!store.hasTable(PARTICIPANTS_TABLE)) {
    return []
  }

  return store
    .getRowIds(PARTICIPANTS_TABLE)
    .map((rowId) => {
      const name = store.getCell(PARTICIPANTS_TABLE, rowId, PARTICIPANT_NAME_CELL)
      const order = store.getCell(PARTICIPANTS_TABLE, rowId, PARTICIPANT_ORDER_CELL)

      return typeof name === 'string'
        ? {
            rowId: String(rowId),
            name,
            order: typeof order === 'number' ? order : Number.MAX_SAFE_INTEGER,
          }
        : null
    })
    .filter(
      (participant): participant is { rowId: string; name: string; order: number } =>
        participant !== null,
    )
    .sort((a, b) => {
      if (a.order !== b.order) {
        return a.order - b.order
      }

      return a.name.localeCompare(b.name)
    })
    .map((participant) => {
      const slots = new Array(slotCount).fill(0) as SlotValue[]

      if (store.hasRow(AVAILABILITY_TABLE, participant.rowId)) {
        const availabilityRow = store.getRow(AVAILABILITY_TABLE, participant.rowId)

        Object.entries(availabilityRow).forEach(([cellId, rawValue]) => {
          const slotIndex = parseSlotIndex(cellId)

          if (slotIndex === null || slotIndex >= slotCount) {
            return
          }

          if (rawValue === 0 || rawValue === 1 || rawValue === 2) {
            slots[slotIndex] = rawValue
          }
        })
      }

      return {
        name: participant.name,
        slots,
      }
    })
}

function readEventFromStore(store: EventRoomStore, eventId: string): AppEvent | undefined {
  if (!store.hasRow(EVENT_META_TABLE, eventId)) {
    return undefined
  }

  const name = store.getCell(EVENT_META_TABLE, eventId, EVENT_NAME_CELL)
  const created = store.getCell(EVENT_META_TABLE, eventId, EVENT_CREATED_CELL)

  if (typeof name !== 'string' || typeof created !== 'number') {
    return undefined
  }

  const schedule = readScheduleFromStore(store, eventId)

  if (!schedule) {
    return undefined
  }

  const participants = readParticipantsFromStore(store, getEventSlotCount(schedule))
  const confirmed = readConfirmedFieldsFromStore(store, eventId)

  return {
    id: eventId,
    name,
    created,
    ...schedule,
    ...confirmed,
    participants,
  }
}

function getRecentlyOpenedEvents(store: Store): RecentEventSummary[] {
  const raw = store.getValue(RECENTLY_OPENED_EVENTS_VALUE)

  if (!Array.isArray(raw)) {
    return []
  }

  return raw
    .filter((entry): entry is RecentEventSummary => {
      if (!entry || typeof entry !== 'object') {
        return false
      }

      const candidate = entry as Partial<RecentEventSummary>

      return (
        typeof candidate.id === 'string' &&
        typeof candidate.name === 'string' &&
        typeof candidate.created === 'number'
      )
    })
    .slice(0, MAX_RECENT_EVENTS)
}

async function pushRecentSummary(summary: RecentEventSummary): Promise<void> {
  const localStore = await localStorePromise
  const recentlyOpenedEvents = getRecentlyOpenedEvents(localStore)
  const nextRecentlyOpenedEvents = [
    summary,
    ...recentlyOpenedEvents.filter((entry) => entry.id !== summary.id),
  ].slice(0, MAX_RECENT_EVENTS)

  localStore.setValue(RECENTLY_OPENED_EVENTS_VALUE, nextRecentlyOpenedEvents)
}

async function stopEventRoomSync(): Promise<void> {
  eventRoomSyncPromise = null

  if (!eventRoomSynchronizer) {
    return
  }

  try {
    await eventRoomSynchronizer.stopSync()
  } catch (error) {
    console.error('Failed to stop event room sync', error)
  }

  eventRoomSynchronizer = null
}

async function startEventRoomSync(eventId: string, store: EventRoomStore): Promise<void> {
  await stopEventRoomSync()

  try {
    const ws = new ReconnectingWebSocket(eventSyncUrl(eventId), [], {
      maxRetries: Infinity,
    })
    const synchronizer = await createWsSynchronizer(store, ws)

    await synchronizer.startSync()
    eventRoomSynchronizer = synchronizer
  } catch (error) {
    eventRoomSynchronizer = null
    console.error('Failed to start event room sync', error)
  }
}

function ensureEventRoomSync(eventId: string, store: EventRoomStore): void {
  if (eventRoomId !== eventId) {
    return
  }

  if (eventRoomSyncPromise) {
    return
  }

  eventRoomSyncPromise = startEventRoomSync(eventId, store)
    .catch((error) => {
      console.error('Failed to initialize event room sync', error)
    })
    .finally(() => {
      if (eventRoomId === eventId) {
        eventRoomSyncPromise = null
      }
    })
}

async function loadEventRoomStore(eventId: string): Promise<EventRoomStore> {
  const eventRoomStore = createMergeableStore(`sync-${eventId}`)
  const persister = createIndexedDbPersister(eventRoomStore, `timesweeper-events-main-${eventId}`)

  await persister.load()
  await persister.startAutoSave()

  return eventRoomStore
}

async function requireOpenEventRoomStore(eventId: string): Promise<EventRoomStore> {
  if (!eventRoomStorePromise || eventRoomId !== eventId) {
    throw new Error(`Event store is not open for ${eventId}`)
  }

  const store = await eventRoomStorePromise
  return store
}

export async function openEventStore(eventId: string): Promise<void> {
  if (!eventRoomStorePromise || eventRoomId !== eventId) {
    await stopEventRoomSync()

    eventRoomId = eventId
    eventRoomStorePromise = loadEventRoomStore(eventId)
  }

  const store = await eventRoomStorePromise

  ensureEventRoomSync(eventId, store)
}

export async function closeEventStore(eventId?: string): Promise<void> {
  if (eventId && eventRoomId !== eventId) {
    return
  }

  await stopEventRoomSync()

  eventRoomId = null
  eventRoomStorePromise = null
}

function writeNormalizedEvent(store: EventRoomStore, event: AppEvent): void {
  store.transaction(() => {
    const slotCount = getEventSlotCount(event)

    store.setCell(EVENT_META_TABLE, event.id, EVENT_NAME_CELL, event.name)
    store.setCell(EVENT_META_TABLE, event.id, EVENT_CREATED_CELL, event.created)
    store.setCell(EVENT_META_TABLE, event.id, EVENT_DATES_CELL, event.dates)
    store.setCell(EVENT_META_TABLE, event.id, EVENT_SLOT_MINUTES_CELL, event.slotMinutes)
    store.setCell(
      EVENT_META_TABLE,
      event.id,
      EVENT_DEFAULT_WINDOW_START_MIN_CELL,
      event.defaultWindowStartMin,
    )
    store.setCell(
      EVENT_META_TABLE,
      event.id,
      EVENT_DEFAULT_WINDOW_END_MIN_CELL,
      event.defaultWindowEndMin,
    )
    store.setCell(
      EVENT_META_TABLE,
      event.id,
      EVENT_DEFAULT_WINDOW_TIMEZONE_CELL,
      event.defaultWindowTimezone,
    )

    if (event.confirmedBy?.trim() && event.confirmedStartUtc) {
      store.setCell(EVENT_META_TABLE, event.id, EVENT_CONFIRMED_BY_CELL, event.confirmedBy)
      store.setCell(
        EVENT_META_TABLE,
        event.id,
        EVENT_CONFIRMED_START_UTC_CELL,
        event.confirmedStartUtc,
      )
    } else {
      store.delCell(EVENT_META_TABLE, event.id, EVENT_CONFIRMED_BY_CELL, true)
      store.delCell(EVENT_META_TABLE, event.id, EVENT_CONFIRMED_START_UTC_CELL, true)
    }

    const nextParticipantNames = new Set(event.participants.map((participant) => participant.name))

    if (store.hasTable(PARTICIPANTS_TABLE)) {
      store.getRowIds(PARTICIPANTS_TABLE).forEach((rowId) => {
        const participantName = String(rowId)

        if (!nextParticipantNames.has(participantName)) {
          store.delRow(PARTICIPANTS_TABLE, rowId)
          store.delRow(AVAILABILITY_TABLE, rowId)
        }
      })
    }

    event.participants.forEach((participant, order) => {
      store.setCell(PARTICIPANTS_TABLE, participant.name, PARTICIPANT_NAME_CELL, participant.name)
      store.setCell(PARTICIPANTS_TABLE, participant.name, PARTICIPANT_ORDER_CELL, order)

      const nextAvailabilityCellIds = new Set<string>()

      for (let slotIndex = 0; slotIndex < slotCount; slotIndex += 1) {
        const slotValue = participant.slots[slotIndex] ?? 0
        const cellId = slotCellId(slotIndex)

        nextAvailabilityCellIds.add(cellId)

        if (slotValue === 0) {
          store.delCell(AVAILABILITY_TABLE, participant.name, cellId, true)

          return
        }

        store.setCell(AVAILABILITY_TABLE, participant.name, cellId, slotValue)
      }

      if (store.hasRow(AVAILABILITY_TABLE, participant.name)) {
        Object.keys(store.getRow(AVAILABILITY_TABLE, participant.name)).forEach((cellId) => {
          if (!nextAvailabilityCellIds.has(cellId)) {
            store.delCell(AVAILABILITY_TABLE, participant.name, cellId, true)
          }
        })
      }
    })
  })
}

async function pushEventToRoomStore(event: AppEvent): Promise<void> {
  if (!eventRoomStorePromise || eventRoomId !== event.id) {
    await openEventStore(event.id)
  }

  const store = await requireOpenEventRoomStore(event.id)

  writeNormalizedEvent(store, event)
}

export async function listRecentEvents(): Promise<RecentEventSummary[]> {
  const localStore = await localStorePromise

  return getRecentlyOpenedEvents(localStore)
}

export async function pushRecentEvent(summary: RecentEventSummary): Promise<void> {
  await pushRecentSummary(summary)
}

export async function touchRecentEvent(eventId: string): Promise<void> {
  const localStore = await localStorePromise
  const recentlyOpenedEvents = getRecentlyOpenedEvents(localStore)
  const existing = recentlyOpenedEvents.find((entry) => entry.id === eventId)

  if (existing) {
    await pushRecentSummary(existing)

    return
  }

  const store =
    eventRoomId === eventId && eventRoomStorePromise
      ? await eventRoomStorePromise
      : await loadEventRoomStore(eventId)
  const event = readEventFromStore(store, eventId)

  if (!event) {
    return
  }

  await pushRecentSummary({
    id: event.id,
    name: event.name,
    created: event.created,
  })
}

export async function saveEvent(event: AppEvent): Promise<void> {
  await pushEventToRoomStore(event)
}

export async function getEvent(id: string): Promise<AppEvent | undefined> {
  const store = await requireOpenEventRoomStore(id)

  return readEventFromStore(store, id)
}

export async function subscribeEvent(
  eventId: string,
  onChange: (event: AppEvent | undefined) => void,
): Promise<() => void> {
  const store = await requireOpenEventRoomStore(eventId)
  const listenerId = store.addDidFinishTransactionListener(() => {
    onChange(readEventFromStore(store, eventId))
  })

  onChange(readEventFromStore(store, eventId))

  return () => {
    store.delListener(listenerId)
  }
}

export async function updateParticipantSlot(
  eventId: string,
  name: string,
  slotIndex: number,
  value: SlotValue,
): Promise<void> {
  const store = await requireOpenEventRoomStore(eventId)
  const schedule = readScheduleFromStore(store, eventId)

  if (!schedule) {
    return
  }

  if (
    !store.hasRow(PARTICIPANTS_TABLE, name) ||
    slotIndex < 0 ||
    slotIndex >= getEventSlotCount(schedule)
  ) {
    return
  }

  if (value === 0) {
    store.delCell(AVAILABILITY_TABLE, name, slotCellId(slotIndex), true)

    return
  }

  store.setCell(AVAILABILITY_TABLE, name, slotCellId(slotIndex), value)
}
