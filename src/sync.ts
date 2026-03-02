import type { AppEvent, SlotValue } from './types'
import { type SyncOp, enqueueSyncOp, getEvent, listPendingSyncOps, removePendingSyncOp } from './db'

const API_ORIGIN = window.location.origin

function apiBase() {
  return `${API_ORIGIN}/api`
}

function wsBase() {
  const proto = API_ORIGIN.startsWith('https') ? 'wss:' : 'ws:'
  const host = new URL(API_ORIGIN).host
  return `${proto}//${host}/api`
}

async function sendSyncOp(op: SyncOp): Promise<void> {
  if (op.kind === 'participant') {
    const { eventId, participantName, slots, baseVersion, updatedAt } = op.payload
    const sendParticipant = (version: number) =>
      fetch(
        `${apiBase()}/events/${encodeURIComponent(eventId)}/participants/${encodeURIComponent(participantName)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slots, baseVersion: version, updatedAt }),
        },
      )
    let resp = await sendParticipant(baseVersion)
    if (resp.status === 404) {
      // Server doesn't have this event yet; seed it from local cache, then retry once.
      const local = await getEvent(eventId)
      if (local) {
        const seedResp = await fetch(`${apiBase()}/events/${encodeURIComponent(eventId)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(local),
        })
        if (seedResp.ok) resp = await sendParticipant(baseVersion)
      }
    }
    if (resp.status === 409) {
      const conflict = (await resp.json().catch(() => null)) as { currentVersion?: number } | null
      if (typeof conflict?.currentVersion === 'number') {
        resp = await sendParticipant(conflict.currentVersion)
      }
    }
    if (!resp.ok) throw new Error(`participant sync failed: ${resp.status}`)
    return
  }
  const { event } = op.payload
  const resp = await fetch(`${apiBase()}/events/${encodeURIComponent(event.id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
  })
  if (!resp.ok) throw new Error(`event sync failed: ${resp.status}`)
}

export async function queueParticipantSync(
  eventId: string,
  participantName: string,
  slots: SlotValue[],
  baseVersion: number,
  updatedAt: number,
): Promise<void> {
  await enqueueSyncOp({
    kind: 'participant',
    payload: { eventId, participantName, slots, baseVersion, updatedAt },
    createdAt: Date.now(),
  })
}

export async function queueEventSync(event: AppEvent): Promise<void> {
  await enqueueSyncOp({
    kind: 'event',
    payload: { event },
    createdAt: Date.now(),
  })
}

export async function publishEventNow(event: AppEvent): Promise<boolean> {
  if (!navigator.onLine) {
    return false
  }

  try {
    const resp = await fetch(`${apiBase()}/events/${encodeURIComponent(event.id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    })
    return resp.ok
  } catch {
    return false
  }
}

let flushing = false

export async function flushPendingSync(): Promise<void> {
  if (flushing || !navigator.onLine) {
    return
  }

  flushing = true
  try {
    const pending = await listPendingSyncOps()
    for (const op of pending) {
      try {
        await sendSyncOp(op)
        await removePendingSyncOp(op.id)
      } catch {
        // Stop on first failure to preserve ordering and retry later.
        break
      }
    }
  } finally {
    flushing = false
  }
}

export async function pullRemoteEvent(eventId: string): Promise<AppEvent | null> {
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), 7000)
  let resp: Response
  try {
    resp = await fetch(`${apiBase()}/events/${encodeURIComponent(eventId)}`, {
      signal: controller.signal,
    })
  } finally {
    window.clearTimeout(timeoutId)
  }
  if (resp.status === 404) {
    return null
  }

  if (!resp.ok) throw new Error(`pull event failed: ${resp.status}`)
  return (await resp.json()) as AppEvent
}

type WsEventMessage =
  | { type: 'event.updated'; event: AppEvent }
  | {
      type: 'participant.updated'
      eventId: string
      participantName: string
      slots: SlotValue[]
      updatedAt: number
      version: number
    }

export interface SyncSocketHandlers {
  onEventUpdated: (event: AppEvent) => void
  onParticipantUpdated: (
    eventId: string,
    participantName: string,
    slots: SlotValue[],
    updatedAt: number,
    version: number,
  ) => void
}

export function connectEventSocket(eventId: string, handlers: SyncSocketHandlers): () => void {
  let ws: WebSocket | null = null
  try {
    ws = new WebSocket(`${wsBase()}/events/${encodeURIComponent(eventId)}/ws`)
  } catch {
    return () => {}
  }

  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(String(ev.data)) as WsEventMessage
      if (msg.type === 'event.updated') {
        handlers.onEventUpdated(msg.event)
      } else if (msg.type === 'participant.updated') {
        handlers.onParticipantUpdated(
          msg.eventId,
          msg.participantName,
          msg.slots,
          msg.updatedAt,
          msg.version,
        )
      }
    } catch {
      // Ignore malformed server messages.
    }
  }

  return () => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.close()
  }
}
