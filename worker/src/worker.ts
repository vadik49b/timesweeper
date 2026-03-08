import { createMergeableStore } from 'tinybase/mergeable-store'
import { createDurableObjectSqlStoragePersister } from 'tinybase/persisters/persister-durable-object-sql-storage'
import {
  getWsServerDurableObjectFetch,
  WsServerDurableObject,
} from 'tinybase/synchronizers/synchronizer-ws-server-durable-object'

interface Env {
  EVENT_ROOMS: DurableObjectNamespace<EventRoom>
}

export class EventRoom extends WsServerDurableObject<Env> {
  createPersister() {
    return createDurableObjectSqlStoragePersister(createMergeableStore(), this.ctx.storage.sql)
  }
}

export default {
  fetch: getWsServerDurableObjectFetch('EVENT_ROOMS'),
}
