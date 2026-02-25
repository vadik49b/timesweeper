import { createSignal, createMemo, For } from 'solid-js'

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]
const DOWS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

const TIMES = (() => {
  const out: { label: string; value: string }[] = []
  for (let h = 0; h < 24; h++) {
    for (const m of [0, 30]) {
      const hh = h % 12 || 12
      const ampm = h < 12 ? 'AM' : 'PM'
      const mm = m === 0 ? '00' : '30'
      out.push({ label: `${hh}:${mm} ${ampm}`, value: `${String(h).padStart(2, '0')}:${mm}` })
    }
  }
  return out
})()

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

function FlagIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16">
      <polygon points="4,2 4,11 11,6" fill="#ff0000" />
      <line x1="4" y1="2" x2="4" y2="14" stroke="black" stroke-width="1.5" />
      <rect x="2" y="13" width="5" height="1.5" fill="black" />
    </svg>
  )
}

interface Props {
  onCreateEvent: () => void
}

export default function Landing(props: Props) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const [calYear, setCalYear] = createSignal(today.getFullYear())
  const [calMonth, setCalMonth] = createSignal(today.getMonth())
  const [selectedDates, setSelectedDates] = createSignal<Record<string, boolean>>({})
  const [participants, setParticipants] = createSignal(['', ''])
  const [eventName, setEventName] = createSignal('')
  const [timeStart, setTimeStart] = createSignal('14:00')
  const [timeEnd, setTimeEnd] = createSignal('22:00')
  const [status, setStatus] = createSignal('Ready')

  const calDays = createMemo(() => {
    const year = calYear(),
      month = calMonth()
    const first = new Date(year, month, 1)
    let startDow = first.getDay() - 1
    if (startDow < 0) startDow = 6
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const days: {
      day: number | null
      ds: string | null
      isPast: boolean
      isToday: boolean
      isSelected: boolean
    }[] = []
    for (let i = 0; i < startDow; i++)
      days.push({ day: null, ds: null, isPast: false, isToday: false, isSelected: false })
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(year, month, d)
      const ds = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      days.push({
        day: d,
        ds,
        isPast: date < today,
        isToday: date.getTime() === today.getTime(),
        isSelected: !!selectedDates()[ds],
      })
    }
    return days
  })

  const selectedDateLabels = createMemo(() => {
    const keys = Object.keys(selectedDates()).sort()
    if (keys.length === 0) return 'No dates selected'
    const labels = keys.map((ds) => {
      const [y, m, d] = ds.split('-').map(Number)
      const dt = new Date(y, m - 1, d)
      return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dt.getDay()] + ' ' + d
    })
    return `${labels.join(', ')} (${keys.length} day${keys.length > 1 ? 's' : ''})`
  })

  function calNav(dir: number) {
    let m = calMonth() + dir,
      y = calYear()
    if (m > 11) {
      m = 0
      y++
    }
    if (m < 0) {
      m = 11
      y--
    }
    setCalMonth(m)
    setCalYear(y)
  }

  function toggleDate(ds: string) {
    const cur = selectedDates()
    if (cur[ds]) {
      const next = { ...cur }
      delete next[ds]
      setSelectedDates(next)
    } else {
      setSelectedDates({ ...cur, [ds]: true })
    }
  }

  function flash(msg: string) {
    setStatus(msg)
    setTimeout(() => setStatus('Ready'), 2000)
  }

  function addParticipant() {
    if (participants().length >= 5) {
      flash('Max 5 participants (free plan)')
      return
    }
    setParticipants([...participants(), ''])
  }

  function removeParticipant(i: number) {
    if (participants().length <= 1) return
    setParticipants(participants().filter((_, idx) => idx !== i))
  }

  function updateParticipant(i: number, val: string) {
    const next = [...participants()]
    next[i] = val
    setParticipants(next)
  }

  function create() {
    if (!eventName().trim()) {
      flash('Enter an event name')
      return
    }
    if (Object.keys(selectedDates()).length === 0) {
      flash('Pick at least one date')
      return
    }
    props.onCreateEvent()
  }

  document.addEventListener('keydown', (e) => {
    if ((document.activeElement as HTMLElement)?.tagName === 'INPUT') return
    if (e.key === 'a' || e.key === 'A') {
      e.preventDefault()
      addParticipant()
    }
    if (e.key === 'c' || e.key === 'C') {
      e.preventDefault()
      create()
    }
  })

  return (
    <div class="landing">
      <div class="hero">
        <h1>
          <span class="mine-ico">
            <MineIcon size={34} />
          </span>
          TimeSweeper
        </h1>
        <p>
          Find a time that works for everyone.
          <br />
          No login. No app. Just a link.
        </p>
        <div class="hero-features">
          <span class="hero-tag r">No accounts</span>
          <span class="hero-tag r">Works offline</span>
          <span class="hero-tag r">Timezone-aware</span>
        </div>
      </div>

      <div class="form-card r">
        <div class="field">
          <label>Event name:</label>
          <div class="input-wrap s">
            <input
              type="text"
              placeholder="e.g. Game Night, Intro Call"
              autofocus
              value={eventName()}
              onInput={(e) => setEventName(e.currentTarget.value)}
            />
          </div>
        </div>

        <div class="field">
          <label>Pick dates:</label>
          <div class="s" style={{ padding: '4px' }}>
            <div class="cal-header">
              <div class="cal-nav r" onClick={() => calNav(-1)}>
                &lt;
              </div>
              <span>
                {MONTHS[calMonth()]} {calYear()}
              </span>
              <div class="cal-nav r" onClick={() => calNav(1)}>
                &gt;
              </div>
            </div>
            <div class="cal-grid">
              <For each={DOWS}>{(d) => <div class="cal-dow">{d}</div>}</For>
              <For each={calDays()}>
                {(day) => (
                  <div
                    classList={{
                      'cal-day': true,
                      empty: day.day === null,
                      past: day.isPast,
                      today: day.isToday,
                      selected: day.isSelected,
                    }}
                    onClick={() => {
                      if (day.ds && !day.isPast) toggleDate(day.ds)
                    }}
                  >
                    {day.day ?? ''}
                  </div>
                )}
              </For>
            </div>
            <div
              style={{
                'font-size': '10px',
                color: '#808080',
                'margin-top': '4px',
                'text-align': 'center',
              }}
            >
              {selectedDateLabels()}
            </div>
          </div>
        </div>

        <div class="field">
          <label>Time range:</label>
          <div class="time-range">
            <div class="s" style={{ flex: '1' }}>
              <div class="sel-inner">
                <select value={timeStart()} onChange={(e) => setTimeStart(e.currentTarget.value)}>
                  <For each={TIMES}>{(t) => <option value={t.value}>{t.label}</option>}</For>
                </select>
                <div class="sel-arrow r">&#9660;</div>
              </div>
            </div>
            <span>to</span>
            <div class="s" style={{ flex: '1' }}>
              <div class="sel-inner">
                <select value={timeEnd()} onChange={(e) => setTimeEnd(e.currentTarget.value)}>
                  <For each={TIMES}>{(t) => <option value={t.value}>{t.label}</option>}</For>
                </select>
                <div class="sel-arrow r">&#9660;</div>
              </div>
            </div>
          </div>
        </div>

        <div class="field">
          <label>Who's in?</label>
          <For each={participants()}>
            {(p, i) => (
              <div class="participant-row">
                <div class="s" style={{ flex: '1' }}>
                  <input
                    type="text"
                    placeholder={i() === 0 ? 'Your name' : 'Name'}
                    value={p}
                    onInput={(e) => updateParticipant(i(), e.currentTarget.value)}
                  />
                </div>
                <div class="p-rm r" onClick={() => removeParticipant(i())}>
                  x
                </div>
              </div>
            )}
          </For>
          <div class="add-btn r" onClick={addParticipant}>
            + <span class="hk">A</span>dd person
          </div>
        </div>
      </div>

      <div class="create-btn r" onClick={create}>
        <span class="hk">C</span>reate Event
      </div>

      <div class="status-row">
        <div class="ss st">{status()}</div>
        <div class="ss st">Free plan | 5 participants max</div>
      </div>

      <div class="how-section">
        <div class="how-title">How it works</div>
        <div class="how-steps r">
          <div class="how-step">
            <div class="how-num r">1</div>
            <div class="how-text">Create an event and share the link with your group</div>
          </div>
          <div class="how-step">
            <div class="how-num r">2</div>
            <div class="how-text">
              Everyone opens the link, picks their name, and marks when they're free
            </div>
          </div>
          <div class="how-step">
            <div class="how-num r">3</div>
            <div class="how-text">See the group heatmap — the best times light up instantly</div>
          </div>
          <div class="how-step">
            <div class="how-num r">4</div>
            <div class="how-text">Confirm a time and everyone gets a calendar invite</div>
          </div>
        </div>
      </div>

      <div class="recent-section">
        <div class="recent-panel r">
          <div class="recent-title">
            <span>Your recent events</span>
            <hr />
          </div>
          {[
            { name: 'Investor Call', date: 'Mar 1' },
            { name: 'D&D Session', date: 'Feb 20' },
            { name: 'Team Standup', date: 'Feb 15' },
          ].map((e) => (
            <div class="recent-item">
              <span class="flag-ico">
                <FlagIcon />
              </span>
              {e.name}
              <span class="recent-date">| {e.date}</span>
            </div>
          ))}
        </div>
      </div>

      <div class="footer">
        No accounts | No tracking | Works offline
        <br />
        Timezones handled automatically
        <br />
        <span style={{ 'margin-top': '4px', display: 'inline-block' }}>
          timesweeper.app | <a href="#">About</a>
        </span>
      </div>
    </div>
  )
}
