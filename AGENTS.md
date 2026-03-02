# TimeSweeper — Agent Guide

**Domain:** `timesweeper.app`
**Tagline:** Group scheduling, defused.

TimeSweeper is a no-login group availability app with a Windows 95 Minesweeper visual style.

## Product Rules

- One shared event link: `/e/:eventId`
- No accounts, no auth, no per-person links
- Anyone with the link can edit availability
- Availability states: `0=no`, `1=yes`, `2=maybe`
- Score model: `yes=1`, `maybe=0.5`, `no=0`

## Current Stack

- Frontend: SolidJS + Vite
- Local persistence: IndexedDB via `idb`
- Offline queue: IndexedDB-backed pending sync ops
- Realtime sync: REST + WebSocket
- Backend: Cloudflare Worker + Durable Objects
- PWA: manifest + service worker in `public/`

## Code Map

- `src/App.tsx`: path-based routing (`/` landing, `/e/:id` grid)
- `src/Landing.tsx`: event creation and recent local events
- `src/Grid.tsx`: availability editor, suggestions, heatmap, dialogs
- `src/components/Win95Button.tsx`: shared button component (`normal|small`, `fullWidth`)
- `src/components/Win95Field.tsx`: shared input/select fields
- `src/components/AvailabilityLegend.tsx`: cycle legend
- `src/types.ts`: event model + slot/date helpers
- `src/db.ts`: IndexedDB stores (`events`, `localState`, `pendingSync`)
- `src/sync.ts`: queueing, flush, REST sync, websocket subscription
- `worker/src/worker.ts`: API + durable object room logic

## Data Model (Implemented)

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

## UI/Interaction (Implemented)

- Win95 visual system (`raised`, `sunken`, status bar/function bar)
- Landing page creates events with:
  - event name
  - date picker (up to 7 dates)
  - start/end time selects
  - participant list (add/remove)
- Grid page:
  - `Hi [name]!` + `Switch...`, `Share`, `Help`
  - tap/click cycle per cell: `no -> yes -> maybe -> no`
  - collapsible panels: Your availability, Suggestions, Group availability
  - top suggestions list + confirm dialog
  - heatmap grid
  - confirmed overlay with `.ics` download + summary copy + undo confirmation
- Keyboard shortcuts:
  - `F1` / `U`: undo
  - `F3` / `S`: share
  - `F5`: confirm dialog
  - `Ctrl/Cmd+Z`: undo

## Sync Behavior (Implemented)

- Local-first writes, async sync in background
- Participant updates are versioned; server returns `409` on mismatch
- Client retries participant PUT once using `currentVersion` from conflict response
- Event websocket broadcasts:
  - `event.updated`
  - `participant.updated`
- Polling fallback every 15s on grid page

## Current Constraints

- Main complexity hotspot: `src/Grid.tsx` (large mixed UI + logic)
- Button behavior/styling should stay centralized in `Win95Button` + shared CSS

## DRY Priorities

1. Split `Grid.tsx` into state/sync/presentation modules
2. Consolidate event mutation helpers (confirm, merge, slot update)
3. Share model contracts between frontend and worker to prevent drift
4. Keep button/field behavior in shared components only

## Code Style

- Never use one-line `if` statements.
- Always use braces for `if` / `else if` / `else` blocks, even for a single statement.
- After a closing curly brace `}`, add a blank line before the next statement (except where syntax requires adjacency, like `} else {`).
- Add a blank line before standalone `if` statements and before standalone `return` statements.
- Do not silence async errors with call-site `void` patterns; handle ignored errors inside helper functions with explicit `try/catch`.
- Use BEM naming for CSS classes: `block`, `block__element`, `block--modifier` (kebab-case only).
- Keep utility helpers explicit (for example `u-*`), and do not mix utility naming into component block names.
