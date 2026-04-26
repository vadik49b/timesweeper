import { createMergeableStore } from 'tinybase/mergeable-store'
import type { MergeableStore } from 'tinybase/mergeable-store'
import { createDurableObjectSqlStoragePersister } from 'tinybase/persisters/persister-durable-object-sql-storage'
import {
  getWsServerDurableObjectFetch,
  WsServerDurableObject,
} from 'tinybase/synchronizers/synchronizer-ws-server-durable-object'

const EVENT_META_TABLE = 'eventMeta'
const EVENT_NAME_CELL = 'name'
const EVENT_PARTICIPANT_NAMES_CELL = 'participantNames'
const PREVIEW_ROUTE_SUFFIX = '/preview'

interface Env {
  EVENT_ROOMS: DurableObjectNamespace<EventRoom>
}

interface EventPreview {
  id: string
  name: string
  organizerName: string | null
}

const wsFetch = getWsServerDurableObjectFetch('EVENT_ROOMS')

function createEventRoomPersister(sqlStorage: SqlStorage, uniqueId?: string) {
  return createDurableObjectSqlStoragePersister(createMergeableStore(uniqueId), sqlStorage)
}

function matchEventPreviewPath(pathname: string): string | null {
  const route = pathname.match(/^\/api\/events\/([^/]+)\/preview$/)

  if (!route) {
    return null
  }

  return decodeURIComponent(route[1]!)
}

function eventRoomPath(eventId: string): string {
  return `api/events/${encodeURIComponent(eventId)}`
}

async function readEventPreview(
  sqlStorage: SqlStorage,
  eventId: string,
): Promise<EventPreview | null> {
  const persister = createEventRoomPersister(sqlStorage, `preview-${eventId}`)
  const store = persister.getStore() as MergeableStore

  await persister.load()

  if (!store.hasRow(EVENT_META_TABLE, eventId)) {
    return null
  }

  const name = store.getCell(EVENT_META_TABLE, eventId, EVENT_NAME_CELL)
  const participantNames =
    (store.getCell(EVENT_META_TABLE, eventId, EVENT_PARTICIPANT_NAMES_CELL) as string[]) ?? []

  if (typeof name !== 'string') {
    return null
  }

  return {
    id: eventId,
    name,
    organizerName: participantNames[0] ?? null,
  }
}

export class EventRoom extends WsServerDurableObject<Env> {
  createPersister() {
    return createEventRoomPersister(this.ctx.storage.sql)
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (request.method === 'GET' && url.pathname === PREVIEW_ROUTE_SUFFIX) {
      const eventId = url.searchParams.get('eventId')

      if (!eventId) {
        return Response.json({ error: 'Missing eventId' }, { status: 400 })
      }

      const preview = await readEventPreview(this.ctx.storage.sql, eventId)

      if (!preview) {
        return Response.json({ error: 'Event not found' }, { status: 404 })
      }

      return Response.json(preview)
    }

    return super.fetch(request)
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const eventId = matchEventPreviewPath(new URL(request.url).pathname)

    if (!eventId) {
      return wsFetch(request, env)
    }

    const stub = env.EVENT_ROOMS.get(env.EVENT_ROOMS.idFromName(eventRoomPath(eventId)))
    const previewRequest = new Request(
      `https://event-room/preview?eventId=${encodeURIComponent(eventId)}`,
      {
        method: 'GET',
        headers: request.headers,
      },
    )

    return stub.fetch(previewRequest)
  },
}
