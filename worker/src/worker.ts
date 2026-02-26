type SlotValue = 0 | 1 | 2

interface Participant {
  name: string
  timezone: string
  slots: SlotValue[]
  visitedAt: number | null
  updatedAt: number | null
}

interface ConfirmedSlot {
  date: string
  startTime: string
  endTime: string
}

interface AppEvent {
  id: string
  name: string
  created: number
  status: 'open' | 'confirmed'
  maxParticipants: number
  confirmedSlot?: ConfirmedSlot
  dates: string[]
  timeRange: { start: string; end: string }
  participants: Participant[]
}

interface Env {
  EVENT_ROOMS: DurableObjectNamespace<EventRoom>
}

const ALLOWED_ORIGINS = new Set([
  'https://timesweeper.pages.dev',
  'https://timesweeper.app',
])

function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return true
  return ALLOWED_ORIGINS.has(origin)
}

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('Origin')
  if (!origin || !isAllowedOrigin(origin)) return {}
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  }
}

function json(data: unknown, request: Request, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...corsHeaders(request),
    },
  })
}

function noContent(request: Request, status = 204): Response {
  return new Response(null, { status, headers: corsHeaders(request) })
}

async function readJson<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T
  } catch {
    return null
  }
}

function matchEventPath(
  pathname: string,
):
  | { kind: 'event'; eventId: string }
  | { kind: 'participant'; eventId: string; participantName: string }
  | { kind: 'ws'; eventId: string }
  | null {
  const ws = pathname.match(/^\/api\/events\/([^/]+)\/ws$/)
  if (ws) return { kind: 'ws', eventId: decodeURIComponent(ws[1]) }
  const participant = pathname.match(/^\/api\/events\/([^/]+)\/participants\/([^/]+)$/)
  if (participant) {
    return {
      kind: 'participant',
      eventId: decodeURIComponent(participant[1]),
      participantName: decodeURIComponent(participant[2]),
    }
  }
  const event = pathname.match(/^\/api\/events\/([^/]+)$/)
  if (event) return { kind: 'event', eventId: decodeURIComponent(event[1]) }
  return null
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!isAllowedOrigin(request.headers.get('Origin'))) {
      return json({ error: 'origin_not_allowed' }, request, 403)
    }
    if (request.method === 'OPTIONS') return noContent(request)
    const url = new URL(request.url)
    const route = matchEventPath(url.pathname)
    if (!route) return json({ error: 'not_found' }, request, 404)
    const id = env.EVENT_ROOMS.idFromName(route.eventId)
    const stub = env.EVENT_ROOMS.get(id)
    return stub.fetch(request)
  },
}

export class EventRoom {
  private state: DurableObjectState
  private clients: Set<WebSocket>

  constructor(state: DurableObjectState) {
    this.state = state
    this.clients = new Set()
  }

  private async getEvent(): Promise<AppEvent | null> {
    const event = await this.state.storage.get<AppEvent>('event')
    return event ?? null
  }

  private async setEvent(event: AppEvent): Promise<void> {
    await this.state.storage.put('event', event)
  }

  private broadcast(message: unknown): void {
    const text = JSON.stringify(message)
    for (const ws of this.clients) {
      try {
        ws.send(text)
      } catch {
        this.clients.delete(ws)
      }
    }
  }

  private attachSocket(ws: WebSocket): void {
    this.clients.add(ws)
    ws.addEventListener('close', () => this.clients.delete(ws))
    ws.addEventListener('error', () => this.clients.delete(ws))
    ws.addEventListener('message', () => {
      // No-op: server push channel only.
    })
  }

  async fetch(request: Request): Promise<Response> {
    if (!isAllowedOrigin(request.headers.get('Origin'))) {
      return json({ error: 'origin_not_allowed' }, request, 403)
    }
    const url = new URL(request.url)
    const route = matchEventPath(url.pathname)
    if (!route) return json({ error: 'not_found' }, request, 404)

    if (route.kind === 'ws') {
      if (request.headers.get('Upgrade') !== 'websocket') {
        return json({ error: 'expected_websocket_upgrade' }, request, 426)
      }
      if (!isAllowedOrigin(request.headers.get('Origin'))) {
        return json({ error: 'origin_not_allowed' }, request, 403)
      }
      const pair = new WebSocketPair()
      const [client, server] = Object.values(pair)
      server.accept()
      this.attachSocket(server)
      return new Response(null, { status: 101, webSocket: client })
    }

    if (route.kind === 'event') {
      if (request.method === 'GET') {
        const event = await this.getEvent()
        if (!event) return json({ error: 'event_not_found' }, request, 404)
        return json(event, request)
      }
      if (request.method === 'PUT') {
        const event = await readJson<AppEvent>(request)
        if (!event || typeof event.id !== 'string')
          return json({ error: 'invalid_event_payload' }, request, 400)
        if (event.id !== route.eventId) {
          return json({ error: 'event_id_mismatch' }, request, 400)
        }
        await this.setEvent(event)
        this.broadcast({ type: 'event.updated', event })
        return json({ ok: true }, request)
      }
      return json({ error: 'method_not_allowed' }, request, 405)
    }

    if (request.method !== 'PUT') return json({ error: 'method_not_allowed' }, request, 405)
    const body = await readJson<{
      changes?: Array<{ i: number; v: SlotValue }>
      updatedAt?: number
    }>(request)
    const changes = body?.changes
    const updatedAt = body?.updatedAt
    if (!Array.isArray(changes) || typeof updatedAt !== 'number') {
      return json({ error: 'invalid_participant_payload' }, request, 400)
    }
    const event = await this.getEvent()
    if (!event) return json({ error: 'event_not_found' }, request, 404)
    const idx = event.participants.findIndex((p) => p.name === route.participantName)
    if (idx === -1) return json({ error: 'participant_not_found' }, request, 404)

    const participant = event.participants[idx]
    if ((participant.updatedAt ?? 0) >= updatedAt) {
      return json({ ok: true, stale: true }, request)
    }

    const nextSlots = [...participant.slots]
    for (const change of changes) {
      if (typeof change?.i !== 'number') continue
      if (change.i < 0 || change.i >= nextSlots.length) continue
      if (change.v !== 0 && change.v !== 1 && change.v !== 2) continue
      nextSlots[change.i] = change.v
    }

    const nextEvent: AppEvent = {
      ...event,
      participants: event.participants.map((p, i) =>
        i === idx ? { ...p, slots: nextSlots, updatedAt } : p,
      ),
    }

    await this.setEvent(nextEvent)
    this.broadcast({
      type: 'participant.updated',
      eventId: nextEvent.id,
      participantName: route.participantName,
      slots: nextSlots,
      updatedAt,
    })
    return json({ ok: true }, request)
  }
}
