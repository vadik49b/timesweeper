import { createMemo } from 'solid-js'
import type { Accessor } from 'solid-js'
import { createStore } from 'tinybase'
import { createMergeableStore } from 'tinybase/mergeable-store'
import { createLocalPersister } from 'tinybase/persisters/persister-browser'
import {
  createWsSynchronizer,
  type WsSynchronizer,
} from 'tinybase/synchronizers/synchronizer-ws-client'
import { useCell, useTable } from 'tinybase/ui-solid'
import ReconnectingWebSocket from 'reconnecting-websocket'
import type { AppEvent, Participant, SlotMap } from './event-helpers'
import {
  AVAILABILITY_TABLE,
  EVENT_META_CREATED_CELL,
  EVENT_META_TABLE,
  EVENT_META_NAME_CELL,
  EVENT_META_PARTICIPANT_NAMES_CELL,
  EVENT_META_SLOT_STARTS_UTC_ISO_CELL,
} from '../shared/tinybase-schema.ts'

// ─── Local store (device-only, non-synced) ───────────────────────────────────

export const RECENT_EVENTS_TABLE = 'recentEvents'
export const SELECTED_PARTICIPANTS_TABLE = 'selectedParticipants'
export const DISPLAY_TIMEZONE_VALUE = 'displayTimezone'

const MAX_RECENT_EVENTS = 5

const localStore = createStore()
const localPersister = createLocalPersister(localStore, 'timesweeper-local')

localPersister
  .load()
  .then(() => localPersister.startAutoSave())
  .catch((error) => {
    console.error('Failed to load local store', error)
  })

export function getLocalStore() {
  return localStore
}

export function setSelectedParticipant(eventId: string, name: string): void {
  localStore.setCell(SELECTED_PARTICIPANTS_TABLE, eventId, 'name', name)
}

export function clearSelectedParticipant(eventId: string): void {
  localStore.delRow(SELECTED_PARTICIPANTS_TABLE, eventId)
}

export function setDisplayTimezone(timezone: string): void {
  localStore.setValue(DISPLAY_TIMEZONE_VALUE, timezone)
}

export function pushRecentEvent(summary: RecentEventSummary): void {
  localStore.setRow(RECENT_EVENTS_TABLE, summary.id, {
    name: summary.name,
    created: summary.created,
  })

  const table = localStore.getTable(RECENT_EVENTS_TABLE)
  const sorted = Object.keys(table).sort(
    (a, b) => (table[b]!.created as number) - (table[a]!.created as number),
  )

  sorted.slice(MAX_RECENT_EVENTS).forEach((id) => {
    localStore.delRow(RECENT_EVENTS_TABLE, id)
  })
}

// ─── Reactive hooks ──────────────────────────────────────────────────────────

export function useParticipants(eventId: string): Accessor<Participant[]> {
  const participantNames = useCell(
    EVENT_META_TABLE,
    eventId,
    EVENT_META_PARTICIPANT_NAMES_CELL,
  ) as () => string[] | undefined
  const availabilityTable = useTable(AVAILABILITY_TABLE) as () => Record<string, SlotMap>

  return createMemo<Participant[]>(() => {
    const names = participantNames() ?? []
    const avail = availabilityTable()

    return names.map((name) => ({ name, slots: (avail[name] ?? {}) as SlotMap }))
  })
}

export function useSelectedParticipant(
  eventId: string,
  participants: Accessor<Participant[]>,
): { currentName: Accessor<string>; storedName: Accessor<string | undefined> } {
  const storedName = useCell(
    SELECTED_PARTICIPANTS_TABLE,
    eventId,
    'name',
    localStore,
  ) as () => string | undefined
  const currentName = createMemo(() => {
    const stored = storedName()

    if (!stored) return ''

    return participants().some((p) => p.name === stored) ? stored : ''
  })

  return { currentName, storedName }
}

// ─── Event room store (synced via WebSocket) ─────────────────────────────────

type EventRoomStore = ReturnType<typeof createMergeableStore>

export interface RecentEventSummary {
  id: string
  name: string
  created: number
}

let eventRoomId: string | null = null
let eventRoomStore: EventRoomStore | null = null
let eventRoomSynchronizer: WsSynchronizer<ReconnectingWebSocket> | null = null
let eventRoomSyncPromise: Promise<void> | null = null

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
}

function requireWritableEventStore(eventId: string): EventRoomStore {
  if (!eventRoomStore || eventRoomId !== eventId) {
    return openEventStore(eventId)
  }

  return eventRoomStore
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

export function createEvent(event: AppEvent): void {
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

