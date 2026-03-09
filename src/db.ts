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
const RECENT_QUEUE_VALUE = 'recentQueue'
const MAX_RECENT_EVENTS = 5

type EventSynchronizer = WsSynchronizer<ReconnectingWebSocket>
type EventRoomStore = ReturnType<typeof createMergeableStore>

export interface RecentEventSummary {
  id: string
  name: string
  created: number
}

let eventRoomId: string | null = null
let eventRoomStorePromise: Promise<EventRoomStore> | null = null
let eventRoomSynchronizer: EventSynchronizer | null = null
const recentMetaStorePromise = createRecentMetaStore()
const selectionStorePromise = createSelectionStore()

function eventSyncUrl(eventId: string): string {
  const origin = window.location.origin
  const url = new URL(origin)

  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.pathname = `/api/events/${encodeURIComponent(eventId)}`

  return url.toString()
}

async function createRecentMetaStore(): Promise<Store> {
  const store = createStore()

  store.setValuesSchema({
    [RECENT_QUEUE_VALUE]: { type: 'array', default: [] },
  })

  const persister = createLocalPersister(store, 'timesweeper-recent-events-meta')

  await persister.load()
  await persister.startAutoSave()

  return store
}

export async function createSelectionStore(): Promise<Store> {
  const store = createStore()

  const persister = createLocalPersister(store, 'timesweeper-event-selection')

  await persister.load()
  await persister.startAutoSave()

  return store
}

export async function getSelectedParticipant(eventId: string): Promise<string | null> {
  const selectionStore = await selectionStorePromise
  const selected = selectionStore.getValues()[eventId]

  return typeof selected === 'string' ? selected : null
}

export async function setSelectedParticipant(
  eventId: string,
  participantName: string,
): Promise<void> {
  const selectionStore = await selectionStorePromise

  selectionStore.setValue(eventId, participantName)
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

function getRecentQueue(store: Store): RecentEventSummary[] {
  const raw = store.getValue(RECENT_QUEUE_VALUE)

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
  const store = await recentMetaStorePromise
  const queue = getRecentQueue(store)
  const nextQueue = [summary, ...queue.filter((entry) => entry.id !== summary.id)].slice(
    0,
    MAX_RECENT_EVENTS,
  )

  store.setValue(RECENT_QUEUE_VALUE, nextQueue)
}

async function createEventRoomStore(eventId: string): Promise<EventRoomStore> {
  const eventRoomStore = createMergeableStore(`sync-${eventId}`)

  eventRoomStore.setTablesSchema({
    [EVENT_TABLE]: {
      [EVENT_CELL]: { type: 'object' },
    },
  })

  await startEventRoomSync(eventId, eventRoomStore)

  const persister = createIndexedDbPersister(eventRoomStore, `timesweeper-events-main-${eventId}`)

  await persister.startAutoSave()

  return eventRoomStore
}

async function stopEventRoomSync(): Promise<void> {
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

async function getEventRoomStore(eventId: string): Promise<EventRoomStore> {
  if (eventRoomStorePromise && eventRoomId === eventId) {
    return eventRoomStorePromise
  }

  await stopEventRoomSync()

  eventRoomId = eventId
  eventRoomStorePromise = createEventRoomStore(eventId)

  return eventRoomStorePromise
}

async function pushEventToRoomStore(event: AppEvent): Promise<void> {
  const store = await getEventRoomStore(event.id)

  store.setRow(EVENT_TABLE, event.id, {
    [EVENT_CELL]: event as unknown as Record<string, unknown>,
  })
}

export async function listRecentEvents(): Promise<RecentEventSummary[]> {
  const store = await recentMetaStorePromise

  return getRecentQueue(store)
}

export async function pushRecentEvent(summary: RecentEventSummary): Promise<void> {
  await pushRecentSummary(summary)
}

export async function touchRecentEvent(eventId: string): Promise<void> {
  const store = await recentMetaStorePromise
  const queue = getRecentQueue(store)
  const existing = queue.find((entry) => entry.id === eventId)

  if (existing) {
    await pushRecentSummary(existing)

    return
  }

  const event = await getEvent(eventId)

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
  const store = await getEventRoomStore(id)

  return readEventFromStore(store, id)
}

export async function subscribeEvent(
  eventId: string,
  onChange: (event: AppEvent | undefined) => void,
): Promise<() => void> {
  const store = await getEventRoomStore(eventId)

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
