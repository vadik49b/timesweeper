# TimeSweeper — Agent Spec

**Domain:** `timesweeper.app`
**Tagline:** Group scheduling, defused.

A group availability finder: no login, timezone-native, offline-first, minesweeper-themed.

---

## Design Philosophy

**The Kittysplit model** — no registration, no passwords, no per-person links:
- Creator enters event name + participant names → gets one shareable link
- Participants open the link, pick their name from the list (or add themselves)
- The link is the session. Anyone with the link can edit anyone's availability.
- Accepted tradeoff: trust comes from social context, not auth (same as When2Meet/Kittysplit)

**Use cases:** international friend groups coordinating across timezones; cross-org professional meetings where nobody controls shared calendar infra.

---

## Tech Stack

**Frontend:**
- SolidJS or Preact — tiny runtime, fast grid renders
- IndexedDB (via `idb`) — local persistence: availability, cached state, event history
- Service Worker — full offline after first visit (PWA)

**Sync:**
- REST API + WebSocket for live updates
- Each participant's availability = atomic blob (send whole grid on change)
- Optimistic UI — changes apply instantly, sync in background
- Offline → queue in IndexedDB → flush when online
- WebSocket for live heatmap (degrade to polling if unavailable)

**Backend:**
- Cloudflare Workers + Durable Objects, or Fly.io + SQLite (Litestream)
- No user accounts, no auth
- Each event ≈ 1–5KB

**Bundle target: < 50KB**

---

## URL Scheme

```
https://timesweeper.app/e/a1b2c3d4
```

One link. No fragments, no admin URLs, no per-person links.

---

## Data Model

```
Event {
  id: "a1b2c3d4"
  name: "Intro Call — Acme Ventures"
  created: timestamp
  status: "open" | "confirmed"
  maxParticipants: 5          // free=5, paid: 10/20/unlimited
  confirmedSlot?: { date, startTime, endTime }  // UTC

  dates: ["2026-03-02", "2026-03-03", ...]
  timeRange: { start: "14:00", end: "22:00" }  // UTC
  slotDuration: 30  // minutes (default), creator can set 15 or 60

  participants: [
    {
      name: "Alex"
      timezone: "Europe/Berlin"
      slots: [0,0,1,1,1,2,2,0,0,...]  // 0=no, 1=yes, 2=maybe
      visitedAt: timestamp
      updatedAt: timestamp
    }
  ]
}
```

Sync blob per participant:
```
{ eventId, participantName, timezone, slots: (0|1|2)[], updatedAt }
```

---

## MVP Scope (Phase 1)

- **Event creation:** name, date picker (max 7-day span free), time range (default 8h, 30-min slots), participant names → shareable link
- **Participant experience:** open link → name list → tap yours (or add yourself) → can switch name anytime
- **Grid:** mobile-first, tap-to-cycle (empty→yes→maybe→empty), long-press-drag for bulk, undo button, 44px+ touch targets, haptic feedback, past dates grayed out
- **Timezone:** auto-detect, per-person badge, all times in local zone, timezone overlap bar
- **Live heatmap:** real-time updates, always on
- **Focus mode:** checkbox hides group heatmap while editing; your edits still flow live
- **Three-state availability:** yes=1pt / maybe=0.5pt / no=0pt
- **Offline-first:** Service Worker + IndexedDB, sync when online
- **PWA installable**

---

## Visual Identity: Windows 95 Minesweeper

The entire app is themed as Windows 95 Minesweeper. Not a skin — the metaphor is structural. Availability cells behave like minesweeper cells (raised/sunken bevels, checkmarks, question marks). The heatmap uses minesweeper number colors. All window chrome follows Win95 conventions.

### Typography

- **UI elements** (labels, buttons, inputs, body text): `Segoe UI, Tahoma, MS Sans Serif, sans-serif` — Win95 system font stack. Sizes: 10–13px body, 11–12px labels.
- **Brand / headings**: `VT323` (Google Fonts, monospace) — ONLY for "TimeSweeper" brand name and major section headings. Size: 28–38px.

**Rule:** No modern sans-serif (Inter, Roboto, etc.) anywhere. No emoji in UI chrome — replaced with inline SVGs.

### Icons (All Inline SVG, No Emoji)

**Mine icon** (hero/brand): Black circle with 8 radiating spike lines, white highlight square. 34×34px on landing, 16×16px in title bars.

```svg
<svg width="16" height="16" viewBox="0 0 16 16">
  <line x1="8" y1="1" x2="8" y2="4" stroke="black" stroke-width="1.5"/>
  <line x1="8" y1="12" x2="8" y2="15" stroke="black" stroke-width="1.5"/>
  <line x1="1" y1="8" x2="4" y2="8" stroke="black" stroke-width="1.5"/>
  <line x1="12" y1="8" x2="15" y2="8" stroke="black" stroke-width="1.5"/>
  <line x1="3" y1="3" x2="5" y2="5" stroke="black" stroke-width="1.2"/>
  <line x1="11" y1="3" x2="13" y2="5" stroke="black" stroke-width="1.2"/>
  <line x1="3" y1="13" x2="5" y2="11" stroke="black" stroke-width="1.2"/>
  <line x1="11" y1="13" x2="13" y2="11" stroke="black" stroke-width="1.2"/>
  <circle cx="8" cy="8" r="4" fill="black"/>
  <rect x="6" y="6" width="2" height="2" fill="white"/>
</svg>
```

**Flag icon** (recent events, status indicators): Red triangle flag on black pole with base. 16×16px.

```svg
<svg width="16" height="16" viewBox="0 0 16 16">
  <polygon points="4,2 4,11 11,6" fill="#ff0000"/>
  <line x1="4" y1="2" x2="4" y2="14" stroke="black" stroke-width="1.5"/>
  <rect x="2" y="13" width="5" height="1.5" fill="black"/>
</svg>
```

**Rule:** No emoji anywhere. Calendar nav uses `<` `>`. Dropdown arrows use `▼`. Remove buttons use `x`. No ☕, no 📅, no ⏱.

### Color Palette

```
--bg:           #c0c0c0     (Win95 gray)
--border-light: #ffffff     (bevel highlight)
--border-dark:  #808080     (bevel shadow)
--border-darker:#404040     (bevel dark shadow)
--teal:         #008080     (desktop background)
--title-bar:    linear-gradient(90deg, #000080, #1084d0)
--cell-open:    #a8d4a8     (opened/available cell green)
--num-1:        #0000ff     (heatmap: 1 person)
--num-2:        #008000     (heatmap: 2 people)
--num-3:        #ff0000     (heatmap: 3 people)
--num-4:        #000080     (heatmap: 4 people)
--num-5:        #800000     (heatmap: 5 people)
```

### Bevel System

- **Raised** (`.raised`): `border-color: white #404040 #404040 white` — default button/cell state
- **Sunken** (`.sunken`): `border-color: #404040 white white #404040` — pressed buttons, input fields, panel containers
- **Sunken-thin** (`.sunken-thin`): 1px version for status bar segments

### DOS-Style Hotkey Highlighting

Primary actions highlight their keyboard shortcut letter with an underline. Letters are real, functional hotkeys.

- Grid menu bar: `Game · View · Help`
- Grid function bar: `F1 Undo · F2 Focus · F3 Share · F5 Confirm`
- Keyboard: `U`=undo, `F`=focus, `S`=share, `Ctrl+Z`=undo

---

## Screen Specs

### Screen 1: Landing Page / Create Event

The homepage IS the create form. Win95 window chrome wraps the entire page.

**Layout (top to bottom):**

1. **Title bar:** Mine SVG (16px) + "TimeSweeper" in VT323
2. **Hero section:** Large mine SVG (34px) + "TimeSweeper" (VT323 38px) + tagline (system font 13px)
3. **Create form** (sunken panel):
   - Event name input (beveled sunken, system font 12px)
   - Calendar date picker: 7-day grid, month/year header with `<` `>` nav, click to select (max 7 free). Selected dates: navy background.
   - Time range: two beveled dropdown selects (start/end). Default 2:00 PM – 10:00 PM.
   - Participant names: list of beveled text inputs, each with `x` remove button. "Add participant" raised button. Max 5 free.
   - `Create Event` raised button (full width, system font 12px, bold)
4. **How it works** (sunken panel, VT323 heading): 4 numbered steps, system font, compact
5. **Recent events** (sunken panel, VT323 heading): IndexedDB-backed list. Each row: flag SVG + event name + date + "N participants"
6. **Status bar:** `Free plan | 5 participants max` (sunken-thin, pipe-separated)
7. **Footer:** system font 10px, pipe-separated: `timesweeper.app | About | GitHub | Privacy`

**Rules:** No slot interval selector on landing (default 30min). Font sizes at Win95 scale: 10–13px. All inputs sunken, all buttons raised.

---

### Screen 2: Availability Grid (core screen)

Full Win95 window with menu bar, control bar, editing grid, results panels, status bar.

#### Window Structure

```
┌─ Title Bar ────────────────────────────┐
│ [mine] TimeSweeper — "Event Name"      │
├─ Menu Bar ─────────────────────────────┤
│ Game   View   Help                     │
├─ Control Bar (sunken) ─────────────────┤
│ [Name dropdown ▼]        [Share btn]   │
├─ Layout Container ─────────────────────┤
│                                        │
│  ┌─ ▾ Your availability ────────────┐  │
│  │ Legend: □ no → ✔ yes → ? maybe   │  │
│  │  [Time grid with minesweeper     │  │
│  │   cells]                         │  │
│  └──────────────────────────────────┘  │
│                                        │
│  ┌─ ▾ Results · 3/5 participants ───┐  │
│  │ 🥇 Tue 3:00  3/3  [Confirm]     │  │
│  │ 🥈 Wed 4:30  2.5/3              │  │
│  │ 🥉 Tue 4:00  2/3                │  │
│  │ Pick a different time...         │  │
│  ├──────────────────────────────────┤  │
│  │ ▾ Group availability             │  │
│  │ [Mini heatmap grid]              │  │
│  └──────────────────────────────────┘  │
│                                        │
├─ Status Bar ───────────────────────────┤
│ Editing: Jamie (EST)  │  timesweeper.. │
├─ Function Bar ─────────────────────────┤
│ F1 Undo  F2 Focus  F3 Share  F5 Conf  │
└────────────────────────────────────────┘
```

#### Name Selector

Native Win95 `<select>` dropdown — not chips, not custom. Beveled sunken frame with raised `▼` arrow button. Options: `"Jamie (EST)"`, `"Alex (CET)"`, `"Sam (JST)"`, `"+ Add yourself..."`. Selecting a name loads that person's grid instantly.

#### Grid Interaction

**Cell cycle:** Every click cycles infinitely:
```
□ closed (no) → ✔ opened (yes) → ? flagged (maybe) → □ closed (no) → ...
```

**Visual states:**
- **Closed / No:** Raised gray bevel. Empty. The unclicked minesweeper square.
- **Opened / Yes:** Sunken (1px border), green tint (#a8d4a8), dark green checkmark ✔.
- **Flagged / Maybe:** Raised gray bevel (same as closed) + `?` symbol. **No yellow background** — keep default gray, minesweeper-authentic.

**Cell dimensions:** 44×44px squares. Both width and height explicit.

**Drag interaction:**
- Mousedown cycles first cell → locks target state
- Drag across other cells paints them all to that same target state
- Touch drag works identically
- Each cell hit only once per drag (no flickering on re-hover)
- Undo reverses entire drag as one action
- Heatmap updates on drag end (not during) to avoid render thrashing

**Grid layout:** CSS Grid. Time labels in left column (38px). Day columns at `var(--cell)` (44px). Day headers in grid row aligned above columns. 5 days visible on desktop, horizontally scrollable for more.

**Legend (above grid):**
```
□ no  →  ✔ yes  →  ? maybe  →  □ no
```
Each state shown as a mini cell with actual bevel styling. Repeated "no" at end makes the infinite loop explicit.

**"Your availability" header:** Collapsible accordion: `▾ Your availability`. Triangle flips to `▸` when collapsed.

#### Heatmap (Group Availability)

Separate mini-grid below the editing grid. Not mixed into the editing surface.

- **Cell size:** 28×28px squares
- **Time label column:** 30px wide
- **Background intensity:** gray (#c0c0c0) → light green (#b0d0b0) → medium (#80b880) → dark green (#50a050)
- **Numbers:** minesweeper colors — 1=blue, 2=green, 3=red, 4=navy, 5=maroon. Zero is blank.
- **Scoring:** yes=1pt, maybe=0.5pt, no=0pt. Numbers show rounded sum.
- **Header:** Collapsible accordion, same style as "Your availability"

#### Results Panel

Sits above the Group availability heatmap. Top 3 time slots ranked by score.

**Each result row:** medal (🥇🥈🥉) + day+time + score (`3/3`) + per-person breakdown (✔/?) + inline `[Confirm]` button on best slot.

**Below top 3:** `Pick a different time...` → unified confirm dialog with empty dropdowns.

#### Responsive Layout

- **Desktop (≥700px):** "Your availability" and "Results + Group availability" side-by-side in flex row
- **Mobile (<700px):** Stack vertically
- All panels independently collapsible

#### Focus Mode

Toggle via F2 or function bar. When active:
- Results and Group availability panels auto-collapse
- Status bar shows `🔒 Focus ON`
- Only editing grid visible
- Your edits still flow live to the heatmap for everyone else

#### Menu Bar

- **Game** — event management (new event, recent events)
- **View** — toggle focus mode, toggle panels
- **Help** — opens help dialog

#### Help Dialog

Win95 modal. Title: "How to use TimeSweeper". 6 numbered steps + keyboard shortcuts at bottom. OK button closes.

#### Share Dialog

Win95 dialog:
- Sunken read-only text input with event URL (auto-selected on open)
- **Copy** button → copies, shows "Link copied to clipboard" in status bar for 2s
- **Close** button

#### Confirm Dialog (Unified)

Serves both "confirm a suggestion" and "pick a different time":
- Day dropdown + Time dropdown (Win95 selects)
- Pre-filled when opened from a result row; empty when opened from "Pick a different time..."
- **Confirm** button → sets confirmed, status bar shows `✅ Confirmed | Tue 3:00`
- **Cancel** button

#### Status Bar

Two sunken-thin segments:
- Left: `Editing: Jamie (EST)` | `🔒 Focus ON` | `✅ Confirmed | Tue 3:00`
- Right: `timesweeper.app`

Temporary messages (e.g., `Link copied to clipboard`) display for 2s then revert.

#### Function Bar

```
F1 Undo  |  F2 Focus  |  F3 Share  |  F5 Confirm
```

Each clickable. Hotkey letter underlined. Hover: navy background + white text.

---

### Screen 3: Participant Landing (from shared link)

- Event name + date summary
- Name picker list. Tap yours. Visited names show ✓.
- `"+ I'm someone else"` button to add a new name
- Detected timezone shown with change link
- Selecting a name immediately loads Screen 2

---

### Screen 4: Confirmed State

- `✅ Confirmed: Tuesday 3:00 PM EST / 9:00 PM CET / Wed 4:00 AM JST`
- Add to calendar (.ics download) button
- Copy summary button → formatted multi-timezone text
- Undo confirmation button (anyone can undo — permissive model)
- Grid and results remain visible below

---

### Screen 5: Upgrade Prompt

Win95 dialog. Appears when the 6th person tries to join a free (5-slot) event:
- Current count: `"5/5 participants"`
- Slot packs: `+5 / $2`, `+15 / $4`, `Unlimited / $6`
- "One-time payment for this event. No account needed."
- Back button

---

## Confirmed UI Decisions

Final decisions from prototyping v1–v8:

1. **Cell cycle is tap-based, not mode-based.** One click cycles all three states. No separate flag mode.
2. **No smiley face.** Doesn't map to anything functional. Control bar is: name dropdown + share button.
3. **No LED counters.** Removed. Status bar serves the same purpose.
4. **Flagged cells have NO yellow background.** Default gray + `?` symbol only. Minesweeper-authentic.
5. **Cells must be square.** 44×44px. Both dimensions explicit.
6. **Heatmap cells are also square.** 28×28px.
7. **Drag paints a single target state.** First cell determines state; all dragged cells get that state.
8. **Name selector is a native Win95 `<select>`.** Not chips, not custom. Last option always `"+ Add yourself..."`.
9. **Share feedback goes in the status bar.** No toasts, no modals for clipboard confirmation.
10. **Share action opens a dialog with the link.** Clipboard API unreliable in sandboxed environments.
11. **Both panels are collapsible accordions.** Triangle indicator flips (▾→▸).
12. **Desktop: side-by-side. Mobile: stacked.** At ≥700px flex row; below that, vertical stack.
13. **Focus mode collapses both Results and Group panels.** Actively hides them, not just visual toggle.
14. **Legend closes the loop visually.** `□ no → ✔ yes → ? maybe → □ no` — repeated "no" makes infinite cycle obvious.
15. **"Your availability" label exists.** Without it users didn't know which grid they were editing.
16. **Help dialog has step-by-step instructions.** Win95 modal, not tooltip or inline text.
17. **Results panel shows top 3 with inline Confirm buttons.** Plus "Pick a different time..." link.
18. **Single unified confirm dialog** for suggestions and custom picks. Dropdowns pre-fill from suggestions.
19. **No emoji anywhere in UI chrome.** SVGs replace all emoji. `<` `>` for nav. `x` for remove. `|` for separators.
20. **Landing uses Win95 system fonts at Win95 scale.** 10–13px body. VT323 only for brand name and section headings.

---

## Prototypes

Working HTML prototypes are the source of truth for all UI decisions:

- **`timesweep-grid.html`** (v8) — full minesweeper grid with drag, undo, focus mode, accordion panels, results, confirm/help/share dialogs
- **`timesweep-landing.html`** — Win95 create form with calendar picker, SVG icons, recent events
