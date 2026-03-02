import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { AppEvent, SlotValue } from './types'

interface TimeSweeper extends DBSchema {
  events: {
    key: string
    value: AppEvent
    indexes: { 'by-created': number }
  }
  localState: {
    key: string
    value: {
      eventId: string
      participantName: string
      publishedAt?: number | null
      recentAt?: number | null
    }
  }
  pendingSync: {
    key: number
    value: SyncOp & { id?: number }
    indexes: { 'by-created': number }
  }
}

export interface ParticipantSyncPayload {
  eventId: string
  participantName: string
  slots: SlotValue[]
  baseVersion: number
  updatedAt: number
}

export interface EventSyncPayload {
  event: AppEvent
}

export type SyncOp =
  | { kind: 'participant'; payload: ParticipantSyncPayload; createdAt: number }
  | { kind: 'event'; payload: EventSyncPayload; createdAt: number }

let dbp: Promise<IDBPDatabase<TimeSweeper>> | null = null
const MAX_LOCAL_EVENTS = 5

function eventRecency(event: AppEvent, row?: { recentAt?: number | null }) {
  return row?.recentAt ?? event.created
}

async function pruneStoredEvents(db: IDBPDatabase<TimeSweeper>): Promise<void> {
  const [events, states] = await Promise.all([db.getAll('events'), db.getAll('localState')])

  if (events.length <= MAX_LOCAL_EVENTS) {
    return
  }

  const stateById = new Map(states.map((s) => [s.eventId, s]))
  const ranked = events
    .map((event) => ({ event, score: eventRecency(event, stateById.get(event.id)) }))
    .sort((a, b) => b.score - a.score)
  const keepIds = new Set(ranked.slice(0, MAX_LOCAL_EVENTS).map((r) => r.event.id))
  await Promise.all(
    events
      .filter((event) => !keepIds.has(event.id))
      .flatMap((event) => [db.delete('events', event.id), db.delete('localState', event.id)]),
  )
}

function getDB() {
  if (!dbp) {
    dbp = openDB<TimeSweeper>('timesweeper', 3, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('events')) {
          const store = db.createObjectStore('events', { keyPath: 'id' })
          store.createIndex('by-created', 'created')
        }

        if (!db.objectStoreNames.contains('localState')) {
          db.createObjectStore('localState', { keyPath: 'eventId' })
        }

        if (!db.objectStoreNames.contains('pendingSync')) {
          const pending = db.createObjectStore('pendingSync', {
            keyPath: 'id',
            autoIncrement: true,
          })
          pending.createIndex('by-created', 'createdAt')
        }
      },
    })
  }

  return dbp
}

export async function saveEvent(event: AppEvent): Promise<void> {
  const db = await getDB()
  const now = Date.now()
  await db.put('events', event)
  const existing = await db.get('localState', event.id)
  await db.put('localState', {
    eventId: event.id,
    participantName: existing?.participantName ?? '',
    publishedAt: existing?.publishedAt ?? null,
    recentAt: now,
  })
  await pruneStoredEvents(db)
}

export async function getEvent(id: string): Promise<AppEvent | undefined> {
  const db = await getDB()

  return db.get('events', id)
}

export async function listEvents(): Promise<AppEvent[]> {
  const db = await getDB()
  const [events, states] = await Promise.all([db.getAll('events'), db.getAll('localState')])
  const stateById = new Map(states.map((s) => [s.eventId, s]))

  return events
    .sort((a, b) => eventRecency(b, stateById.get(b.id)) - eventRecency(a, stateById.get(a.id)))
    .slice(0, MAX_LOCAL_EVENTS)
}

export async function updateParticipantSlots(
  eventId: string,
  name: string,
  slots: SlotValue[],
  updatedAt: number,
  version?: number,
): Promise<void> {
  const db = await getDB()
  const event = await db.get('events', eventId)

  if (!event) {
    return
  }

  const idx = event.participants.findIndex((p) => p.name === name)

  if (idx !== -1) {
    event.participants[idx] = { ...event.participants[idx], slots, updatedAt, version }
  }

  await db.put('events', event)
}

export async function getSelectedParticipant(eventId: string): Promise<string | null> {
  const db = await getDB()
  const row = await db.get('localState', eventId)

  return row?.participantName ?? null
}

export async function setSelectedParticipant(
  eventId: string,
  participantName: string,
): Promise<void> {
  const db = await getDB()
  const existing = await db.get('localState', eventId)
  await db.put('localState', {
    eventId,
    participantName,
    publishedAt: existing?.publishedAt ?? null,
    recentAt: existing?.recentAt ?? null,
  })
}

export async function getPublishedAt(eventId: string): Promise<number | null> {
  const db = await getDB()
  const row = await db.get('localState', eventId)

  return row?.publishedAt ?? null
}

export async function setPublishedAt(eventId: string, publishedAt: number): Promise<void> {
  const db = await getDB()
  const existing = await db.get('localState', eventId)
  await db.put('localState', {
    eventId,
    participantName: existing?.participantName ?? '',
    publishedAt,
    recentAt: existing?.recentAt ?? null,
  })
}

export async function touchEventRecent(eventId: string): Promise<void> {
  const db = await getDB()
  const existing = await db.get('localState', eventId)
  await db.put('localState', {
    eventId,
    participantName: existing?.participantName ?? '',
    publishedAt: existing?.publishedAt ?? null,
    recentAt: Date.now(),
  })
  await pruneStoredEvents(db)
}

export async function enqueueSyncOp(op: SyncOp): Promise<number> {
  const db = await getDB()

  return db.add('pendingSync', op)
}

export async function listPendingSyncOps(): Promise<Array<SyncOp & { id: number }>> {
  const db = await getDB()
  const ops = await db.getAllFromIndex('pendingSync', 'by-created')

  return ops.filter((op): op is SyncOp & { id: number } => typeof op.id === 'number')
}

export async function removePendingSyncOp(id: number): Promise<void> {
  const db = await getDB()
  await db.delete('pendingSync', id)
}

export async function hasPendingSyncForEvent(eventId: string): Promise<boolean> {
  const pending = await listPendingSyncOps()

  return pending.some((op) => {
    if (op.kind === 'event') {
      return op.payload.event.id === eventId
    }

    return op.payload.eventId === eventId
  })
}
