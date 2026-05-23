import { createMergeableStore } from 'tinybase/mergeable-store'
import { createLocalPersister } from 'tinybase/persisters/persister-browser'
import {
  createWsSynchronizer,
  type WsSynchronizer,
} from 'tinybase/synchronizers/synchronizer-ws-client'
import ReconnectingWebSocket from 'reconnecting-websocket'
import type { AppEvent, Participant } from './event-helpers'
import {
  AVAILABILITY_TABLE,
  EVENT_META_CREATED_CELL,
  EVENT_META_TABLE,
  EVENT_META_NAME_CELL,
  EVENT_META_PARTICIPANT_NAMES_CELL,
  EVENT_META_SLOT_STARTS_UTC_ISO_CELL,
} from '../shared/tinybase-schema.ts'

const RECENT_EVENTS_STORAGE_KEY = 'timesweeper-recent-events'
const SELECTED_PARTICIPANT_STORAGE_KEY_PREFIX = 'timesweeper-selected-participant:'
const MAX_RECENT_EVENTS = 5

type EventRoomStore = ReturnType<typeof createMergeableStore>

export interface RecentEventSummary {
  id: string
  name: string
  created: number
}

export type EventSyncState = 'connecting' | 'connected' | 'reconnecting'

let eventRoomId: string | null = null
let eventRoomStore: EventRoomStore | null = null
let eventRoomSynchronizer: WsSynchronizer<ReconnectingWebSocket> | null = null
let eventRoomSyncPromise: Promise<void> | null = null
let eventSyncState: EventSyncState = 'connecting'
const eventSyncStateListeners = new Set<(state: EventSyncState) => void>()

function setEventSyncState(next: EventSyncState): void {
  eventSyncState = next
  Array.from(eventSyncStateListeners, (listener) => listener(next))
}

function getApiOrigin(): string {
  const origin = import.meta.env.VITE_API_ORIGIN

  if (!origin) {
    throw new Error('Missing VITE_API_ORIGIN')
  }

  return origin
}

function eventSyncUrl(eventId: string): string {
  const origin = getApiOrigin()
  const url = new URL(origin)

  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.pathname = `/api/events/${encodeURIComponent(eventId)}`

  return url.toString()
}

function eventJsonUrl(eventId: string): string {
  const url = new URL(getApiOrigin())

  url.pathname = `/api/events/${encodeURIComponent(eventId)}/json`

  return url.toString()
}

export function getSelectedParticipantName(eventId: string): string | null {
  return localStorage.getItem(`${SELECTED_PARTICIPANT_STORAGE_KEY_PREFIX}${eventId}`)
}

export function setSelectedParticipantName(eventId: string, participantName: string): void {
  localStorage.setItem(`${SELECTED_PARTICIPANT_STORAGE_KEY_PREFIX}${eventId}`, participantName)
}

export function clearSelectedParticipantName(eventId: string): void {
  localStorage.removeItem(`${SELECTED_PARTICIPANT_STORAGE_KEY_PREFIX}${eventId}`)
}

function writeEventMeta(
  store: EventRoomStore,
  event: Pick<AppEvent, 'id' | 'name' | 'created'>,
): void {
  store.setCell(EVENT_META_TABLE, event.id, EVENT_META_NAME_CELL, event.name)
  store.setCell(EVENT_META_TABLE, event.id, EVENT_META_CREATED_CELL, event.created)
}

function writeEventSlots(
  store: EventRoomStore,
  event: Pick<AppEvent, 'id' | 'slotStartsUtcIso'>,
): void {
  store.setCell(
    EVENT_META_TABLE,
    event.id,
    EVENT_META_SLOT_STARTS_UTC_ISO_CELL,
    event.slotStartsUtcIso,
  )
}

function writeParticipantNames(
  store: EventRoomStore,
  eventId: string,
  participants: Participant[],
): void {
  store.setCell(
    EVENT_META_TABLE,
    eventId,
    EVENT_META_PARTICIPANT_NAMES_CELL,
    participants.map((participant) => participant.name),
  )
}

function syncParticipantAvailability(store: EventRoomStore, participants: Participant[]): void {
  const nextParticipantNames = new Set(participants.map((participant) => participant.name))

  if (store.hasTable(AVAILABILITY_TABLE)) {
    store
      .getRowIds(AVAILABILITY_TABLE)
      .filter((rowId) => !nextParticipantNames.has(String(rowId)))
      .map((rowId) => store.delRow(AVAILABILITY_TABLE, rowId))
  }

  participants.map((participant) => {
    const nextAvailabilityCellIds = new Set(Object.keys(participant.slots))

    Object.entries(participant.slots).map(([slotStartUtcIso, slotValue]) =>
      store.setCell(AVAILABILITY_TABLE, participant.name, slotStartUtcIso, slotValue),
    )

    if (store.hasRow(AVAILABILITY_TABLE, participant.name)) {
      Object.keys(store.getRow(AVAILABILITY_TABLE, participant.name))
        .filter((cellId) => !nextAvailabilityCellIds.has(cellId))
        .map((cellId) => store.delCell(AVAILABILITY_TABLE, participant.name, cellId, true))
    }

    return participant
  })
}

function getRecentlyOpenedEvents(): RecentEventSummary[] {
  return (
    JSON.parse(localStorage.getItem(RECENT_EVENTS_STORAGE_KEY) ?? '[]') as RecentEventSummary[]
  ).slice(0, MAX_RECENT_EVENTS)
}

function pushRecentSummary(summary: RecentEventSummary): void {
  const recentlyOpenedEvents = getRecentlyOpenedEvents()
  const nextRecentlyOpenedEvents = [
    summary,
    ...recentlyOpenedEvents.filter((entry) => entry.id !== summary.id),
  ].slice(0, MAX_RECENT_EVENTS)

  localStorage.setItem(RECENT_EVENTS_STORAGE_KEY, JSON.stringify(nextRecentlyOpenedEvents))
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
  setEventSyncState('connecting')
}

async function startEventRoomSync(eventId: string, store: EventRoomStore): Promise<void> {
  await stopEventRoomSync()

  try {
    const ws = new ReconnectingWebSocket(eventSyncUrl(eventId), [], {
      maxRetries: Infinity,
    })
    let hasConnected = false

    ws.addEventListener('open', () => {
      hasConnected = true
      setEventSyncState('connected')
    })
    ws.addEventListener('close', () => {
      setEventSyncState(hasConnected ? 'reconnecting' : 'connecting')
    })
    const synchronizer = await createWsSynchronizer(store, ws)

    await synchronizer.startSync()
    eventRoomSynchronizer = synchronizer
  } catch (error) {
    eventRoomSynchronizer = null
    setEventSyncState('reconnecting')
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

export function openEventStore(eventId: string): EventRoomStore {
  if (eventRoomStore && eventRoomId === eventId) {
    ensureEventRoomSync(eventId, eventRoomStore)
    return eventRoomStore
  }

  if (eventRoomStore) {
    stopEventRoomSync().catch((error) => {
      console.error('Failed to stop previous event room sync', error)
    })
  }

  eventRoomId = eventId
  eventRoomStore = createMergeableStore(`sync-${eventId}`)
  setEventSyncState('connecting')

  // Keep the local mergeable state on-device so CRDT metadata survives reloads
  // before the websocket synchronizer reconnects to the shared event room.
  const persister = createLocalPersister(eventRoomStore, `timesweeper-events-main-${eventId}`)

  persister
    .load()
    .then(() => persister.startAutoSave())
    .catch((error) => {
      console.error('Failed to load event room persister', error)
    })

  ensureEventRoomSync(eventId, eventRoomStore)

  return eventRoomStore
}

export async function closeEventStore(eventId?: string): Promise<void> {
  if (eventId && eventRoomId !== eventId) {
    return
  }

  await stopEventRoomSync()

  eventRoomId = null
  eventRoomStore = null
  setEventSyncState('connecting')
}

export function subscribeEventSyncState(
  listener: (state: EventSyncState) => void,
): () => void {
  eventSyncStateListeners.add(listener)
  listener(eventSyncState)

  return () => {
    eventSyncStateListeners.delete(listener)
  }
}

function requireWritableEventStore(eventId: string): EventRoomStore {
  if (!eventRoomStore || eventRoomId !== eventId) {
    return openEventStore(eventId)
  }

  return eventRoomStore
}

export function listRecentEvents(): RecentEventSummary[] {
  return getRecentlyOpenedEvents()
}

export function pushRecentEvent(summary: RecentEventSummary): void {
  pushRecentSummary(summary)
}

export async function getEventJson(eventId: string): Promise<AppEvent | null> {
  const response = await fetch(eventJsonUrl(eventId))

  if (response.status === 404) {
    return null
  }

  if (!response.ok) {
    throw new Error(`Failed to load event JSON (${response.status})`)
  }

  return (await response.json()) as AppEvent
}

export async function createEvent(event: AppEvent): Promise<void> {
  const store = requireWritableEventStore(event.id)

  store.transaction(() => {
    writeEventMeta(store, event)
    writeEventSlots(store, event)
    writeParticipantNames(store, event.id, event.participants)
    syncParticipantAvailability(store, event.participants)
  })
}

export async function updateEventSettings(
  eventId: string,
  settings: Pick<AppEvent, 'name' | 'participants'>,
): Promise<void> {
  const store = requireWritableEventStore(eventId)
  const created = store.getCell(EVENT_META_TABLE, eventId, EVENT_META_CREATED_CELL) as number

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

