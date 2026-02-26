type SlotValue = 0 | 1 | 2

interface Participant {
  name: string
  timezone: string
  slots: SlotValue[]
  visitedAt: number | null
  updatedAt: number | null
  version?: number
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
  ALLOW_LOCALHOST_ORIGIN?: string
}

const ALLOWED_ORIGINS = new Set([
  'https://timesweeper.pages.dev',
  'https://timesweeper.app',
])

function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return true
  return ALLOWED_ORIGINS.has(origin)
}

function shouldAllowLocalhost(env: Env): boolean {
  return env.ALLOW_LOCALHOST_ORIGIN === 'true'
}

function isLocalhostOrigin(origin: string): boolean {
  return origin === 'http://localhost:5173'
}

function isAllowedOriginForEnv(origin: string | null, env: Env): boolean {
  if (!origin) return true
  if (isAllowedOrigin(origin)) return true
  if (shouldAllowLocalhost(env) && isLocalhostOrigin(origin)) return true
  return false
}

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get('Origin')
  if (!origin || !isAllowedOriginForEnv(origin, env)) return {}
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  }
}

function json(data: unknown, request: Request, env: Env, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...corsHeaders(request, env),
    },
  })
}

function noContent(request: Request, env: Env, status = 204): Response {
  return new Response(null, { status, headers: corsHeaders(request, env) })
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
    if (!isAllowedOriginForEnv(request.headers.get('Origin'), env)) {
      return json({ error: 'origin_not_allowed' }, request, env, 403)
    }
    if (request.method === 'OPTIONS') return noContent(request, env)
    const url = new URL(request.url)
    const route = matchEventPath(url.pathname)
    if (!route) return json({ error: 'not_found' }, request, env, 404)
    const id = env.EVENT_ROOMS.idFromName(route.eventId)
    const stub = env.EVENT_ROOMS.get(id)
    return stub.fetch(request)
  },
}

export class EventRoom {
  private state: DurableObjectState
  private env: Env
  private clients: Set<WebSocket>

  constructor(state: DurableObjectState, env: Env) {
    this.state = state
    this.env = env
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
    if (!isAllowedOriginForEnv(request.headers.get('Origin'), this.env)) {
      return json({ error: 'origin_not_allowed' }, request, this.env, 403)
    }
    const url = new URL(request.url)
    const route = matchEventPath(url.pathname)
    if (!route) return json({ error: 'not_found' }, request, this.env, 404)

    if (route.kind === 'ws') {
      if (request.headers.get('Upgrade') !== 'websocket') {
        return json({ error: 'expected_websocket_upgrade' }, request, this.env, 426)
      }
      if (!isAllowedOriginForEnv(request.headers.get('Origin'), this.env)) {
        return json({ error: 'origin_not_allowed' }, request, this.env, 403)
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
        if (!event) return json({ error: 'event_not_found' }, request, this.env, 404)
        return json(event, request, this.env)
      }
      if (request.method === 'PUT') {
        const event = await readJson<AppEvent>(request)
        if (!event || typeof event.id !== 'string')
          return json({ error: 'invalid_event_payload' }, request, this.env, 400)
        if (event.id !== route.eventId) {
          return json({ error: 'event_id_mismatch' }, request, this.env, 400)
        }
        const normalized: AppEvent = {
          ...event,
          participants: event.participants.map((p) => ({ ...p, version: p.version ?? 0 })),
        }
        await this.setEvent(normalized)
        this.broadcast({ type: 'event.updated', event: normalized })
        return json({ ok: true }, request, this.env)
      }
      return json({ error: 'method_not_allowed' }, request, this.env, 405)
    }

    if (request.method !== 'PUT')
      return json({ error: 'method_not_allowed' }, request, this.env, 405)
    const body = await readJson<{
      slots?: SlotValue[]
      baseVersion?: number
      updatedAt?: number
    }>(request)
    const slots = body?.slots
    const baseVersion = body?.baseVersion
    const updatedAt = body?.updatedAt
    if (!Array.isArray(slots) || typeof updatedAt !== 'number' || typeof baseVersion !== 'number') {
      return json({ error: 'invalid_participant_payload' }, request, this.env, 400)
    }
    const event = await this.getEvent()
    if (!event) return json({ error: 'event_not_found' }, request, this.env, 404)
    const idx = event.participants.findIndex((p) => p.name === route.participantName)
    if (idx === -1) return json({ error: 'participant_not_found' }, request, this.env, 404)

    const participant = event.participants[idx]
    const currentVersion = participant.version ?? 0
    if (currentVersion !== baseVersion) {
      return json(
        { error: 'version_conflict', currentVersion, updatedAt: participant.updatedAt ?? null },
        request,
        this.env,
        409,
      )
    }
    if ((participant.updatedAt ?? 0) >= updatedAt) {
      return json({ ok: true, stale: true }, request, this.env)
    }

    if (slots.length !== participant.slots.length) {
      return json({ error: 'invalid_slots_length' }, request, this.env, 400)
    }
    const nextSlots: SlotValue[] = slots.map((value) => {
      if (value === 1 || value === 2) return value
      return 0
    })

    const nextVersion = currentVersion + 1
    const nextEvent: AppEvent = {
      ...event,
      participants: event.participants.map((p, i) =>
        i === idx ? { ...p, slots: nextSlots, updatedAt, version: nextVersion } : p,
      ),
    }

    await this.setEvent(nextEvent)
    this.broadcast({
      type: 'participant.updated',
      eventId: nextEvent.id,
      participantName: route.participantName,
      slots: nextSlots,
      updatedAt,
      version: nextVersion,
    })
    return json({ ok: true, version: nextVersion }, request, this.env)
  }
}
