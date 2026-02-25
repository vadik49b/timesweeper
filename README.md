## Setup

```bash
npm install
```

## Run Locally (Frontend + Cloudflare API)

1. Start the Worker API in one terminal:

```bash
npm run dev:api
```

2. Start the frontend in another terminal:

```bash
npm run dev
```

3. Open `http://localhost:5173`

The Vite dev server proxies `/api` and WebSocket `/api/*` traffic to Wrangler on `127.0.0.1:8787`.

## Cloudflare API

The Worker + Durable Object API lives in:
- `worker/src/worker.ts`
- `wrangler.toml`

Implemented endpoints:
- `GET /api/events/:eventId`
- `PUT /api/events/:eventId`
- `PUT /api/events/:eventId/participants/:participantName` with `{ changes, updatedAt }`
- `GET /api/events/:eventId/ws` (WebSocket)

WebSocket messages:
- `{ type: "event.updated", event }`
- `{ type: "participant.updated", eventId, participantName, slots, updatedAt }`

## Sync Test Checklist

1. Open the same event link in two browser tabs.
2. In tab A, update availability.
3. Verify tab B updates live (WebSocket), or within 15s (poll fallback).
4. Disable network in DevTools, make edits, re-enable network.
5. Verify queued sync flushes and both tabs converge.

## Deploy API

```bash
npm run deploy:api
```
