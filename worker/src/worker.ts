import { createMergeableStore } from 'tinybase/mergeable-store'
import type { MergeableStore } from 'tinybase/mergeable-store'
import { createDurableObjectSqlStoragePersister } from 'tinybase/persisters/persister-durable-object-sql-storage'
import {
  getWsServerDurableObjectFetch,
  WsServerDurableObject,
} from 'tinybase/synchronizers/synchronizer-ws-server-durable-object'
import {
  AVAILABILITY_TABLE,
  EVENT_META_CREATED_CELL,
  EVENT_META_TABLE,
  EVENT_META_NAME_CELL,
  EVENT_META_PARTICIPANT_NAMES_CELL,
  EVENT_META_SLOT_STARTS_UTC_ISO_CELL,
} from '../../shared/tinybase-schema.ts'

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

const wsFetch = getWsServerDurableObjectFetch('EVENT_ROOMS') as unknown as (
  request: Request,
  env: Env,
) => Response

function matchEventJsonPath(pathname: string): string | null {
  const route = pathname.match(/^\/api\/events\/([^/]+)\/json$/)

  if (!route) {
    return null
  }

  return decodeURIComponent(route[1]!)
}

export class EventRoom extends WsServerDurableObject<Env> {
  private readonly store: MergeableStore

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.store = createMergeableStore()
  }

  createPersister() {
    return createDurableObjectSqlStoragePersister(this.store, this.ctx.storage.sql)
  }

  async getPreview(eventId: string): Promise<EventJson | null> {
    if (!this.store.hasRow(EVENT_META_TABLE, eventId)) {
      return null
    }

    const name = this.store.getCell(EVENT_META_TABLE, eventId, EVENT_META_NAME_CELL)
    const created = this.store.getCell(EVENT_META_TABLE, eventId, EVENT_META_CREATED_CELL)
    const slotStartsUtcIso = this.store.getCell(
      EVENT_META_TABLE,
      eventId,
      EVENT_META_SLOT_STARTS_UTC_ISO_CELL,
    )
    const participantNames =
      (this.store.getCell(
        EVENT_META_TABLE,
        eventId,
        EVENT_META_PARTICIPANT_NAMES_CELL,
      ) as string[]) ?? []

    return {
      id: eventId,
      name: name as string,
      created: created as number,
      slotStartsUtcIso: slotStartsUtcIso as string[],
      participants: participantNames.map((participantName) => ({
        name: participantName,
        slots: this.store.hasRow(AVAILABILITY_TABLE, participantName)
          ? ({
              ...this.store.getRow(AVAILABILITY_TABLE, participantName),
            } as Record<string, 1 | 2>)
          : {},
      })),
    }
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const eventId = matchEventJsonPath(new URL(request.url).pathname)

    if (!eventId) {
      return wsFetch(request, env)
    }

    const stub = env.EVENT_ROOMS.get(
      env.EVENT_ROOMS.idFromName(`api/events/${encodeURIComponent(eventId)}`),
    )
    const preview = await stub.getPreview(eventId)

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
  },
}
