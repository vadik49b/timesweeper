import { createMergeableStore } from 'tinybase/mergeable-store'
import type { MergeableStore } from 'tinybase/mergeable-store'
import { createDurableObjectSqlStoragePersister } from 'tinybase/persisters/persister-durable-object-sql-storage'
import {
  getWsServerDurableObjectFetch,
  WsServerDurableObject,
} from 'tinybase/synchronizers/synchronizer-ws-server-durable-object'

const EVENT_META_TABLE = 'eventMeta'
const EVENT_NAME_CELL = 'name'
const EVENT_CREATED_CELL = 'created'
const EVENT_SLOT_STARTS_UTC_ISO_CELL = 'slotStartsUtcIso'
const EVENT_PARTICIPANT_NAMES_CELL = 'participantNames'
const AVAILABILITY_TABLE = 'availability'

interface Env {
  EVENT_ROOMS: DurableObjectNamespace<EventRoom>
}

interface EventParticipant {
  name: string
  slots: Record<string, 1 | 2>
}

interface EventJson {
  id: string
  name: string
  created: number
  slotStartsUtcIso: string[]
  participants: EventParticipant[]
}

const wsFetch = getWsServerDurableObjectFetch('EVENT_ROOMS')

function createEventRoomPersister(sqlStorage: SqlStorage, uniqueId?: string) {
  return createDurableObjectSqlStoragePersister(createMergeableStore(uniqueId), sqlStorage)
}

function matchEventJsonPath(pathname: string): string | null {
  const route = pathname.match(/^\/api\/events\/([^/]+)\/json$/)

  if (!route) {
    return null
  }

  return decodeURIComponent(route[1]!)
}

function eventRoomPath(eventId: string): string {
  return `api/events/${encodeURIComponent(eventId)}`
}

async function readEventJson(
  sqlStorage: SqlStorage,
  eventId: string,
): Promise<EventJson | null> {
  const persister = createEventRoomPersister(sqlStorage, `preview-${eventId}`)
  const store = persister.getStore() as MergeableStore

  await persister.load()

  if (!store.hasRow(EVENT_META_TABLE, eventId)) {
    return null
  }

  const name = store.getCell(EVENT_META_TABLE, eventId, EVENT_NAME_CELL)
  const created = store.getCell(EVENT_META_TABLE, eventId, EVENT_CREATED_CELL)
  const slotStartsUtcIso = store.getCell(
    EVENT_META_TABLE,
    eventId,
    EVENT_SLOT_STARTS_UTC_ISO_CELL,
  )
  const participantNames =
    (store.getCell(EVENT_META_TABLE, eventId, EVENT_PARTICIPANT_NAMES_CELL) as string[]) ?? []

  if (
    typeof name !== 'string' ||
    typeof created !== 'number' ||
    !Array.isArray(slotStartsUtcIso)
  ) {
    return null
  }

  return {
    id: eventId,
    name,
    created,
    slotStartsUtcIso: slotStartsUtcIso as string[],
    participants: participantNames.map((participantName) => ({
      name: participantName,
      slots: store.hasRow(AVAILABILITY_TABLE, participantName)
        ? ({ ...store.getRow(AVAILABILITY_TABLE, participantName) } as Record<string, 1 | 2>)
        : {},
    })),
  }
}

export class EventRoom extends WsServerDurableObject<Env> {
  createPersister() {
    return createEventRoomPersister(this.ctx.storage.sql)
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (request.method === 'GET' && url.pathname === '/json') {
      const eventId = url.searchParams.get('eventId')

      if (!eventId) {
        return Response.json(
          { error: 'Missing eventId' },
          {
            headers: {
              'Access-Control-Allow-Origin': '*',
            },
            status: 400,
          },
        )
      }

      const preview = await readEventJson(this.ctx.storage.sql, eventId)

      if (!preview) {
        return Response.json(
          { error: 'Event not found' },
          {
            headers: {
              'Access-Control-Allow-Origin': '*',
            },
            status: 404,
          },
        )
      }

      return Response.json(preview, {
        headers: {
          'Access-Control-Allow-Origin': '*',
        },
      })
    }

    return super.fetch(request)
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const eventId = matchEventJsonPath(new URL(request.url).pathname)

    if (!eventId) {
      return wsFetch(request, env)
    }

    const stub = env.EVENT_ROOMS.get(env.EVENT_ROOMS.idFromName(eventRoomPath(eventId)))
    const previewRequest = new Request(
      `https://event-room/json?eventId=${encodeURIComponent(eventId)}`,
      {
        method: 'GET',
        headers: request.headers,
      },
    )

    return stub.fetch(previewRequest)
  },
}
