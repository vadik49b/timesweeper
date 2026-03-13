import { createMergeableStore } from 'tinybase/mergeable-store'
import { createStore, type Store } from 'tinybase/store'
import { createIndexedDbPersister } from 'tinybase/persisters/persister-indexed-db'
import { createLocalPersister } from 'tinybase/persisters/persister-browser'
import {
  createWsSynchronizer,
  type WsSynchronizer,
} from 'tinybase/synchronizers/synchronizer-ws-client'
import ReconnectingWebSocket from 'reconnecting-websocket'
import type { AppEvent, SlotValue } from './types'

const EVENT_TABLE = 'events'
const EVENT_CELL = 'event'
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

function readEventFromStore(store: Store, eventId: string): AppEvent | undefined {
  if (!store.hasRow(EVENT_TABLE, eventId)) {
    return undefined
  }

  const row = store.getRow(EVENT_TABLE, eventId) as Partial<Record<typeof EVENT_CELL, AppEvent>>

  if (!row || !row[EVENT_CELL]) {
    return undefined
  }

  return row[EVENT_CELL]
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

  eventRoomStore.setTablesSchema({
    [EVENT_TABLE]: {
      [EVENT_CELL]: { type: 'object' },
    },
  })

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

async function pushEventToRoomStore(event: AppEvent): Promise<void> {
  const store = await requireOpenEventRoomStore(event.id)

  store.setRow(EVENT_TABLE, event.id, {
    [EVENT_CELL]: event as unknown as Record<string, unknown>,
  })
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

  const listenerId = store.addTableListener(EVENT_TABLE, (_store, tableId) => {
    if (tableId !== EVENT_TABLE) {
      return
    }

    onChange(readEventFromStore(store, eventId))
  })

  onChange(readEventFromStore(store, eventId))

  return () => {
    store.delListener(listenerId)
  }
}

export async function updateParticipantSlots(
  eventId: string,
  name: string,
  slots: SlotValue[],
  updatedAt: number,
  version?: number,
): Promise<void> {
  const event = await getEvent(eventId)

  if (!event) {
    return
  }

  const index = event.participants.findIndex((participant) => participant.name === name)

  if (index < 0) {
    return
  }

  const nextParticipants = [...event.participants]
  nextParticipants[index] = {
    ...nextParticipants[index],
    slots,
    updatedAt,
    version,
  }

  await saveEvent({
    ...event,
    participants: nextParticipants,
  })
}
