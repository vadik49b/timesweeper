import { createSignal, createMemo, createEffect, onMount, For, Index, Show } from 'solid-js'
import { nanoid } from 'nanoid'
import { computeTimeSlots, type AppEvent } from './types'
import {
  listRecentEvents,
  pushRecentEvent,
  saveEvent,
  setSelectedParticipantName,
  type RecentEventSummary,
} from './db'
import Win95Field from './components/Win95Field'
import Win95Button from './components/Win95Button'
import ErrorDialog from './components/ErrorDialog'
import AppIcon from './icons/AppIcon'
import FlagIcon from './icons/FlagIcon'

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

interface Props {
  onOpenEvent: (id: string) => void
}

export default function Landing(props: Props) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const [calYear, setCalYear] = createSignal(today.getFullYear())
  const [calMonth, setCalMonth] = createSignal(today.getMonth())
  const [selectedDates, setSelectedDates] = createSignal<Record<string, boolean>>({})
  const [participants, setParticipants] = createSignal(['', ''])
  const [eventName, setEventName] = createSignal('')
  const [timeStart, setTimeStart] = createSignal('10:00')
  const [timeEnd, setTimeEnd] = createSignal('18:00')
  const [recentEvents, setRecentEvents] = createSignal<RecentEventSummary[]>([])
  const [pendingParticipantFocus, setPendingParticipantFocus] = createSignal<number | null>(null)
  const [validationError, setValidationError] = createSignal('')
  const participantInputRefs: HTMLInputElement[] = []
  const localTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone

  onMount(async () => {
    const events = await listRecentEvents()
    setRecentEvents(events.slice(0, 5))
  })

  const calDays = createMemo(() => {
    const year = calYear(),
      month = calMonth()
    const first = new Date(year, month, 1)
    let startDow = first.getDay() - 1

    if (startDow < 0) {
      startDow = 6
    }

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

    if (keys.length === 0) {
      return 'No dates selected'
    }

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
      if (Object.keys(cur).length >= 7) {
        return
      }

      setSelectedDates({ ...cur, [ds]: true })
    }
  }

  function addParticipant() {
    const nextIndex = participants().length
    setParticipants([...participants(), ''])
    setPendingParticipantFocus(nextIndex)
  }

  function removeParticipant(i: number) {
    if (i === 0 || participants().length <= 1) {
      return
    }

    setParticipants(participants().filter((_, idx) => idx !== i))
  }

  function updateParticipant(i: number, val: string) {
    const next = [...participants()]
    next[i] = val
    setParticipants(next)
  }

  createEffect(() => {
    const idx = pendingParticipantFocus()

    if (idx === null) {
      return
    }

    participants()
    queueMicrotask(() => {
      const input = participantInputRefs[idx]

      if (!input) {
        return
      }

      input.focus()
      input.select()
      setPendingParticipantFocus(null)
    })
  })

  async function create() {
    if (!eventName().trim()) {
      setValidationError('Please enter an event name.')

      return
    }
    const dates = Object.keys(selectedDates()).sort()

    if (dates.length === 0) {
      setValidationError('Please pick at least one date.')

      return
    }

    if (timeStart() >= timeEnd()) {
      setValidationError('Please choose a valid time range (start must be before end).')

      return
    }
    const trimmedParticipants = participants().map((p) => p.trim())
    const participantNames = trimmedParticipants.filter(Boolean)

    if (!trimmedParticipants[0]) {
      setValidationError('Enter your name')

      return
    }

    if (participantNames.length < 2) {
      setValidationError('Please add at least one other person.')

      return
    }

    const participantNameKeys = new Set<string>()

    for (const name of participantNames) {
      const key = name.toLowerCase()

      if (participantNameKeys.has(key)) {
        setValidationError(`Duplicate name: "${name}". Use unique names.`)

        return
      }

      participantNameKeys.add(key)
    }

    setParticipants(participantNames)
    setValidationError('')
    const timeRange = { start: timeStart(), end: timeEnd() }
    const spd = computeTimeSlots(timeRange).length
    const event: AppEvent = {
      id: nanoid(),
      name: eventName().trim(),
      created: Date.now(),
      status: 'open',
      maxParticipants: Number.MAX_SAFE_INTEGER,
      dates,
      timeRange,
      participants: participantNames.map((name) => ({
        name: name.trim(),
        timezone: '',
        slots: new Array(dates.length * spd).fill(0) as (0 | 1 | 2)[],
        updatedAt: null,
        version: 0,
      })),
    }
    await saveEvent(event)
    await setSelectedParticipantName(event.id, participantNames[0])
    await pushRecentEvent({ id: event.id, name: event.name, created: event.created })
    props.onOpenEvent(event.id)
  }

  return (
    <div class="landing">
      <div class="hero">
        <h1>
          <span class="mine-ico">
            <AppIcon size={34} />
          </span>
          TimeSweeper
        </h1>
        <p>
          Find a time that works for everyone.
          <br />
          No app to install. Just a link.
        </p>
      </div>

      <div class="form-card r">
        <div class="field">
          <label for="event-name">Event name:</label>
          <Win95Field
            kind="input"
            id="event-name"
            name="eventName"
            value={eventName()}
            placeholder="e.g. Game Night, Intro Call"
            autoFocus
            wrapperClass="landing__event-name"
            controlClass="landing__text-input-control"
            onInput={setEventName}
          />
        </div>

        <fieldset class="field landing__group">
          <legend>Pick dates:</legend>
          <div class="landing__calendar s">
            <div class="cal-header">
              <Win95Button
                size="small"
                variant="icon"
                class="cal-nav"
                ariaLabel="Previous month"
                onClick={() => calNav(-1)}
              >
                &lt;
              </Win95Button>
              <span>
                {MONTHS[calMonth()]} {calYear()}
              </span>
              <Win95Button
                size="small"
                variant="icon"
                class="cal-nav"
                ariaLabel="Next month"
                onClick={() => calNav(1)}
              >
                &gt;
              </Win95Button>
            </div>
            <div class="cal-grid">
              <For each={DOWS}>{(d) => <div class="cal-dow">{d}</div>}</For>
              <For each={calDays()}>
                {(day) => (
                  <button
                    type="button"
                    classList={{
                      'cal-day': true,
                      empty: day.day === null,
                      past: day.isPast,
                      today: day.isToday,
                      selected: day.isSelected,
                    }}
                    disabled={day.day === null || day.isPast}
                    aria-label={
                      day.ds
                        ? new Date(`${day.ds}T00:00:00`).toLocaleDateString('en-US', {
                            weekday: 'long',
                            month: 'long',
                            day: 'numeric',
                            year: 'numeric',
                          })
                        : 'Empty day'
                    }
                    aria-pressed={day.isSelected}
                    onClick={() => day.ds && toggleDate(day.ds)}
                  >
                    {day.day ?? ''}
                  </button>
                )}
              </For>
            </div>
            <div class="landing__date-summary">{selectedDateLabels()}</div>
          </div>
        </fieldset>

        <div class="field">
          <label for="time-start">What times might work? ({localTimezone})</label>
          <div class="time-range row row--center row--gap-sm">
            <Win95Field
              kind="select"
              id="time-start"
              name="timeStart"
              size="small"
              value={timeStart()}
              options={TIMES}
              wrapperClass="landing__time-select"
              onChange={setTimeStart}
            />
            <span>to</span>
            <Win95Field
              kind="select"
              id="time-end"
              name="timeEnd"
              size="small"
              value={timeEnd()}
              options={TIMES}
              wrapperClass="landing__time-select"
              onChange={setTimeEnd}
            />
          </div>
        </div>

        <fieldset class="field landing__group">
          <legend>Who's in?</legend>
          <Index each={participants()}>
            {(p, i) => (
              <div class="participant-row">
                <div class="participant-row__field">
                  <label class="participant-row__label" for={`participant-${i}`}>
                    {i === 0 ? 'You' : `Person ${i + 1}`}
                  </label>
                  <Win95Field
                    kind="input"
                    id={`participant-${i}`}
                    name={`participant-${i}`}
                    value={p()}
                    placeholder="Name"
                    wrapperClass="landing__participant-field"
                    controlClass="landing__text-input-control"
                    inputRef={(el) => {
                      participantInputRefs[i] = el
                    }}
                    onInput={(value) => updateParticipant(i, value)}
                  />
                </div>
                {i > 0 && (
                  <Win95Button
                    size="small"
                    variant="icon"
                    class="p-rm"
                    onClick={() => removeParticipant(i)}
                  >
                    x <span class="sr-only">Remove person {i + 1}</span>
                  </Win95Button>
                )}
              </div>
            )}
          </Index>
          <Win95Button size="small" variant="toolbar" class="add-btn" onClick={addParticipant}>
            <span class="hk">A</span>dd person
          </Win95Button>
        </fieldset>
        <Win95Button fullWidth variant="cta" class="create-btn" onClick={create}>
          <span class="hk">C</span>reate Event
        </Win95Button>
      </div>

      <div class="how-section">
        <div class="how-title">How it works</div>
        <div class="how-steps r">
          <div class="how-step row row--start row--gap-md">
            <div class="how-num r">1</div>
            <div class="how-text">Create an event and share the link with everyone</div>
          </div>
          <div class="how-step row row--start row--gap-md">
            <div class="how-num r">2</div>
            <div class="how-text">
              Everyone opens the link, picks their name, and marks when they're free
            </div>
          </div>
          <div class="how-step row row--start row--gap-md">
            <div class="how-num r">3</div>
            <div class="how-text">
              See suggested times as people keep filling in their availability
            </div>
          </div>
          <div class="how-step row row--start row--gap-md">
            <div class="how-num r">4</div>
            <div class="how-text">
              Confirm a time — it's locked in and visible to everyone who opens the link
            </div>
          </div>
        </div>
      </div>

      <div class="recent-section">
        <div class="recent-panel r">
          <div class="recent-title">
            <span>Your recent events</span>
            <hr />
          </div>
          {recentEvents().length === 0 ? (
            <div class="empty-text recent-empty">No recent events</div>
          ) : (
            recentEvents().map((e) => (
              <a
                class="recent-item"
                href={`/e/${e.id}`}
                onClick={async (event) => {
                  event.preventDefault()
                  await pushRecentEvent(e)
                  props.onOpenEvent(e.id)
                }}
              >
                <span class="flag-ico">
                  <FlagIcon />
                </span>
                {e.name}
                <span class="recent-date">
                  |{' '}
                  {new Date(e.created).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                  })}
                </span>
              </a>
            ))
          )}
        </div>
      </div>

      <div class="footer">
        No accounts | No tracking | Local-first
        <br />
        <span class="footer-links">timesweeper.app</span>
      </div>

      <Show when={!!validationError()}>
        <ErrorDialog message={validationError()} onClose={() => setValidationError('')} />
      </Show>
    </div>
  )
}
