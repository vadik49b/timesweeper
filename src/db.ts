import { createMergeableStore } from 'tinybase/mergeable-store'
import { createStore, type Store } from 'tinybase/store'
import { createIndexedDbPersister } from 'tinybase/persisters/persister-indexed-db'
import { createLocalPersister } from 'tinybase/persisters/persister-browser'
import {
  createWsSynchronizer,
  type WsSynchronizer,
} from 'tinybase/synchronizers/synchronizer-ws-client'
import ReconnectingWebSocket from 'reconnecting-websocket'
import type { AppEvent, Participant, SlotValue } from './event-helpers'

const EVENT_META_TABLE = 'eventMeta'
const EVENT_NAME_CELL = 'name'
const EVENT_CREATED_CELL = 'created'
const EVENT_SLOT_STARTS_UTC_ISO_CELL = 'slotStartsUtcIso'
const EVENT_PARTICIPANT_NAMES_CELL = 'participantNames'
const EVENT_CONFIRMED_BY_CELL = 'confirmedBy'
const EVENT_CONFIRMED_START_UTC_CELL = 'confirmedStartUtc'
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

function readSlotStartsUtcIsoFromStore(
  store: Store,
  eventId: string,
): Pick<AppEvent, 'slotStartsUtcIso'> {
  return {
    slotStartsUtcIso: store.getCell(
      EVENT_META_TABLE,
      eventId,
      EVENT_SLOT_STARTS_UTC_ISO_CELL,
    ) as string[],
  }
}

function readParticipantNamesFromStore(store: Store, eventId: string): string[] {
  return (store.getCell(EVENT_META_TABLE, eventId, EVENT_PARTICIPANT_NAMES_CELL) as string[]) ?? []
}

function readConfirmedFieldsFromStore(
  store: Store,
  eventId: string,
): Pick<AppEvent, 'confirmedBy' | 'confirmedStartUtc'> {
  const confirmedBy = store.getCell(EVENT_META_TABLE, eventId, EVENT_CONFIRMED_BY_CELL)
  const confirmedStartUtc = store.getCell(EVENT_META_TABLE, eventId, EVENT_CONFIRMED_START_UTC_CELL)

  return typeof confirmedBy === 'string' && typeof confirmedStartUtc === 'string'
    ? {
        confirmedBy,
        confirmedStartUtc,
      }
    : {}
}

function readParticipantsFromStore(store: Store, participantNames: string[]): Participant[] {
  return participantNames.map((name) => {
    return {
      name,
      slots: store.hasRow(AVAILABILITY_TABLE, name)
        ? ({ ...store.getRow(AVAILABILITY_TABLE, name) } as Participant['slots'])
        : {},
    }
  })
}

function readEventFromStore(store: EventRoomStore, eventId: string): AppEvent | undefined {
  if (!store.hasRow(EVENT_META_TABLE, eventId)) {
    return
  }

  const name = store.getCell(EVENT_META_TABLE, eventId, EVENT_NAME_CELL)
  const created = store.getCell(EVENT_META_TABLE, eventId, EVENT_CREATED_CELL)

  const slotStartsUtcIso = readSlotStartsUtcIsoFromStore(store, eventId)
  const participants = readParticipantsFromStore(
    store,
    readParticipantNamesFromStore(store, eventId),
  )
  const confirmed = readConfirmedFieldsFromStore(store, eventId)

  return {
    id: eventId,
    name: name as string,
    created: created as number,
    ...slotStartsUtcIso,
    ...confirmed,
    participants,
  }
}

function writeEventMeta(store: EventRoomStore, event: Pick<AppEvent, 'id' | 'name' | 'created'>): void {
  store.setCell(EVENT_META_TABLE, event.id, EVENT_NAME_CELL, event.name)
  store.setCell(EVENT_META_TABLE, event.id, EVENT_CREATED_CELL, event.created)
}

function writeEventSlots(
  store: EventRoomStore,
  event: Pick<AppEvent, 'id' | 'slotStartsUtcIso'>,
): void {
  store.setCell(EVENT_META_TABLE, event.id, EVENT_SLOT_STARTS_UTC_ISO_CELL, event.slotStartsUtcIso)
}

function writeParticipantNames(
  store: EventRoomStore,
  eventId: string,
  participants: Participant[],
): void {
  store.setCell(
    EVENT_META_TABLE,
    eventId,
    EVENT_PARTICIPANT_NAMES_CELL,
    participants.map((participant) => participant.name),
  )
}

function writeConfirmation(
  store: EventRoomStore,
  eventId: string,
  confirmedBy?: string,
  confirmedStartUtc?: string,
): void {
  if (confirmedBy?.trim() && confirmedStartUtc) {
    store.setCell(EVENT_META_TABLE, eventId, EVENT_CONFIRMED_BY_CELL, confirmedBy)
    store.setCell(EVENT_META_TABLE, eventId, EVENT_CONFIRMED_START_UTC_CELL, confirmedStartUtc)
  } else {
    store.delCell(EVENT_META_TABLE, eventId, EVENT_CONFIRMED_BY_CELL, true)
    store.delCell(EVENT_META_TABLE, eventId, EVENT_CONFIRMED_START_UTC_CELL, true)
  }
}

function syncParticipantAvailability(
  store: EventRoomStore,
  participants: Participant[],
): void {
  const nextParticipantNames = new Set(participants.map((participant) => participant.name))

  if (store.hasTable(AVAILABILITY_TABLE)) {
    store.getRowIds(AVAILABILITY_TABLE).forEach((rowId) => {
      if (!nextParticipantNames.has(String(rowId))) {
        store.delRow(AVAILABILITY_TABLE, rowId)
      }
    })
  }

  participants.forEach((participant) => {
    const nextAvailabilityCellIds = new Set(Object.keys(participant.slots))

    Object.entries(participant.slots).forEach(([slotStartUtcIso, slotValue]) => {
      store.setCell(AVAILABILITY_TABLE, participant.name, slotStartUtcIso, slotValue)
    })

    if (store.hasRow(AVAILABILITY_TABLE, participant.name)) {
      Object.keys(store.getRow(AVAILABILITY_TABLE, participant.name)).forEach((cellId) => {
        if (!nextAvailabilityCellIds.has(cellId)) {
          store.delCell(AVAILABILITY_TABLE, participant.name, cellId, true)
        }
      })
    }
  })
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

async function requireWritableEventStore(eventId: string): Promise<EventRoomStore> {
  if (!eventRoomStorePromise || eventRoomId !== eventId) {
    await openEventStore(eventId)
  }

  return requireOpenEventRoomStore(eventId)
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

export async function createEvent(event: AppEvent): Promise<void> {
  const store = await requireWritableEventStore(event.id)

  store.transaction(() => {
    writeEventMeta(store, event)
    writeEventSlots(store, event)
    writeParticipantNames(store, event.id, event.participants)
    writeConfirmation(store, event.id, event.confirmedBy, event.confirmedStartUtc)
    syncParticipantAvailability(store, event.participants)
  })
}

export async function updateEventSettings(
  eventId: string,
  settings: Pick<AppEvent, 'name' | 'participants'>,
): Promise<void> {
  const store = await requireWritableEventStore(eventId)
  const created = store.getCell(EVENT_META_TABLE, eventId, EVENT_CREATED_CELL) as number

  store.transaction(() => {
    writeEventMeta(store, {
      id: eventId,
      name: settings.name,
      created,
    })
    writeParticipantNames(store, eventId, settings.participants)
    syncParticipantAvailability(store, settings.participants)
  })
}

export async function confirmEvent(
  eventId: string,
  confirmedBy: string,
  confirmedStartUtc: string,
): Promise<void> {
  const store = await requireWritableEventStore(eventId)

  store.transaction(() => {
    writeConfirmation(store, eventId, confirmedBy, confirmedStartUtc)
  })
}

export async function unconfirmEvent(eventId: string): Promise<void> {
  const store = await requireWritableEventStore(eventId)

  store.transaction(() => {
    writeConfirmation(store, eventId)
  })
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
  slotStartUtcIso: string,
  value: SlotValue,
): Promise<void> {
  const store = await requireOpenEventRoomStore(eventId)

  if (!readParticipantNamesFromStore(store, eventId).includes(name)) {
    return
  }

  if (value === 0) {
    store.delCell(AVAILABILITY_TABLE, name, slotStartUtcIso, true)

    return
  }

  store.setCell(AVAILABILITY_TABLE, name, slotStartUtcIso, value)
}
