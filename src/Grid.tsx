import { createSignal, createMemo, onMount, onCleanup, For, Show } from 'solid-js'
import { createStore } from 'solid-js/store'

const DAYS = [
  { label: 'Mon 2', key: 'mon' },
  { label: 'Tue 3', key: 'tue' },
  { label: 'Wed 4', key: 'wed' },
  { label: 'Thu 5', key: 'thu' },
  { label: 'Fri 6', key: 'fri' },
]

const TIMES = [
  '2:00',
  '2:30',
  '3:00',
  '3:30',
  '4:00',
  '4:30',
  '5:00',
  '5:30',
  '6:00',
  '6:30',
  '7:00',
  '7:30',
  '8:00',
  '8:30',
  '9:00',
  '9:30',
]

type Participant = { key: string; label: string }
type UndoEntry = { dk: string; ti: number; prev: number }

function MineIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
      <line x1="8" y1="1" x2="8" y2="4" stroke="black" stroke-width="1.5" />
      <line x1="8" y1="12" x2="8" y2="15" stroke="black" stroke-width="1.5" />
      <line x1="1" y1="8" x2="4" y2="8" stroke="black" stroke-width="1.5" />
      <line x1="12" y1="8" x2="15" y2="8" stroke="black" stroke-width="1.5" />
      <line x1="3" y1="3" x2="5" y2="5" stroke="black" stroke-width="1.2" />
      <line x1="11" y1="3" x2="13" y2="5" stroke="black" stroke-width="1.2" />
      <line x1="3" y1="13" x2="5" y2="11" stroke="black" stroke-width="1.2" />
      <line x1="11" y1="13" x2="13" y2="11" stroke="black" stroke-width="1.2" />
      <circle cx="8" cy="8" r="4" fill="black" />
      <rect x="6" y="6" width="2" height="2" fill="white" />
    </svg>
  )
}

export default function Grid() {
  // --- State ---
  const [myState, setMyState] = createStore<Record<string, number[]>>(
    Object.fromEntries(DAYS.map((d) => [d.key, new Array(TIMES.length).fill(0)])),
  )

  const [participants, setParticipants] = createSignal<Participant[]>([
    { key: 'jamie', label: 'Jamie (EST)' },
    { key: 'alex', label: 'Alex (CET)' },
    { key: 'sam', label: 'Sam (JST)' },
  ])
  const [currentName, setCurrentName] = createSignal('jamie')

  const [focusMode, setFocusMode] = createSignal(false)
  const [editCollapsed, setEditCollapsed] = createSignal(false)
  const [bestCollapsed, setBestCollapsed] = createSignal(false)
  const [groupCollapsed, setGroupCollapsed] = createSignal(false)

  type Dialog = null | 'share' | 'help' | 'confirm'
  const [dialog, setDialog] = createSignal<Dialog>(null)
  const [confirmDay, setConfirmDay] = createSignal(DAYS[0].label)
  const [confirmTime, setConfirmTime] = createSignal(TIMES[0])

  const [statusLeft, setStatusLeft] = createSignal('Ready')
  const [statusMid, setStatusMid] = createSignal('')

  // Mock other participants' availability
  const others: Record<string, Record<string, number[]>> = {
    alex: Object.fromEntries(
      DAYS.map((d) => [
        d.key,
        TIMES.map(() => (Math.random() > 0.45 ? (Math.random() > 0.3 ? 1 : 2) : 0)),
      ]),
    ),
    sam: Object.fromEntries(
      DAYS.map((d) => [
        d.key,
        TIMES.map(() => (Math.random() > 0.55 ? (Math.random() > 0.4 ? 1 : 2) : 0)),
      ]),
    ),
  }

  // Non-reactive drag state
  let dragging = false
  let dragTargetState = 0
  let draggedCells = new Set<string>()
  let dragUndoBatch: UndoEntry[] = []
  let undoStack: UndoEntry[][] = []
  let statusTimer: ReturnType<typeof setTimeout> | null = null
  let nameSelectRef!: HTMLSelectElement

  // --- Logic ---
  function heat(dk: string, ti: number) {
    let c = 0
    const m = myState[dk][ti]
    if (m === 1) c += 1
    else if (m === 2) c += 0.5
    Object.values(others).forEach((p) => {
      const v = p[dk]?.[ti] ?? 0
      if (v === 1) c += 1
      else if (v === 2) c += 0.5
    })
    return Math.round(c)
  }

  const bestTimes = createMemo(() => {
    const slots: { day: string; time: string; score: number; dk: string; ti: number }[] = []
    DAYS.forEach((d) =>
      TIMES.forEach((t, ti) => {
        const h = heat(d.key, ti)
        if (h > 0) slots.push({ day: d.label, time: t, score: h, dk: d.key, ti })
      }),
    )
    slots.sort((a, b) => b.score - a.score)
    return slots.slice(0, 3)
  })

  function dragStart(dk: string, ti: number) {
    dragging = true
    draggedCells = new Set()
    dragUndoBatch = []
    const prev = myState[dk][ti]
    dragTargetState = (prev + 1) % 3
    dragUndoBatch.push({ dk, ti, prev })
    setMyState(dk, ti, dragTargetState)
    draggedCells.add(`${dk}-${ti}`)
    if (navigator.vibrate) navigator.vibrate(10)
  }

  function dragOver(dk: string, ti: number) {
    const key = `${dk}-${ti}`
    if (draggedCells.has(key)) return
    const prev = myState[dk][ti]
    dragUndoBatch.push({ dk, ti, prev })
    setMyState(dk, ti, dragTargetState)
    draggedCells.add(key)
    if (navigator.vibrate) navigator.vibrate(5)
  }

  function dragEnd() {
    if (!dragging) return
    dragging = false
    if (dragUndoBatch.length > 0) undoStack.push([...dragUndoBatch])
    dragUndoBatch = []
    draggedCells = new Set()
  }

  function doUndo() {
    if (!undoStack.length) return
    const batch = undoStack.pop()!
    batch.forEach((u) => setMyState(u.dk, u.ti, u.prev))
  }

  function toggleFocus() {
    const next = !focusMode()
    setFocusMode(next)
    if (next) {
      setBestCollapsed(true)
      setGroupCollapsed(true)
    } else {
      setBestCollapsed(false)
      setGroupCollapsed(false)
    }
    setStatusLeft(next ? '🔒 Focus ON' : 'Ready')
  }

  function openConfirm(day: string | null, time: string | null) {
    setConfirmDay(day ?? DAYS[0].label)
    setConfirmTime(time ?? TIMES[0])
    setDialog('confirm')
  }

  function doConfirm() {
    setDialog(null)
    setStatusLeft('✅ Confirmed')
    setStatusMid(`${confirmDay()} ${confirmTime()}`)
  }

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      /* fallback */
    }
    const prev = statusMid()
    setStatusMid('Link copied to clipboard')
    if (statusTimer) clearTimeout(statusTimer)
    statusTimer = setTimeout(() => setStatusMid(prev), 2000)
  }

  function onNameChange(e: Event) {
    const sel = e.currentTarget as HTMLSelectElement
    if (sel.value === '_add') {
      const name = prompt('Your name:')
      if (name) {
        const key = name.toLowerCase().replace(/\s+/g, '')
        setParticipants([...participants(), { key, label: name }])
        setCurrentName(key)
      } else {
        sel.value = currentName()
      }
    } else {
      setCurrentName(sel.value)
    }
  }

  const currentLabel = createMemo(
    () => participants().find((p) => p.key === currentName())?.label ?? currentName(),
  )

  // Global event listeners
  onMount(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        (e.target as HTMLElement).tagName === 'INPUT' ||
        (e.target as HTMLElement).tagName === 'SELECT'
      )
        return
      if (e.key === 'F1') {
        e.preventDefault()
        doUndo()
      }
      if (e.key === 'F2') {
        e.preventDefault()
        toggleFocus()
      }
      if (e.key === 'u' || e.key === 'U') {
        e.preventDefault()
        doUndo()
      }
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault()
        toggleFocus()
      }
      if (e.key === 's' || e.key === 'S') {
        e.preventDefault()
        setDialog('share')
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault()
        doUndo()
      }
    }

    const onTouchMove = (e: TouchEvent) => {
      if (!dragging) return
      e.preventDefault()
      const touch = e.touches[0]
      const el = document.elementFromPoint(touch.clientX, touch.clientY) as HTMLElement | null
      if (el?.dataset.day) dragOver(el.dataset.day, parseInt(el.dataset.ti!))
    }

    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('mouseup', dragEnd)
    document.addEventListener('mouseleave', dragEnd)
    document.addEventListener('touchmove', onTouchMove, { passive: false })
    document.addEventListener('touchend', dragEnd)
    document.addEventListener('touchcancel', dragEnd)

    onCleanup(() => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('mouseup', dragEnd)
      document.removeEventListener('mouseleave', dragEnd)
      document.removeEventListener('touchmove', onTouchMove)
      document.removeEventListener('touchend', dragEnd)
      document.removeEventListener('touchcancel', dragEnd)
    })
  })

  const MEDALS = ['🥇', '🥈', '🥉']
  const EVENT_URL = 'https://timesweeper.app/e/a1b2c3d4'

  return (
    <div class="grid-view">
      <div class="win r">
        {/* Title bar */}
        <div class="tbar">
          <span style={{ display: 'flex', 'align-items': 'center', gap: '4px' }}>
            <MineIcon size={16} /> TimeSweeper — Intro Call
          </span>
          <div class="tbtns">
            <div class="tbtn r">─</div>
            <div class="tbtn r">□</div>
            <div class="tbtn r">×</div>
          </div>
        </div>

        <div class="wb">
          {/* Menu bar */}
          <div class="mbar">
            <div class="mi">
              <span class="hk">G</span>ame
            </div>
            <div class="mi">
              <span class="hk">V</span>iew
            </div>
            <div class="mi" onClick={() => setDialog('help')}>
              <span class="hk">H</span>elp
            </div>
          </div>

          {/* Control bar */}
          <div class="cbar s">
            <div class="sel-wrap s">
              <div class="sel-inner">
                <select ref={nameSelectRef} value={currentName()} onChange={onNameChange}>
                  <For each={participants()}>{(p) => <option value={p.key}>{p.label}</option>}</For>
                  <option value="_add">+ Add yourself...</option>
                </select>
                <div class="sel-arrow r">▼</div>
              </div>
            </div>
            <div class="share-btn r" onClick={() => setDialog('share')}>
              <span class="hk">S</span>hare
            </div>
          </div>

          {/* Two-panel layout */}
          <div class="panels">
            {/* Panel: Your availability */}
            <div class="panel">
              <div class="gwrap s">
                <div class="panel-header" onClick={() => setEditCollapsed(!editCollapsed())}>
                  <div class="panel-toggle">{editCollapsed() ? '▸' : '▾'}</div>
                  <span>Your availability</span>
                  <hr />
                </div>
                <Show when={!editCollapsed()}>
                  <div class="panel-body">
                    <div class="legend">
                      <span class="lc" /> no →
                      <span class="lc lc-open" style={{ color: '#006800' }}>
                        ✔
                      </span>{' '}
                      yes →<span class="lc">?</span> maybe →
                      <span class="lc" /> no
                    </div>
                    <div
                      class="gtable"
                      style={{
                        'grid-template-columns': `38px repeat(${DAYS.length}, var(--cell))`,
                      }}
                    >
                      <div style={{ height: '22px' }} />
                      <For each={DAYS}>{(d) => <div class="chdr">{d.label}</div>}</For>
                      <For each={TIMES}>
                        {(t, ti) => (
                          <>
                            <div class="tlbl">{t}</div>
                            <For each={DAYS}>
                              {(d) => (
                                <div
                                  classList={{
                                    cell: true,
                                    opened: myState[d.key][ti()] === 1,
                                    flagged: myState[d.key][ti()] === 2,
                                  }}
                                  onMouseDown={(e) => {
                                    e.preventDefault()
                                    dragStart(d.key, ti())
                                  }}
                                  onMouseEnter={() => {
                                    if (dragging) dragOver(d.key, ti())
                                  }}
                                  onTouchStart={(e) => {
                                    e.preventDefault()
                                    dragStart(d.key, ti())
                                  }}
                                  data-day={d.key}
                                  data-ti={String(ti())}
                                >
                                  <Show when={myState[d.key][ti()] === 1}>
                                    <span class="ico">✔</span>
                                  </Show>
                                  <Show when={myState[d.key][ti()] === 2}>
                                    <span class="ico">?</span>
                                  </Show>
                                </div>
                              )}
                            </For>
                          </>
                        )}
                      </For>
                    </div>
                  </div>
                </Show>
              </div>
            </div>

            {/* Panel: Results + Group heatmap */}
            <div class="panel">
              <div class="gwrap s">
                {/* Results sub-panel */}
                <div class="panel-header" onClick={() => setBestCollapsed(!bestCollapsed())}>
                  <div class="panel-toggle">{bestCollapsed() ? '▸' : '▾'}</div>
                  <span>Results · 3/5 participants</span>
                  <hr />
                </div>
                <Show when={!bestCollapsed()}>
                  <div class="panel-body">
                    <Show
                      when={bestTimes().length > 0}
                      fallback={
                        <div style={{ 'font-size': '14px', padding: '4px 2px', color: '#808080' }}>
                          No availability yet
                        </div>
                      }
                    >
                      <div style={{ 'font-size': '14px', padding: '4px 2px' }}>
                        <For each={bestTimes()}>
                          {(slot, i) => {
                            const myVal = () => myState[slot.dk][slot.ti]
                            const breakdown = () => {
                              const parts: string[] = []
                              if (myVal() === 1)
                                parts.push('<span style="color:#006800">✔ You</span>')
                              else if (myVal() === 2)
                                parts.push('<span style="color:#404040">? You</span>')
                              Object.entries(others).forEach(([name, data]) => {
                                const v = data[slot.dk]?.[slot.ti] ?? 0
                                const n = name.charAt(0).toUpperCase() + name.slice(1)
                                if (v === 1) parts.push(`<span style="color:#006800">✔ ${n}</span>`)
                                else if (v === 2)
                                  parts.push(`<span style="color:#404040">? ${n}</span>`)
                              })
                              return parts.join(' · ')
                            }
                            return (
                              <div
                                style={{
                                  'margin-bottom': '4px',
                                  padding: '3px 4px',
                                  display: 'flex',
                                  'align-items': 'flex-start',
                                  gap: '6px',
                                  background: i() === 0 ? '#e8e8e8' : '',
                                }}
                              >
                                <div style={{ flex: '1' }}>
                                  <div>
                                    {MEDALS[i()]}{' '}
                                    <b>
                                      {slot.day} {slot.time}
                                    </b>{' '}
                                    · {slot.score}/3
                                  </div>
                                  <div
                                    style={{
                                      'font-size': '12px',
                                      'margin-left': '22px',
                                      color: '#404040',
                                    }}
                                    innerHTML={breakdown()}
                                  />
                                </div>
                                <div
                                  class="dialog-btn r"
                                  style={{
                                    'font-size': '12px',
                                    padding: '2px 8px',
                                    'min-width': '0',
                                    'flex-shrink': '0',
                                    cursor: 'pointer',
                                  }}
                                  onClick={() => openConfirm(slot.day, slot.time)}
                                >
                                  <span class="hk">C</span>onfirm
                                </div>
                              </div>
                            )
                          }}
                        </For>
                        <div style={{ 'margin-top': '6px', padding: '3px 4px' }}>
                          <div
                            class="dialog-btn r"
                            style={{
                              'font-size': '13px',
                              padding: '3px 10px',
                              'min-width': '0',
                              cursor: 'pointer',
                              display: 'inline-block',
                            }}
                            onClick={() => openConfirm(null, null)}
                          >
                            Pick a different time...
                          </div>
                        </div>
                      </div>
                    </Show>
                  </div>
                </Show>

                {/* Group heatmap sub-panel */}
                <div
                  class="panel-header"
                  style={{ 'margin-top': '4px' }}
                  onClick={() => setGroupCollapsed(!groupCollapsed())}
                >
                  <div class="panel-toggle">{groupCollapsed() ? '▸' : '▾'}</div>
                  <span>Group availability</span>
                  <hr />
                </div>
                <Show when={!groupCollapsed()}>
                  <div class="panel-body">
                    <div class="hmleg">
                      <span>
                        <span class="hmsw" style={{ background: '#c0c0c0' }} />0
                      </span>
                      <span>
                        <span class="hmsw" style={{ background: '#b0d0b0' }} />
                        <b style={{ color: 'var(--num-1)' }}>1</b>
                      </span>
                      <span>
                        <span class="hmsw" style={{ background: '#80b880' }} />
                        <b style={{ color: 'var(--num-2)' }}>2</b>
                      </span>
                      <span>
                        <span class="hmsw" style={{ background: '#50a050' }} />
                        <b style={{ color: 'var(--num-3)' }}>3</b>
                      </span>
                    </div>
                    <div
                      class="hmgrid"
                      style={{
                        'grid-template-columns': `30px repeat(${DAYS.length}, var(--hm-cell))`,
                      }}
                    >
                      <div style={{ height: '16px' }} />
                      <For each={DAYS}>{(d) => <div class="hmchdr">{d.label}</div>}</For>
                      <For each={TIMES}>
                        {(t, ti) => (
                          <>
                            <div class="hmtlbl">{t}</div>
                            <For each={DAYS}>
                              {(d) => {
                                const h = () => heat(d.key, ti())
                                return (
                                  <div
                                    classList={{
                                      hmc: true,
                                      h0: h() === 0,
                                      h1: h() === 1,
                                      h2: h() === 2,
                                      h3: h() >= 3,
                                    }}
                                  >
                                    <span class={`n${Math.min(h(), 5)}`}>{h() > 0 ? h() : ''}</span>
                                  </div>
                                )
                              }}
                            </For>
                          </>
                        )}
                      </For>
                    </div>
                  </div>
                </Show>
              </div>
            </div>
          </div>
          {/* /panels */}

          {/* Status bar */}
          <div class="sbar">
            <div class="ss st">{statusLeft()}</div>
            <div class="ss st">{statusMid()}</div>
            <div class="ss st">Editing: {currentLabel()}</div>
          </div>

          {/* Function bar */}
          <div class="fbar">
            <div class="fi" onClick={doUndo}>
              <span class="fk">F1</span> <span class="hk">U</span>ndo
            </div>
            <div class="fi" onClick={toggleFocus}>
              <span class="fk">F2</span> <span class="hk">F</span>ocus
            </div>
            <div class="fi" onClick={() => setDialog('share')}>
              <span class="fk">F3</span> <span class="hk">S</span>hare
            </div>
            <div class="fi" onClick={() => openConfirm(null, null)}>
              <span class="fk">F5</span> <span class="hk">C</span>onfirm
            </div>
          </div>
        </div>
        {/* /wb */}
      </div>
      {/* /win */}

      {/* === DIALOGS === */}

      <Show when={dialog() === 'share'}>
        <div class="dialog-overlay">
          <div class="dialog r">
            <div class="tbar">
              <span>Share Event</span>
              <div class="tbtns">
                <div class="tbtn r" onClick={() => setDialog(null)}>
                  ×
                </div>
              </div>
            </div>
            <div class="dialog-body">
              <label>Send this link to participants:</label>
              <div class="dialog-input-wrap s">
                <input
                  class="dialog-input"
                  value={EVENT_URL}
                  readOnly
                  onClick={(e) => (e.currentTarget as HTMLInputElement).select()}
                />
              </div>
              <div class="dialog-buttons">
                <div class="dialog-btn r" onClick={() => copyLink(EVENT_URL)}>
                  <span class="hk">C</span>opy
                </div>
                <div class="dialog-btn r" onClick={() => setDialog(null)}>
                  Close
                </div>
              </div>
            </div>
          </div>
        </div>
      </Show>

      <Show when={dialog() === 'help'}>
        <div class="dialog-overlay">
          <div class="dialog r" style={{ 'max-width': '380px' }}>
            <div class="tbar">
              <span>Help — TimeSweeper</span>
              <div class="tbtns">
                <div class="tbtn r" onClick={() => setDialog(null)}>
                  ×
                </div>
              </div>
            </div>
            <div class="dialog-body" style={{ 'font-size': '15px', 'line-height': '1.6' }}>
              <p style={{ 'margin-bottom': '8px' }}>
                <b>How to use TimeSweeper:</b>
              </p>
              <p style={{ 'margin-bottom': '6px' }}>
                <b>1.</b> Pick your name from the dropdown
              </p>
              <p style={{ 'margin-bottom': '6px' }}>
                <b>2.</b> Click a cell to mark availability:
                <br />
                <span style={{ 'margin-left': '16px' }}>
                  <span class="lc" style={{ 'vertical-align': 'middle' }} /> →{' '}
                  <span class="lc lc-open" style={{ 'vertical-align': 'middle', color: '#006800' }}>
                    ✔
                  </span>{' '}
                  →{' '}
                  <span class="lc" style={{ 'vertical-align': 'middle' }}>
                    ?
                  </span>{' '}
                  → <span class="lc" style={{ 'vertical-align': 'middle' }} />
                </span>
              </p>
              <p style={{ 'margin-bottom': '6px' }}>
                <b>3.</b> Click and drag to fill multiple cells at once
              </p>
              <p style={{ 'margin-bottom': '6px' }}>
                <b>4.</b> Check "Group availability" to see when everyone is free
              </p>
              <p style={{ 'margin-bottom': '6px' }}>
                <b>5.</b> Click <b>Share</b> to send the link to others
              </p>
              <p style={{ 'margin-bottom': '10px' }}>
                <b>6.</b> When the group agrees, click <b>Confirm</b>
              </p>
              <p style={{ 'margin-bottom': '10px', 'font-size': '13px', color: '#404040' }}>
                <b>Keyboard shortcuts:</b>
                <br />
                <span style={{ 'margin-left': '16px' }}>F1 / U — Undo</span>
                <br />
                <span style={{ 'margin-left': '16px' }}>F2 / F — Focus mode</span>
                <br />
                <span style={{ 'margin-left': '16px' }}>S — Share link</span>
                <br />
                <span style={{ 'margin-left': '16px' }}>Ctrl+Z — Undo</span>
              </p>
              <div class="dialog-buttons">
                <div class="dialog-btn r" onClick={() => setDialog(null)}>
                  OK
                </div>
              </div>
            </div>
          </div>
        </div>
      </Show>

      <Show when={dialog() === 'confirm'}>
        <div class="dialog-overlay">
          <div class="dialog r" style={{ 'max-width': '340px' }}>
            <div class="tbar">
              <span>Confirm Time</span>
              <div class="tbtns">
                <div class="tbtn r" onClick={() => setDialog(null)}>
                  ×
                </div>
              </div>
            </div>
            <div class="dialog-body" style={{ 'font-size': '15px' }}>
              <p style={{ 'margin-bottom': '8px' }}>Confirm this time for everyone?</p>
              <label style={{ 'margin-bottom': '2px' }}>Day:</label>
              <div class="sel-wrap s" style={{ 'margin-bottom': '8px' }}>
                <div class="sel-inner">
                  <select
                    value={confirmDay()}
                    onChange={(e) => setConfirmDay(e.currentTarget.value)}
                  >
                    <For each={DAYS}>{(d) => <option value={d.label}>{d.label}</option>}</For>
                  </select>
                  <div class="sel-arrow r">▼</div>
                </div>
              </div>
              <label style={{ 'margin-bottom': '2px' }}>Time:</label>
              <div class="sel-wrap s" style={{ 'margin-bottom': '10px' }}>
                <div class="sel-inner">
                  <select
                    value={confirmTime()}
                    onChange={(e) => setConfirmTime(e.currentTarget.value)}
                  >
                    <For each={TIMES}>{(t) => <option value={t}>{t}</option>}</For>
                  </select>
                  <div class="sel-arrow r">▼</div>
                </div>
              </div>
              <p style={{ 'font-size': '12px', color: '#404040', 'margin-bottom': '10px' }}>
                Everyone will see the confirmed time.
                <br />
                This can be undone later.
              </p>
              <div class="dialog-buttons">
                <div class="dialog-btn r" onClick={doConfirm}>
                  <span class="hk">C</span>onfirm
                </div>
                <div class="dialog-btn r" onClick={() => setDialog(null)}>
                  Cancel
                </div>
              </div>
            </div>
          </div>
        </div>
      </Show>
    </div>
  )
}
