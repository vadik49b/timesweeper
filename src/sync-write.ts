import type { AppEvent, SlotValue } from './types'
import { type SyncOp, enqueueSyncOp, getEvent, listPendingSyncOps, removePendingSyncOp } from './db'

const API_ORIGIN = window.location.origin

function apiBase() {
  return `${API_ORIGIN}/api`
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
      const local = await getEvent(eventId)

      if (local) {
        const seedResp = await fetch(`${apiBase()}/events/${encodeURIComponent(eventId)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(local),
        })

        if (seedResp.ok) {
          resp = await sendParticipant(baseVersion)
        }
      }
    }

    if (resp.status === 409) {
      const conflict = (await resp.json().catch(() => null)) as { currentVersion?: number } | null

      if (typeof conflict?.currentVersion === 'number') {
        resp = await sendParticipant(conflict.currentVersion)
      }
    }

    if (!resp.ok) {
      throw new Error(`participant sync failed: ${resp.status}`)
    }

    return
  }

  const { event } = op.payload
  const resp = await fetch(`${apiBase()}/events/${encodeURIComponent(event.id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
  })

  if (!resp.ok) {
    throw new Error(`event sync failed: ${resp.status}`)
  }
}

let flushQueued = false
let flushInProgress = false
let flushRequestedDuringRun = false

function scheduleFlushLoop(): void {
  if (flushQueued) {
    return
  }

  flushQueued = true
  queueMicrotask(() => {
    flushQueued = false
    runFlushLoop()
  })
}

async function flushPendingSyncBatch(): Promise<boolean> {
  if (!navigator.onLine) {
    return false
  }

  const pending = await listPendingSyncOps()

  if (pending.length === 0) {
    return false
  }

  let syncedCount = 0

  for (const op of pending) {
    try {
      await sendSyncOp(op)
      await removePendingSyncOp(op.id)
      syncedCount += 1
    } catch {
      break
    }
  }

  if (syncedCount > 0) {
    return true
  }

  return false
}

async function runFlushLoopAsync(): Promise<void> {
  try {
    while (navigator.onLine) {
      const hasProgress = await flushPendingSyncBatch()

      if (!hasProgress) {
        break
      }
    }
  } catch {
    // Scheduler is best-effort; future triggers retry.
  } finally {
    flushInProgress = false

    if (flushRequestedDuringRun) {
      flushRequestedDuringRun = false
      scheduleFlushLoop()
    }
  }
}

function runFlushLoop(): void {
  if (flushInProgress) {
    flushRequestedDuringRun = true

    return
  }

  flushInProgress = true
  runFlushLoopAsync()
}

async function removeQueuedParticipantOps(
  eventId: string,
  participantName: string,
): Promise<void> {
  const pending = await listPendingSyncOps()

  for (const op of pending) {
    if (op.kind !== 'participant') {
      continue
    }

    const sameEvent = op.payload.eventId === eventId
    const sameParticipant = op.payload.participantName === participantName

    if (sameEvent && sameParticipant) {
      await removePendingSyncOp(op.id)
    }
  }
}

export function requestSyncFlush(): void {
  scheduleFlushLoop()
}

export async function queueParticipantSync(
  eventId: string,
  participantName: string,
  slots: SlotValue[],
  baseVersion: number,
  updatedAt: number,
): Promise<void> {
  await removeQueuedParticipantOps(eventId, participantName)
  await enqueueSyncOp({
    kind: 'participant',
    payload: { eventId, participantName, slots, baseVersion, updatedAt },
    createdAt: Date.now(),
  })
  requestSyncFlush()
}

export async function queueEventSync(event: AppEvent): Promise<void> {
  await enqueueSyncOp({
    kind: 'event',
    payload: { event },
    createdAt: Date.now(),
  })
  requestSyncFlush()
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
