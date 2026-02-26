# TimeSweeper — Product & UI Spec

**Domain:** `timesweeper.app`
**Tagline:** Group scheduling, defused.

## The Opportunity

When2Meet is a dinosaur that refuses to die — and that's the signal. Built in 2008, it still pulls **3–6 million visits/month** (Semrush data, Feb–Apr 2025), ranks alongside actual universities on Similarweb, and gets ~75% direct traffic (people type the URL from memory or bookmarks). Its audience skews 18–24, heavily US college students, 58% female.

**Why it persists:** zero friction. No login, no app install, paste a link in the group chat, click-drag your availability, done. The UI looks like 2008 because it *is* from 2008, but nobody cares because the interaction model is correct. It's a *verb* in US college culture — embedded in course syllabi, shared through Canvas/LMS links, taught freshman-to-freshman. Every "When2Meet alternative" listicle names 10+ products and nearly all of them are **appointment schedulers** (Calendly, Cal.com, Doodle) solving a fundamentally different problem ("let clients book time with me" vs. "let a group of equals find mutual availability").

**Timeful/Schej** (1.3k GitHub stars, open source AGPL-3.0) is the most serious attempt to modernize this. Vue.js frontend + Go backend + MongoDB. They added Google/Apple Calendar import, better mobile UX, and a modern design. But they doubled down on accounts and Google OAuth as a core feature — the calendar autofill is the selling point. This works for their college audience but violates the Kittysplit principle.

---

## Target Audience

**Not** college students (that's When2Meet's legacy audience and switching them is a culture war).

**Primary:** Distributed people who coordinate across organizational boundaries — people who can't rely on shared tools:

### Use Case A: International Friend Groups
- Friends scattered across timezones trying to find time for online hangouts, game sessions, group calls
- Pain: "We have 6 people in 4 timezones. Every tool is either too corporate or too broken for this."
- Frequency: Weekly/biweekly recurring coordination
- Context: Links shared in Telegram, Discord, WhatsApp group chats
- Key need: Timezone as a *core feature*, not an afterthought

### Use Case B: Cross-Org Professional Meetings
- Small VC funds meeting external founders/investors. Freelancers coordinating with clients. Indie teams with contractors.
- Pain: "We don't have shared infra. No common Google Workspace, no shared Calendly. I need to find a time with someone outside my org who uses a completely different setup."
- Frequency: Ad-hoc, one-off meetings
- Context: Links shared in email, LinkedIn DMs, Slack Connect
- Key need: Looks professional, works without any setup on the recipient's side

### What these share:
- Nobody controls the calendar infrastructure for everyone
- The recipient of the link is the person who needs zero friction
- Timezone handling isn't a nice-to-have, it's the *whole point*
- No accounts, no shared platform assumptions

---

## The Kittysplit Principle

Kittysplit (Berlin, est. 2012) nailed the UX pattern:

- **No registration, no login, no passwords**
- Create a "kitty" → enter event name + participant names → get a unique link → share it
- Participants open the link and **pick their name from the list** (or add a new one)
- Works in any browser, on any device
- The link *is* the access control
- Free for basic use, paid upgrade for extras (multi-currency, read-only links)

This is the design philosophy to steal. The link is the session. Names are predefined by the creator but anyone can add themselves.

---

## Project Concept: TimeSweeper

**Name rationale:** "TimeSweeper" — a portmanteau of "time" + "minesweeper." The `-er` suffix directly mirrors the game, making the reference instant. Zero tech competition for the search term (only a 1987 B-movie and a Carl Sandburg poem). When explaining: "it's like minesweeper but for scheduling" — the joke explains itself.

A group availability finder that is:

1. **Offline-first** — works without network, syncs when connected
2. **No login** — create an event, get a link, share it
3. **Super performant** — instant UI, no spinners, no loading states
4. **Timezone-native** — every participant sees their own local times, the heatmap adjusts per-viewer
5. **Link = everything** — the URL is your event, your access
6. **Always live** — heatmap updates in real-time, everyone sees everyone (with optional personal hide)

---

## Participant Identity: Kittysplit Model

No URL-fragment tokens. No passwords. Simple name selection, same as Kittysplit:

### Creator Flow
1. Enter event name
2. Enter participant names (yourself + others). Can add more later.
3. Create → get shareable link

### Participant Flow
1. Open shared link
2. See list of names → **tap yours** (or tap "Add yourself" to join with a new name)
3. You're now editing your availability
4. **Can switch name at any time** — tap current name at top, pick a different one or add new. Handles "oops I clicked the wrong Alex" gracefully.

### Why This Works
- Creator knows who's in the group, pre-fills names → less typing for participants
- Participants just tap, no typing required in the common case
- Anyone can add themselves → handles "oh, invite Jamie too" without creator intervention
- Switching names handles mistakes → zero anxiety about clicking wrong
- No passwords, no tokens, no fragments — just names on a list
- **Tradeoff accepted:** anyone with the link can edit anyone's availability. Same as When2Meet, same as Kittysplit. For the friend group and small professional meeting use cases, this is fine. Trust comes from the social context (you shared the link with specific people), not from auth.

### Name Display
- Each name shows: timezone badge, last-edited timestamp
- Names with no availability yet show as "pending" (greyed out)
- Creator can manage participant list (add/remove names) anytime

---

## Event Mode: Specific Dates

MVP ships with one mode: **Specific Dates + Times**. Creator picks calendar dates and a time range. Participants fill in their availability per time slot per date.

When2Meet also offers a "Days of Week" mode for recurring scheduling, but it explicitly doesn't support timezones — all participants must be in the same timezone. A future **Weekly Slots** mode with full cross-timezone support would be a killer differentiator for Use Case A (international friend groups finding a recurring time). Deferred to Phase 2.

### Grid Defaults

- **Slot interval: 30 minutes** (fixed in current implementation)
- **Time range: soft cap at 8 hours** with a nudge ("Shorter ranges get better responses"). Not hard-blocked — creator can set longer if needed.
- 8 hours at 30-min intervals = 16 rows × 44px = 704px. Fits one phone screen.
- **Past dates are grayed out and non-editable.** Grid auto-scrolls to the first still-valid date. If all dates have passed → "This event has passed. Schedule again with same group?" flow.
- **Max date span (free): 7 days.** Paid: up to 30 days. Doesn't limit how far in the future — just how wide the range is.

---

## Research-Backed Design Decisions

### 1. Mobile-First Grid (addresses: Mobile is Broken)

When2Meet's grid was designed for mouse drag-select on a desktop monitor. On mobile, touch targets are microscopic, drag conflicts with scroll, single-cell taps don't register, and there's no undo.

**Design:**
- **Thumb-sized touch targets** — minimum 44×44px cells
- **Tap-to-toggle, not drag-only** — single tap cycles: empty → green → yellow → empty. Long-press + drag for bulk selection.
- **Drag doesn't conflict with scroll** — lock scroll while drag-selecting (with clear visual feedback that you're in "selection mode")
- **Undo button** — always visible during editing. Overshot by one cell? Tap undo.
- **Haptic feedback** on each cell toggle (on supported devices)
- **Portrait-first layout** — two-day columns side by side (iOS calendar style), date selector pill row at top. Swipe grid or tap dates to navigate. Time slots as vertical list. Not a shrunken desktop grid.

### 2. Timezone as Core Feature (addresses: Timezone Chaos)

When2Meet's timezone dropdown mixes city names with country names with abbreviations in random order, doesn't auto-detect, and "Days of Week" mode doesn't support TZ at all.

**Design:**
- **Auto-detect timezone** from browser API — no dropdown on first load
- **Every participant sees times in their own local zone** — stored as UTC, displayed as local
- **Per-participant timezone badge** — next to each name: "Alex (CET)" "Jamie (EST)"
- **"Best time" suggestions factor in timezone sanity** — flag slots that fall in unreasonable hours (before 8am or after 11pm) for any participant
- **Timezone overlap visualizer** — a simple bar showing each participant's "reasonable hours" with the overlap highlighted. This is the "aha" feature for international friend groups.
- Override timezone only if auto-detect is wrong (searchable picker, not a 200-item dropdown)

### 3. Always Live

The heatmap is **always live** — real-time updates as people fill in, same as When2Meet. This is the correct default.

### 4. Three-State Availability

**Three states per cell:** ✅ Available (green) / 🤷 If needed (yellow) / ❌ Unavailable (default/empty)
- Tap cycles: empty → green → yellow → empty
- Heatmap scoring: green = 1 point, yellow = 0.5 points, empty = 0
- "Best time" algorithm weighs these appropriately
- Simple, doesn't over-complicate the grid

### 5. Post-Poll Resolution (addresses: Dead End)

- **"Best times" summary** — top 3 slots ranked by score (accounting for timezone sanity and yes/maybe weighting)
- **One-click .ics download** — pick a slot, get a calendar file
- **"Copy result" button** — formatted text: "We're meeting Tuesday 3pm EST / 9pm CET / 10pm MSK" — paste into group chat
- **"Confirm" flow** — creator picks the final time, event page shows "✅ Confirmed: Tuesday 9pm CET" prominently

### 6. Event Memory (addresses: Lost Links)

- **PWA with local event history** in IndexedDB
- "Recent Events" on homepage — every event you've visited or created
- Local only — no account, no server history. Browser is your memory.

---

## Technical Architecture

### Recommended Stack

**Frontend (the whole brain):**
- **SolidJS** or **Preact** — tiny runtime, fast renders for the grid
- **IndexedDB** (via `idb`) — local persistence: your availability, cached group state, event history
- **Service Worker** — full offline after first visit (PWA)

**Sync Layer:**

**CRDTs are overkill.** Each participant edits only their own availability — no true conflicts. The data model:

```
{ eventId, participantName, timezone, slots: (0|1|2)[], updatedAt }
```

- Simple **REST API** + **WebSocket** for live updates
- Each participant's availability = atomic blob, send whole grid on change
- Server merges by participant name
- **Optimistic UI** — changes apply instantly locally, sync in background
- Offline → queue in IndexedDB → flush when back online
- WebSocket for live heatmap (degrade to polling if unavailable)

**Backend (minimal):**
- **Cloudflare Workers + Durable Objects** or **Fly.io + SQLite (Litestream)**
- Each event = small document (~1-5KB)
- No user accounts, no auth
- Infra cost for millions of events: ~$5-20/month

### URL Scheme

```
https://timesweeper.app/e/a1b2c3d4    ← the one and only link, shared with everyone
```

That's it. One link. No fragments, no admin URLs, no per-person links. The Kittysplit model: everyone gets the same link, picks their name, does their thing.

### Data Model

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
  slotDuration: 30  // minutes (fixed)

  participants: [
    {
      name: "Alex"
      timezone: "Europe/Berlin"
      slots: [0,0,1,1,1,2,2,0,0,...]  // 0=no, 1=yes, 2=maybe
      visitedAt: timestamp             // first time they tapped their name
      updatedAt: timestamp             // last edit
    }
  ]
}
```

---

## MVP Scope

### Phase 1: Ship This

**Specific dates mode, timezone-native, mobile-first grid, Kittysplit identity.**

- **Event creation:**
  - Event name
  - Date selection (calendar picker, max 7-day span free)
  - Time range (default 8 hours, 30-min slots)
  - Participant names (pre-fill, add more later)
  - → Generate shareable link
- **Participant experience:**
  - Open link → see name list → tap yours (or add yourself)
  - Can switch name anytime during editing
  - Mobile-first grid: two-day columns, swipe or tap date selector
  - Tap-to-cycle (empty→green→yellow→empty), long-press-drag for bulk
  - Undo button
  - 44px+ touch targets, haptic feedback
  - Past dates grayed out, auto-scroll to first valid date
- **Timezone:**
  - Auto-detect
  - Per-person badge
  - All times in your local zone
  - Timezone overlap bar
- **Live heatmap** — always on, real-time updates
- **Three-state availability** — yes / if-needed / no
- **Offline-first:** Service Worker + IndexedDB, sync when online
- **PWA installable**
- **< 50KB bundle**

### Phase 2: Quality of Life + New Modes

- **Weekly Slots mode** with full cross-timezone support (the killer differentiator for Use Case A)
- **Date-only polls** (no time grid, "which weekend?")
- **Best-time suggestions** (TZ-sanity-aware, flag "3am for Alex")
- **Post-poll resolution:** .ics download, copy-result-to-clipboard, confirm flow
- **Local event history** (PWA "Recent Events")
- **.ics file import** (drag-drop, parse locally, auto-fill busy times)
- **Subset filtering** (view availability for just 3 of 8 people)

### Phase 3: Growth & Monetization

- **Participant slot upgrades** (core revenue — see Monetization section below)
- **Recurring events** (same group, refresh availability weekly with one tap)
- **Embed widget** for websites/Notion
- **Dark mode**

---

## Monetization: Participant Slots

### The Model

Free events have **5 participant slots**. Anyone with the link can purchase more.

This is the natural paywall: it's invisible for 2-4 person meetings, and the person who hits the limit (the 6th person trying to join) is the person most motivated to pay. No accounts needed — Stripe Checkout, card payment, event gets upgraded instantly.

### Pricing

| Pack | Price | Total Slots |
|------|-------|-------------|
| Free | $0 | 5 participants |
| +5 slots | $2 | 10 participants |
| +15 slots | $4 | 20 participants |
| Unlimited | $6 | ∞ participants |

One-time payment per event. Not recurring. Not per-person.

### How It Works

- Event shows participant count: **"3 / 5 participants"**
- When the 6th person tries to add themselves → upgrade prompt: "This event has 5/5 participants. Add more slots for $2."
- **Anyone** with the link can buy — not just the creator. The person who needs it pays.
- Purchase via Stripe Checkout (no account, just card). Event upgrades instantly.
- The creator also sees an "Upgrade" link proactively in case they know they'll need more.

### Why This Works

- **Zero friction for small groups** — 5 is enough for most friend calls and 1-on-1 professional meetings. The free tier is genuinely useful.
- **Natural paywall moment** — the limit is hit exactly when someone has real intent (they're trying to join). Not an arbitrary feature gate.
- **Distributed payment** — the creator doesn't have to be the one who pays. Whoever hits the wall pays. In practice, someone in the group chat says "it's full, who wants to pay $2?" and it's split socially.
- **No subscriptions** — matches Kittysplit philosophy. One-time, per-event.
- **Scales with value** — larger groups get more value, pay more.

### Additional Revenue (Later)

- **Tasteful single ad** on event page (not during grid editing). Pro events are ad-free. Covers hosting costs during growth phase.
- **Custom link slugs** ($1 add-on): `timesweeper.app/e/acme-q1` instead of random ID.
- **Tip jar**: after confirming a time, subtle "Help keep TimeSweeper free" link.

---

## Competitive Moat

The moat is **the combination of properties**, not any single feature:

1. **No login** (like When2Meet, unlike Timeful/Doodle)
2. **Modern mobile-first UI** (like Timeful, unlike When2Meet)
3. **Timezone as a core feature** (unlike everyone — auto-detect, per-person display, overlap viz)
4. **Kittysplit-style identity** (pick your name, switch anytime)
5. **Offline-first + instant** (like nobody)
6. **Three-state availability** (nobody in the no-login space has this)

Future wedge: **Weekly Slots mode with full timezone support** (Phase 2). When2Meet's equivalent mode explicitly doesn't support timezones. For international friend groups finding a recurring weekly time, this will be the only tool that works.

---

## Viral Loop

When2Meet's viral loop: one person creates → shares link → N people experience it.

Extra switching triggers:
1. **Mobile quality gap** — TimeSweeper works on your phone. When2Meet doesn't. That's the moment.
2. **Timezone display** — seeing "Alex (CET) · Jamie (EST) · 3pm your time" instead of mental math.
3. **It just looks better** — professional enough to send to an investor, fun enough to send to friends.

The switching trigger: someone in a cross-timezone group sends a TimeSweeper link. Everyone has a better experience. Next time, they create their own.

---

## Risks & Open Questions

- **Impersonation**: Anyone with the link can edit anyone's availability (same as When2Meet/Kittysplit). Accepted tradeoff for zero-auth simplicity. Trust comes from social context.
- **Data persistence**: Events expire 30 days after last activity (free), 90 days (pro).
- **Discovery / SEO**: When2Meet has 15+ years of domain authority. The play is viral word-of-mouth, not search.
- **Cross-TZ edge cases**: DST transitions, half-hour timezones (India, Nepal). Need robust UTC conversion. Use `Intl` + `Temporal` APIs or a thin library.
- **Participant list management**: What if someone adds a joke name? Creator can remove names via the manage-participants flow. Keep it simple.
- **Calendar import without OAuth**: .ics export is a multi-step process most people don't know. Provide inline mini-guides per calendar app.
- **Name as identity feels fragile**: Yes. But it works for Kittysplit at scale. The social pressure of "this is a group of 6 friends" is sufficient. Nobody is trolling their friends' kitty. Same logic applies.


---

## Visual Identity: Windows 95 Minesweeper

The entire app is themed as a Windows 95 Minesweeper game. This is not a skin — the metaphor is structural. Availability cells behave like minesweeper cells (raised/sunken bevels, flags, question marks). The heatmap uses minesweeper number colors. The window chrome, dialogs, and controls all follow Win95 conventions. This creates instant personality, a memorable brand, and a cohesive design language without needing a design system.

### Why Minesweeper

1. **Instant recognition** — everyone knows what minesweeper looks like. The 3D beveled cells, the flag, the question mark. This buys a complete visual vocabulary for free.
2. **The metaphor maps perfectly** — "sweeping" through a grid of time slots to find the safe ones. Flagging availability = flagging mines. The revealed heatmap = the revealed board with colored numbers.
3. **Signals "made by someone who cares"** — the kind of detail that makes developers and nerdy friend groups (our core audience) share it unprompted.
4. **Differentiation** — no scheduling tool looks like this. Every screenshot is instantly recognizable.

### Typography

Two font stacks, each with a specific role:

- **UI elements** (labels, buttons, inputs, body text): `Segoe UI, Tahoma, MS Sans Serif, sans-serif` — the actual Win95/98 system font stack. Sizes: 10–13px body, 11–12px labels. Small, dense, authentic.
- **Brand / headings**: `VT323` (Google Fonts, monospace) — used ONLY for the "TimeSweeper" brand name and major section headings. Size: 28–38px. This is the retro accent, not the default.

**Rule:** No modern sans-serif (Inter, Roboto, etc.) anywhere. No emoji in UI chrome (replaced with inline SVGs — see Icons below).

### Icons (All Inline SVG, No Emoji)

**Mine icon** (hero/brand): Black circle with 8 radiating spike lines, white highlight square. Used in title bars and the landing page hero. 34×34px on landing, 16×16px in title bars.

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

**Rule:** No emoji anywhere in the UI. Calendar nav uses `<` `>` (not ◄►). Dropdown arrows use `▼` HTML entity. Remove buttons use `x` (not ×). No ☕, no 📅, no ⏱.

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

Three bevel classes used everywhere:

- **Raised** (`.raised`): `border-color: white #404040 #404040 white` — default button/cell state (unpressed)
- **Sunken** (`.sunken`): `border-color: #404040 white white #404040` — pressed buttons, input fields, panel containers
- **Sunken-thin** (`.sunken-thin`): 1px version for status bar segments

### DOS-Style Hotkey Highlighting

Inspired by MS-DOS menu bars (`[F]ile [E]dit [V]iew`), primary actions highlight their keyboard shortcut letter with an underline. The highlighted letters are real, functional hotkeys.

Applied across the app:

- Grid function bar: `F1 Undo · F3 Share · F5 Confirm`
- Keyboard: `U`=undo, `S`=share, `Ctrl+Z`=undo

---

## Screen-by-Screen UI Spec

### Screen 1: Landing Page / Create Event (timesweeper.app)

The homepage IS the create form. No marketing page, no "Get started" — you land, you create. Win95 window chrome wraps the entire page.

**Layout (top to bottom):**

1. **Title bar:** Mine SVG icon (16px) + "TimeSweeper" in VT323
2. **Hero section:** Large mine SVG (34px) + "TimeSweeper" (VT323 38px) + tagline "Group scheduling, defused." (system font 13px)
3. **Create form** (sunken panel):
   - Event name input (beveled sunken, system font 12px)
   - Calendar date picker: 7-day grid, month/year header with `<` `>` nav, click to select dates (max 7 free plan). Selected dates highlighted with navy background.
   - Time range label: "What times might work?" Two beveled dropdown selects (start/end). Default 2:00 PM – 10:00 PM.
   - Participant names: list of beveled text inputs. Each has an `x` remove button. "Add participant" raised button below. Max 5 free plan.
   - `Create Event` raised button (full width, system font 12px, bold)
4. **How it works** (sunken panel, VT323 heading):
   - 4 numbered steps in system font, compact text
   - "1. Create event and share the link"
   - "2. Everyone picks their name and marks availability"
   - "3. See group results update in real-time"
   - "4. Pick the best time and confirm"
5. **Recent events** (sunken panel, VT323 heading):
   - List of locally-stored events (IndexedDB)
   - Each row: flag SVG icon + event name + date + "N participants"
   - Click to reopen
6. **Status bar** (bottom): `Free plan | 5 participants max` (sunken-thin segments, pipe-separated)
7. **Footer:** Plain text, system font 10px, pipe-separated: `timesweeper.app | About | GitHub | Privacy`

**Key design rules for landing:**
- No slot interval selector on landing (default 30min, changeable in settings later)
- Font sizes at Win95 scale: 10–13px body
- All inputs use beveled sunken style
- All buttons use raised bevel style
- Calendar nav: plain `<` `>` text, not arrow emoji

### Screen 2: Availability Grid (the core screen)

This is the minesweeper board. A full Win95 window with title bar, control deck, editing grid, results panels, and status bar.

#### Window Structure

Top to bottom: title bar → control deck → two-panel content area (side-by-side on ≥700px, stacked on mobile) → status bar → function bar. The window is a centered `max-width: 900px` Win95-styled box on the teal desktop background. The two content panels are "Your availability" (left) and "Results + Group availability" (right, stacked vertically within the panel).

**Planned layout upgrade — IE5 intranet app style:** The floating-dialog-on-teal look is a known weakness. The target is a full-viewport layout: the window fills `100vh`, the title bar is pinned to the top of the browser, the status/function bars are pinned to the bottom, and the content area scrolls between them. The window acts like a real application rather than a dialog on a desktop. The teal background becomes invisible on normal screens. Max-width constraint stays for readability on wide monitors.

#### Name Selector / Control Deck

The control deck (sunken bevel panel) sits below the title bar and spans the full width. Left side shows `Hi [name]!` with a `Switch...` button. Right side shows `Share` and `Help` buttons.

Clicking `Switch...` opens the **name picker dialog** — a Win95 modal with a list of participant name buttons (tap one to select) and, below the list, an "I'm not in the list" label + text input + "Add participant" button for joining as a new person. Closing the dialog without picking a name is allowed if a name was already selected; on first visit the dialog auto-opens and cannot be dismissed without selecting a name.

The selected name loads that person's availability into the editing grid instantly.

#### Grid Interaction (Minesweeper-Native)

**Cell states and cycle:** Every click cycles through three states in an infinite loop:

```
□ closed (no) → ✔ opened (yes) → ? flagged (maybe) → □ closed (no) → ...
```

**Visual states:**
- **Closed / No:** Default raised gray bevel. Empty cell. The "unclicked minesweeper square."
- **Opened / Yes:** Sunken (1px border), green tint (#a8d4a8), dark green checkmark ✔. Like an "opened" minesweeper cell revealing safe ground.
- **Flagged / Maybe:** Raised gray bevel (same as closed), black question mark `?` on top. Like minesweeper's question mark flag — same cell shape, just the symbol added. **No yellow background** — keep it gray, keep it minesweeper-authentic.

**Cell dimensions:** 44×44px squares. Both width and height set explicitly. The `min-width: 44px` touch target rule from WCAG.

**Drag interaction:**
- **Mousedown** on a cell cycles it to the next state and locks in that target state
- **Drag across other cells** paints them all to the same target state (e.g., if first cell went closed→✔, every dragged-over cell becomes ✔)
- **Touch drag** works the same — finger down starts, slide across to paint
- **Each cell hit only once per drag** (no flickering on re-hover)
- **Undo reverses the entire drag** as one action, not cell-by-cell
- Heatmap updates on drag end (not during) to avoid render thrashing

**Grid layout:** CSS Grid. Time labels in left column (38px wide), day columns sized to `var(--cell)` (44px). Day headers directly in the grid row, perfectly aligned above their columns. 5 days visible on desktop (full work week), horizontally scrollable if more.

**Legend:** Shown above the grid in a compact row:
```
□ no  →  ✔ yes  →  ? maybe  →  □ no
```
Each state shown as a mini cell with the actual bevel styling. The cycle is closed (repeats "no" at end) to make the infinite loop obvious.

**"Your availability" header:** Collapsible accordion header above the grid: `▾ Your availability (America/Lima)` — the selected participant timezone shown in brackets. This is the only timezone shown in the UI. Click to collapse/expand. Triangle flips to `▸` when collapsed.

#### Heatmap (Group Availability)

A separate mini-grid below the editing grid. **Not mixed into the editing surface.**

- **Cell size:** 28×28px squares — same shape as editing grid, smaller since read-only
- **Time label column:** 30px wide
- **Background color intensity:** gray (#c0c0c0) → light green (#b0d0b0) → medium (#80b880) → dark green (#50a050)
- **Numbers use minesweeper colors:** 1=blue, 2=green, 3=red, 4=navy, 5=maroon. Zero is blank/transparent.
- **"Group availability" header:** Collapsible accordion, same style as "Your availability"
- **Scoring:** yes=1 point, maybe=0.5, no=0. Numbers show rounded sum.

#### Results Panel

Sits **above** the Group availability heatmap (inside the same collapsible container). Shows the top 3 time slots ranked by score.

**Each result row:**
- Medal emoji (🥇🥈🥉)
- Day + time label (`Tue 3:00`)
- Score (`3/3`)
- Per-person breakdown (✔ yes / ? maybe per participant name)
- **Inline `[Confirm]` button** on the best time slot

**Below top 3:** `Pick a different time...` link → opens the unified confirm dialog with empty dropdowns.

**"Results · 3/5 participants" header:** Collapsible accordion.

#### Responsive Layout

- **Desktop (≥700px):** "Your availability" and "Results + Group availability" sit side-by-side in a flex row
- **Mobile (<700px):** Stack vertically
- **Accordion collapse:** All panels independently collapsible by clicking their headers. Saves scrolling on mobile.


#### Help Dialog

Opened from the `Help` button in the control deck. A Win95 modal dialog. Title bar: "Help — TimeSweeper". Content: 6 numbered steps:

1. Click `Switch...` and pick your name
2. Click cells to mark availability (shows the visual cycle: □→✔→?→□)
3. Click and drag to fill multiple cells at once
4. Check group availability below to see overlap
5. Share the link so others can fill in
6. Confirm the best time when everyone's done

Keyboard shortcuts listed at bottom. **OK** button closes.

#### Share Dialog

Click Share button → Win95 dialog box (not clipboard API alone, which fails in some contexts):
- Title bar: "Share Event"
- Text input (sunken, read-only) containing the event URL, auto-selected on open
- **Copy** button → copies to clipboard, shows "✔ Copied" in the status bar for 2 seconds
- **Close** button
- Click the input to select-all for manual Ctrl+C

#### Confirm Dialog (Unified)

A single dialog serves both "confirm a suggested best time" and "pick a different time":

- Title bar: "Confirm Time"
- **Day dropdown** (Win95 select): lists all event dates
- **Time dropdown** (Win95 select): lists all time slots for selected day
- When opened from a best-time result row → dropdowns pre-filled with that day/time
- When opened from "Pick a different time..." → dropdowns empty (user selects)
- **Confirm** button → sets event status to confirmed, updates status bar: `✅ Confirmed | Tue 3:00`
- **Cancel** button → closes dialog

#### Status Bar

Two segments (sunken-thin):
- Left: `Editing: [name]` when a name is selected, or `No participants yet` when none. If a time has been confirmed, appends ` | Confirmed | [label]`. Temporary flash messages (e.g., `Link copied to clipboard`) replace the left segment for 2 seconds, then revert.
- Right: `timesweeper.app`

Timezone is shown only in the "Your availability (Timezone)" header.

#### Function Bar

Bottom of the window, thin border-top separator. Three items:

```
F1 Undo  |  F3 Share  |  F5 Confirm
```

Each is clickable. Hotkey letter underlined.

### Confirmed State

Confirmed mode uses a blocking overlay over the grid window:
- Shows event details (`Event`, `Created by`, `When`, `Participants`)
- Shows action row (`Download .ics`, `Copy summary`)
- Shows separate undo area (`Undo confirmation`)
- Locks availability editing until confirmation is undone

### Screen 5: Upgrade Prompt

Win95 dialog box. Appears when the 6th person tries to join a free event:
- Current count: `"5/5 participants"`
- Slot pack options: `+5 / $2`, `+15 / $4`, `Unlimited / $6`
- "One-time payment for this event. No account needed."
- "Anyone with the link can upgrade."
- Back button

---

## Confirmed UI Decisions (from prototyping v1–v8)

These decisions were made through iterative HTML prototyping and are final:

1. **Cell cycle is tap-based, not mode-based.** One click cycles through all three states. No separate "flag mode" button — tested and rejected as confusing. The infinite loop (no→yes→maybe→no) is the interaction.

2. **No smiley face.** Tested in v1–v4, removed in v5. The minesweeper smiley doesn't map to anything functional in a scheduling context. Control deck is: `Hi [name]!`, `Switch...`, `Share`, `Help`.

3. **No LED counters.** The red LED number displays (flag count, mine count) were tested and removed. Random numbers next to the smiley confused users. The status bar serves the same purpose.

4. **Flagged cells have NO yellow background.** Tested both ways. Yellow tint made the cell look like a third distinct visual element. Keeping it default gray with just the `?` symbol on top is more minesweeper-authentic. The question mark IS the minesweeper question mark — same cell, same bevel, just the symbol.

5. **Cells must be square.** 44×44px. Both width and height explicit. Non-square cells (tested at 36px height) felt wrong. The minesweeper grid is a grid of squares.

6. **Heatmap cells are also square.** 28×28px. Same shape as editing grid, just smaller. Tested with rectangular heatmap cells — rejected as visually inconsistent.

7. **Drag paints a single target state.** The first cell clicked determines the target state. All subsequent cells in the drag get that same state. This prevents accidental cycling during drag.

8. **Name selector is a "Hi [name]! Switch..." control deck pattern.** Not a native `<select>`. The control deck shows the current name inline and a `Switch...` button that opens a name picker dialog. The dialog lists participant name buttons (tap to select) and an "I'm not in the list" input + "Add participant" button for new participants.

9. **Share feedback goes in the status bar.** No toasts, no modals for clipboard confirmation. The status bar shows "Link copied to clipboard" for 2 seconds. This is the most Win95-native feedback pattern.

10. **Share action opens a dialog with the link.** Clipboard API is unreliable in sandboxed environments. The dialog with a text input (auto-selected) and Copy button always works.

11. **Both panels are collapsible accordions.** "Your availability" and "Group availability" can each be collapsed by clicking their header. Triangle indicator flips (▾→▸). Essential for mobile.

12. **Desktop: side-by-side. Mobile: stacked.** At ≥700px, the two panels sit in a horizontal flex row. Below that, they stack vertically.


14. **Legend closes the loop visually.** `□ no → ✔ yes → ? maybe → □ no` — the repeated "no" at the end makes the infinite cycle obvious without explanation.

15. **"Your availability" label exists.** A header matching the "Group availability" style sits above the editing grid. Without it, users didn't immediately understand which grid they were editing.

16. **Help dialog has step-by-step instructions.** Not a tooltip, not inline text. A proper Win95 modal with numbered steps and keyboard shortcuts. Opened from the Help menu item.

17. **Results panel shows top 3 with inline Confirm buttons.** Plus "Pick a different time..." which opens the same confirm dialog with empty dropdowns.

18. **Single unified confirm dialog** for both "confirm this suggestion" and "pick a custom time." Day/time dropdowns pre-fill when clicking a suggestion, empty when clicking "Pick a different time."

19. **No emoji anywhere in UI chrome.** Mine SVG replaces 💣. Flag SVG replaces 📅. Calendar nav uses `<` `>`. Remove buttons use `x`. Status bar separators use `|`.

20. **Landing page uses Win95 system fonts at Win95 scale.** 10–13px body text. VT323 only for brand name and section headings. Everything else is Segoe UI / Tahoma / MS Sans Serif.

21. **Confirmed state uses two surfaces.** A notification bar (yellow, full-width, Win95 bevel) appears between the control deck and content panels showing the confirmed slot label. Simultaneously, the Suggestions panel header and body transform to display the confirmed time prominently. Both surfaces revert on unconfirm.

22. **The grid page is a full-viewport application, not a floating dialog.** The window fills `100vh`. Title bar pins to top. Status and function bars pin to bottom. Content scrolls between them. Teal background is structural but invisible on normal screens. Floating-on-teal is rejected as too dialog-like for a primary app screen.

---

## User Journeys

### Journey A: Friends scheduling a game session (Use Case A)

1. **Alex (Berlin)** opens timesweeper.app, creates "Game Night"
2. Selects next Mon–Thu, time range 6pm–11pm
3. Adds names: Alex, Jamie, Sam, Li, Max
4. Creates event, copies link, pastes in Telegram group
5. Picks "Alex", fills in availability on the grid. Times shown in CET.
6. **Jamie (NYC)** taps the link on phone. Sees name list, taps "Jamie". TZ auto-detected as EST. Grid shows times in EST. Fills in availability. Sees Alex's heatmap overlaid.
7. **Sam (Tokyo)** opens link next morning. Taps "Sam". Sees JST times. Fills in. Heatmap updates.
8. Li and Max fill in over the next day.
9. **Anyone** opens results, sees best times ranked by shared availability.
10. Jamie taps the top suggestion, confirms it. Event page now shows "✅ Tue 2:30 PM EST / 8:30 PM CET / Wed 4:30 AM JST".
11. Everyone downloads .ics or copies summary to Telegram.

### Journey B: VC fund scheduling with an investor (Use Case B)

1. **Maria** at a small fund opens timesweeper.app, creates "Intro call — Acme Ventures"
2. Selects next Mon–Fri, time range 9am–6pm
3. Adds names: Maria, David (investor)
4. Creates event, copies link, emails it to David
5. Maria fills in her availability
6. **David** (different org, different calendar system, maybe on phone) opens link, taps "David", fills in. Zero setup required.
7. The heatmap shows obvious overlap. Maria confirms Wednesday 2pm.
8. Both download .ics.
9. Total time: ~2 minutes. No accounts, no back-and-forth emails.

---

## Next Steps

### Step 1: Build from Prototypes
The grid interaction (v8 prototype) and landing page prototype are complete as single-file HTML. Next: extract into component architecture (SolidJS/Preact), wire up IndexedDB, implement real timezone conversion.

### Step 2: UTC Conversion + Cross-TZ Grid
Prove that the grid works across timezones: Alex picks "Tuesday 8pm" in CET, Jamie opens the same event and sees "Tuesday 2pm" in EST. The heatmap is consistent for both viewers.

### Step 3: Wire Up Sync + Ship
Minimal backend, WebSocket sync, offline queue. Deploy, test with actual friend group. Iterate.

---

## Prototypes

Working HTML prototypes exist for:
- **Availability grid** (v8): `timesweep-grid.html` — full minesweeper-themed grid with drag, undo, accordion panels, results, confirm dialog, help dialog, share dialog
- **Landing page**: `timesweep-landing.html` — Win95-themed create form with calendar picker, SVG icons, recent events

These prototypes are the source of truth for all UI decisions documented above.
