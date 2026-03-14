## TimeSweeper

`timesweeper.app`

Group scheduling, defused.

TimeSweeper is a no-login group availability app with a Windows 95 Minesweeper visual style.

## Product Rules

- One shared event link: `/e/:eventId`
- No accounts, no auth, no per-person links
- Anyone with the link can edit availability
- Availability states: `0=no`, `1=yes`, `2=maybe`
- Score model: `yes=1`, `maybe=0.5`, `no=0`

## Stack

- Frontend: SolidJS + Vite
- Local persistence: TinyBase stores persisted in browser storage
- Realtime sync: WebSocket via TinyBase synchronizers
- Backend: Cloudflare Worker + Durable Objects
- PWA: manifest + service worker in `public/`

## Code Map

- `src/App.tsx`: path-based routing (`/` landing, `/e/:id` grid)
- `src/Landing.tsx`: event creation and recent local events
- `src/Grid.tsx`: availability editor, suggestions, dialogs
- `src/components/Win95Button.tsx`: shared button component (`normal|small`, `fullWidth`)
- `src/components/Win95Field.tsx`: shared input/select fields
- `src/components/AvailabilityLegend.tsx`: cycle legend
- `src/types.ts`: event model and slot/date helpers
- `src/db.ts`: local TinyBase stores and event room websocket sync
- `worker/src/worker.ts`: Durable Object websocket backend

## Data Model

```ts
AppEvent {
  id: string
  name: string
  created: number
  status: 'open' | 'confirmed'
  maxParticipants: number
  confirmedSlot?: { date: string; startTime: string; endTime: string }
  dates: string[]
  timeRange: { start: string; end: string }
  participants: Participant[]
}

Participant {
  name: string
  timezone: string
  slots: (0|1|2)[]
  visitedAt: number | null
  updatedAt: number | null
  version?: number
}
```

## UI Notes

- Win95 visual system with raised/sunken surfaces, status bar, and function bar
- Landing page creates events with name, date picker, time range, and participant list
- Grid page supports in-place availability editing, suggestions, share/help dialogs, and confirmation flow
- Keyboard shortcuts: `F1` / `U` undo, `F3` / `S` share, `F5` confirm dialog, `Ctrl/Cmd+Z` undo

## Code Style

- Never use one-line `if` statements.
- Always use braces for `if` / `else if` / `else` blocks, even for a single statement.
- After a closing curly brace `}`, add a blank line before the next statement, except where syntax requires adjacency like `} else {`.
- Add a blank line before standalone `if` statements and before standalone `return` statements.
- Do not silence async errors with call-site `void` patterns. Handle ignored errors inside helper functions with explicit `try/catch`.
- Use BEM naming for CSS classes: `block`, `block__element`, `block--modifier`.
- Keep utility helpers explicit, for example `u-*`, and do not mix utility naming into component block names.

## Setup

```bash
npm install
```

## Run Locally (Frontend + Cloudflare API)

1. Start the Worker API in one terminal:

```bash
npm run dev:api
```

2. Start the frontend:

```bash
npm run dev
```

3. Open `http://localhost:5173`

`npm run dev` sets `VITE_WS_ORIGIN=http://127.0.0.1:8787`, so the frontend connects directly to Wrangler and dev matches production transport behavior.

## Cloudflare API

The websocket backend lives in:
- `worker/src/worker.ts`
- `worker/wrangler.toml`

Current transport model:
- frontend builds the websocket URL from `VITE_WS_ORIGIN`
- frontend connects to `/api/events/:eventId` over WebSocket
- in local dev, `VITE_WS_ORIGIN` should be `http://127.0.0.1:8787`
- in production, the Worker is attached directly to `api.timesweeper.app`
- the Durable Object worker handles websocket traffic directly on that hostname

Frontend env vars:
- production: `VITE_WS_ORIGIN=https://api.timesweeper.app`
- local dev: `VITE_WS_ORIGIN=http://127.0.0.1:8787`

WebSocket messages:
- `{ type: "event.updated", event }`
- `{ type: "participant.updated", eventId, participantName, slots, updatedAt, version }`

## Sync Test Checklist

1. Open the same event link in two browser tabs.
2. In tab A, update availability.
3. Verify tab B updates live over WebSocket.
4. Disable network in DevTools, make edits, re-enable network.
5. Verify sync reconnects and both tabs converge.

## Deploy API

```bash
npm run deploy:api
```

This publishes the Worker using the custom domain declared in [`worker/wrangler.toml`](/Users/vadik49b/github/timesweeper/worker/wrangler.toml).

## Deploy Frontend

`npm run deploy:fe` builds the frontend locally with `VITE_WS_ORIGIN=https://api.timesweeper.app` and then uploads `dist/` to Cloudflare Pages.

## Deploy from Laptop (No GitHub Required)

Then use:

```bash
npm run deploy:fe    # build + deploy frontend (dist/) to Pages
npm run deploy       # deploy API Worker + frontend
```
