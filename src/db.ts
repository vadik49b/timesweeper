import { createMergeableStore } from 'tinybase/mergeable-store'
import type { Store } from 'tinybase/store'
import { createLocalPersister } from 'tinybase/persisters/persister-browser'
import {
  createWsSynchronizer,
  type WsSynchronizer,
} from 'tinybase/synchronizers/synchronizer-ws-client'
import ReconnectingWebSocket from 'reconnecting-websocket'
import type { AppEvent, Participant, SlotValue } from './event-helpers'
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
let eventRoomStorePromise: Promise<EventRoomStore> | null = null
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

function readSlotStartsUtcIsoFromStore(
  store: Store,
  eventId: string,
): Pick<AppEvent, 'slotStartsUtcIso'> {
  return {
    slotStartsUtcIso: store.getCell(
      EVENT_META_TABLE,
      eventId,
      EVENT_META_SLOT_STARTS_UTC_ISO_CELL,
    ) as string[],
  }
}

function readParticipantNamesFromStore(store: Store, eventId: string): string[] {
  return (
    (store.getCell(EVENT_META_TABLE, eventId, EVENT_META_PARTICIPANT_NAMES_CELL) as string[]) ?? []
  )
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

  const name = store.getCell(EVENT_META_TABLE, eventId, EVENT_META_NAME_CELL)
  const created = store.getCell(EVENT_META_TABLE, eventId, EVENT_META_CREATED_CELL)

  const slotStartsUtcIso = readSlotStartsUtcIsoFromStore(store, eventId)
  const participants = readParticipantsFromStore(
    store,
    readParticipantNamesFromStore(store, eventId),
  )

  return {
    id: eventId,
    name: name as string,
    created: created as number,
    ...slotStartsUtcIso,
    participants,
  }
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

async function loadEventRoomStore(eventId: string): Promise<EventRoomStore> {
  const eventRoomStore = createMergeableStore(`sync-${eventId}`)

  // Keep the local mergeable state on-device so CRDT metadata survives reloads
  // before the websocket synchronizer reconnects to the shared event room.
  const persister = createLocalPersister(eventRoomStore, `timesweeper-events-main-${eventId}`)

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
    setEventSyncState('connecting')
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

async function requireWritableEventStore(eventId: string): Promise<EventRoomStore> {
  if (!eventRoomStorePromise || eventRoomId !== eventId) {
    await openEventStore(eventId)
  }

  return requireOpenEventRoomStore(eventId)
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
  const store = await requireWritableEventStore(event.id)

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
  const store = await requireWritableEventStore(eventId)
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

export async function getEvent(id: string): Promise<AppEvent | undefined> {
  const store = await requireOpenEventRoomStore(id)

  return readEventFromStore(store, id)
}

export async function subscribeEvent(
  eventId: string,
  onChange: (event: AppEvent | undefined) => void,
): Promise<() => void> {
  const store = await requireOpenEventRoomStore(eventId)
  const listenerId = store.addTablesListener(() => {
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

export async function updateParticipantSlots(
  eventId: string,
  name: string,
  slotStartUtcIsos: string[],
  value: SlotValue,
): Promise<void> {
  const store = await requireOpenEventRoomStore(eventId)

  if (!readParticipantNamesFromStore(store, eventId).includes(name)) {
    return
  }

  const uniqueSlotStartUtcIsos = [...new Set(slotStartUtcIsos)]

  if (uniqueSlotStartUtcIsos.length === 0) {
    return
  }

  store.transaction(() => {
    uniqueSlotStartUtcIsos.map((slotStartUtcIso) =>
      value === 0
        ? store.delCell(AVAILABILITY_TABLE, name, slotStartUtcIso, true)
        : store.setCell(AVAILABILITY_TABLE, name, slotStartUtcIso, value),
    )
  })
}
