import { createMergeableStore } from 'tinybase/mergeable-store'
import { createStore, type Store } from 'tinybase/store'
import { createIndexedDbPersister, type IndexedDbPersister } from 'tinybase/persisters/persister-indexed-db'
import { createWsSynchronizer, type WsSynchronizer } from 'tinybase/synchronizers/synchronizer-ws-client'
import type { AppEvent, SlotValue } from './types'

const EVENT_TABLE = 'events'
const EVENT_CELL = 'event'
const LOCAL_DB_NAME = 'timesweeper-local'
const EVENT_DB_PREFIX = 'timesweeper-event-'
const MAX_LOCAL_EVENTS = 5

const RECENT_TABLE = 'recentEvents'
const LOCAL_STATE_TABLE = 'localState'

type EventSynchronizer = WsSynchronizer<WebSocket>

interface EventSession {
  eventId: string
  store: ReturnType<typeof createMergeableStore>
  persister: IndexedDbPersister | null
  synchronizer: EventSynchronizer | null
}

interface LocalStateRow {
  participantName: string
  publishedAt: number | null
  recentAt: number | null
}

interface RecentEventRow {
  event: AppEvent
  recentAt: number
  created: number
}

interface LocalContext {
  store: Store
  persister: IndexedDbPersister | null
}

const eventSessions = new Map<string, Promise<EventSession>>()
let localContextPromise: Promise<LocalContext> | null = null

function toObjectCell(value: object): Record<string, unknown> {
  return value as unknown as Record<string, unknown>
}

function eventSyncUrl(eventId: string): string {
  const origin = window.location.origin
  const url = new URL(origin)

  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.pathname = `/api/events/${encodeURIComponent(eventId)}`

  return url.toString()
}

function createLocalStore(): Store {
  const store = createStore()

  store.setTablesSchema({
    [RECENT_TABLE]: {
      event: { type: 'object' },
      recentAt: { type: 'number' },
      created: { type: 'number' },
    },
    [LOCAL_STATE_TABLE]: {
      participantName: { type: 'string', default: '' },
      publishedAt: { type: 'number', allowNull: true },
      recentAt: { type: 'number', allowNull: true },
    },
  })

  return store
}

async function initLocalContext(): Promise<LocalContext> {
  const store = createLocalStore()
  let persister: IndexedDbPersister | null = null

  try {
    persister = createIndexedDbPersister(store, LOCAL_DB_NAME)
    await persister.load([{}, {}])
    await persister.startAutoSave()
  } catch {
    persister = null
  }

  return { store, persister }
}

function getLocalContext(): Promise<LocalContext> {
  if (!localContextPromise) {
    localContextPromise = initLocalContext()
  }

  return localContextPromise
}

async function persistLocal(context: LocalContext): Promise<void> {
  if (!context.persister) {
    return
  }

  await context.persister.save()
}

function readLocalStateRow(store: Store, eventId: string): LocalStateRow | undefined {
  if (!store.hasRow(LOCAL_STATE_TABLE, eventId)) {
    return undefined
  }

  const row = store.getRow(LOCAL_STATE_TABLE, eventId) as Partial<LocalStateRow>

  return {
    participantName: typeof row.participantName === 'string' ? row.participantName : '',
    publishedAt: typeof row.publishedAt === 'number' ? row.publishedAt : null,
    recentAt: typeof row.recentAt === 'number' ? row.recentAt : null,
  }
}

function setLocalStateRow(store: Store, eventId: string, row: LocalStateRow): void {
  store.setRow(LOCAL_STATE_TABLE, eventId, {
    participantName: row.participantName,
    publishedAt: row.publishedAt,
    recentAt: row.recentAt,
  })
}

function readRecentEventRow(store: Store, eventId: string): RecentEventRow | undefined {
  if (!store.hasRow(RECENT_TABLE, eventId)) {
    return undefined
  }

  const row = store.getRow(RECENT_TABLE, eventId) as Partial<RecentEventRow>

  if (!row || typeof row.event !== 'object' || row.event === null) {
    return undefined
  }

  const event = row.event as AppEvent

  return {
    event,
    recentAt: typeof row.recentAt === 'number' ? row.recentAt : event.created,
    created: typeof row.created === 'number' ? row.created : event.created,
  }
}

function setRecentEventRow(store: Store, event: AppEvent, recentAt: number): void {
  store.setRow(RECENT_TABLE, event.id, {
    event: toObjectCell(event),
    recentAt,
    created: event.created,
  })
}

function pruneRecentEvents(store: Store): void {
  const ranked = store
    .getRowIds(RECENT_TABLE)
    .map((eventId) => {
      const row = readRecentEventRow(store, eventId)

      if (!row) {
        return null
      }

      return {
        eventId,
        score: row.recentAt,
      }
    })
    .filter((item): item is { eventId: string; score: number } => item !== null)
    .sort((a, b) => b.score - a.score)

  const keep = new Set(ranked.slice(0, MAX_LOCAL_EVENTS).map((item) => item.eventId))

  for (const eventId of store.getRowIds(RECENT_TABLE)) {
    if (keep.has(eventId)) {
      continue
    }

    store.delRow(RECENT_TABLE, eventId)
    store.delRow(LOCAL_STATE_TABLE, eventId)
  }
}

async function createEventSession(eventId: string): Promise<EventSession> {
  const store = createMergeableStore(`event-${eventId}`)
  store.setTablesSchema({
    [EVENT_TABLE]: {
      [EVENT_CELL]: { type: 'object' },
    },
  })

  let persister: IndexedDbPersister | null = null

  try {
    persister = createIndexedDbPersister(store, `${EVENT_DB_PREFIX}${eventId}`)
    await persister.load([{}, {}])
    await persister.startAutoSave()
  } catch {
    persister = null
  }

  let synchronizer: EventSynchronizer | null = null

  if (navigator.onLine) {
    try {
      const ws = new WebSocket(eventSyncUrl(eventId))

      synchronizer = await createWsSynchronizer(store, ws)
      await synchronizer.startSync()
    } catch {
      synchronizer = null
    }
  }

  return {
    eventId,
    store,
    persister,
    synchronizer,
  }
}

async function getEventSession(eventId: string): Promise<EventSession> {
  const existing = eventSessions.get(eventId)

  if (existing) {
    return existing
  }

  const created = createEventSession(eventId)
  eventSessions.set(eventId, created)

  return created
}

function getEventFromSession(session: EventSession): AppEvent | undefined {
  if (!session.store.hasRow(EVENT_TABLE, session.eventId)) {
    return undefined
  }

  const row = session.store.getRow(EVENT_TABLE, session.eventId) as {
    [EVENT_CELL]?: AppEvent
  }

  if (!row || !row[EVENT_CELL]) {
    return undefined
  }

  return row[EVENT_CELL]
}

async function persistEventSession(session: EventSession): Promise<void> {
  if (!session.persister) {
    return
  }

  await session.persister.save()
}

async function ensureEventSynchronizer(session: EventSession): Promise<void> {
  if (session.synchronizer) {
    return
  }

  if (!navigator.onLine) {
    return
  }

  try {
    const ws = new WebSocket(eventSyncUrl(session.eventId))

    session.synchronizer = await createWsSynchronizer(session.store, ws)
    await session.synchronizer.startSync()
  } catch {
    session.synchronizer = null
  }
}

async function upsertEventLocally(event: AppEvent): Promise<void> {
  const local = await getLocalContext()
  const existing = readLocalStateRow(local.store, event.id)

  setRecentEventRow(local.store, event, Date.now())

  setLocalStateRow(local.store, event.id, {
    participantName: existing?.participantName ?? '',
    publishedAt: existing?.publishedAt ?? null,
    recentAt: Date.now(),
  })

  pruneRecentEvents(local.store)
  await persistLocal(local)
}

export async function saveEvent(event: AppEvent): Promise<void> {
  const session = await getEventSession(event.id)

  session.store.setRow(EVENT_TABLE, event.id, {
    [EVENT_CELL]: toObjectCell(event),
  })

  await persistEventSession(session)
  await upsertEventLocally(event)
  await ensureEventSynchronizer(session)
}

export async function getEvent(id: string): Promise<AppEvent | undefined> {
  const session = await getEventSession(id)

  await ensureEventSynchronizer(session)

  return getEventFromSession(session)
}

export async function subscribeEvent(
  eventId: string,
  onChange: (event: AppEvent | undefined) => void,
): Promise<() => void> {
  const session = await getEventSession(eventId)

  await ensureEventSynchronizer(session)

  const listenerId = session.store.addTableListener(EVENT_TABLE, () => {
    onChange(getEventFromSession(session))
  })

  onChange(getEventFromSession(session))

  return () => {
    session.store.delListener(listenerId)
  }
}

export async function listEvents(): Promise<AppEvent[]> {
  const local = await getLocalContext()

  return local.store
    .getRowIds(RECENT_TABLE)
    .map((eventId) => readRecentEventRow(local.store, eventId))
    .filter((row): row is RecentEventRow => row !== undefined)
    .sort((a, b) => b.recentAt - a.recentAt)
    .slice(0, MAX_LOCAL_EVENTS)
    .map((row) => row.event)
}

export async function updateParticipantSlots(
  eventId: string,
  name: string,
  slots: SlotValue[],
  updatedAt: number,
  version?: number,
): Promise<void> {
  const session = await getEventSession(eventId)
  const event = getEventFromSession(session)

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

  const nextEvent: AppEvent = {
    ...event,
    participants: nextParticipants,
  }

  session.store.setRow(EVENT_TABLE, eventId, {
    [EVENT_CELL]: toObjectCell(nextEvent),
  })

  await persistEventSession(session)
  await upsertEventLocally(nextEvent)
  await ensureEventSynchronizer(session)
}

export async function getSelectedParticipant(eventId: string): Promise<string | null> {
  const local = await getLocalContext()
  const row = readLocalStateRow(local.store, eventId)

  if (!row?.participantName) {
    return null
  }

  return row.participantName
}

export async function setSelectedParticipant(
  eventId: string,
  participantName: string,
): Promise<void> {
  const local = await getLocalContext()
  const existing = readLocalStateRow(local.store, eventId)

  setLocalStateRow(local.store, eventId, {
    participantName,
    publishedAt: existing?.publishedAt ?? null,
    recentAt: existing?.recentAt ?? null,
  })

  await persistLocal(local)
}

export async function getPublishedAt(eventId: string): Promise<number | null> {
  const local = await getLocalContext()
  const row = readLocalStateRow(local.store, eventId)

  return row?.publishedAt ?? null
}

export async function setPublishedAt(eventId: string, publishedAt: number): Promise<void> {
  const local = await getLocalContext()
  const existing = readLocalStateRow(local.store, eventId)

  setLocalStateRow(local.store, eventId, {
    participantName: existing?.participantName ?? '',
    publishedAt,
    recentAt: existing?.recentAt ?? null,
  })

  await persistLocal(local)
}

export async function touchEventRecent(eventId: string): Promise<void> {
  const local = await getLocalContext()
  const recent = readRecentEventRow(local.store, eventId)
  const existing = readLocalStateRow(local.store, eventId)

  if (!recent) {
    return
  }

  local.store.setRow(RECENT_TABLE, eventId, {
    event: toObjectCell(recent.event),
    created: recent.created,
    recentAt: Date.now(),
  })

  setLocalStateRow(local.store, eventId, {
    participantName: existing?.participantName ?? '',
    publishedAt: existing?.publishedAt ?? null,
    recentAt: Date.now(),
  })

  pruneRecentEvents(local.store)
  await persistLocal(local)
}
