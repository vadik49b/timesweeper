import type { AppEvent, SlotValue } from './types'
import ReconnectingWebSocket from 'reconnecting-websocket'

const API_ORIGIN = window.location.origin

function apiBase() {
  return `${API_ORIGIN}/api`
}

function wsBase() {
  const proto = API_ORIGIN.startsWith('https') ? 'wss:' : 'ws:'
  const host = new URL(API_ORIGIN).host

  return `${proto}//${host}/api`
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

  if (!resp.ok) {
    throw new Error(`pull event failed: ${resp.status}`)
  }

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

export function connectEventSocket(
  eventId: string,
  onEventUpdated: (event: AppEvent) => void,
  onParticipantUpdated: (
    eventId: string,
    participantName: string,
    slots: SlotValue[],
    updatedAt: number,
    version: number,
  ) => void,
  onConnectionChange: (connected: boolean) => void,
): () => void {
  const ws = new ReconnectingWebSocket(`${wsBase()}/events/${encodeURIComponent(eventId)}/ws`, [], {
    minReconnectionDelay: 1000,
    maxReconnectionDelay: 30000,
    reconnectionDelayGrowFactor: 1.8,
    connectionTimeout: 4000,
    maxRetries: Infinity,
  })
  let connected = false

  const onOpen = () => {
    if (!connected) {
      connected = true
      onConnectionChange(true)
    }
  }

  const onMessage = (ev: MessageEvent) => {
    try {
      const msg = JSON.parse(String(ev.data)) as WsEventMessage

      if (msg.type === 'event.updated') {
        onEventUpdated(msg.event)
      } else if (msg.type === 'participant.updated') {
        onParticipantUpdated(
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

  const onClose = () => {
    if (connected) {
      connected = false
      onConnectionChange(false)
    }
  }

  ws.addEventListener('open', onOpen)
  ws.addEventListener('message', onMessage)
  ws.addEventListener('close', onClose)

  return () => {
    ws.removeEventListener('open', onOpen)
    ws.removeEventListener('message', onMessage)
    ws.removeEventListener('close', onClose)

    if (connected) {
      connected = false
      onConnectionChange(false)
    }

    ws.close(1000, 'cleanup')
  }
}
