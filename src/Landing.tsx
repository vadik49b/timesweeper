import { createSignal, createMemo, onMount, For, Show } from 'solid-js'
import type { JSX } from 'solid-js'
import {
  addMinutes,
  getDaysInMonth,
  intlFormat,
  isSameDay,
  lightFormat,
  parseISO,
  startOfToday,
} from 'date-fns'
import { nanoid } from 'nanoid'
import {
  buildSlotStartsUtcIso,
  parseTimeStringToMinutes,
  SLOT_DURATION,
  type AppEvent,
} from './event-helpers'
import {
  createEvent,
  listRecentEvents,
  pushRecentEvent,
  setSelectedParticipantName,
  type RecentEventSummary,
} from './db'
import Win95Field from './components/Win95Field'
import Win95Button from './components/Win95Button'
import ErrorDialog from './components/ErrorDialog'
import AppIcon from './icons/AppIcon'
import FlagIcon from './icons/FlagIcon'

const DOWS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']
const TIMES = (() => {
  const out: { label: string; value: string }[] = []
  let current = new Date(2000, 0, 1, 0, 0, 0, 0)
  const end = new Date(2000, 0, 2, 0, 0, 0, 0)

  while (current < end) {
    out.push({
      label: intlFormat(current, {
        hour: 'numeric',
        minute: '2-digit',
      }),
      value: lightFormat(current, 'HH:mm'),
    })
    current = addMinutes(current, SLOT_DURATION)
  }

  return out
})()

interface Props {
  onOpenEvent: (id: string) => void
}

export default function Landing(props: Props) {
  const today = startOfToday()

  const [calYear, setCalYear] = createSignal(today.getFullYear())
  const [calMonth, setCalMonth] = createSignal(today.getMonth())
  const [selectedDates, setSelectedDates] = createSignal<Record<string, boolean>>({})
  const [recentEvents, setRecentEvents] = createSignal<RecentEventSummary[]>([])
  const [validationError, setValidationError] = createSignal('')
  const localTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone

  onMount(() => {
    setRecentEvents(listRecentEvents().slice(0, 5))
  })

  const calDays = createMemo(() => {
    const year = calYear(),
      month = calMonth()
    const first = new Date(year, month, 1)
    let startDow = first.getDay() - 1

    if (startDow < 0) {
      startDow = 6
    }

    const daysInMonth = getDaysInMonth(first)
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
      const ds = lightFormat(date, 'yyyy-MM-dd')
      days.push({
        day: d,
        ds,
        isPast: date < today,
        isToday: isSameDay(date, today),
        isSelected: !!selectedDates()[ds],
      })
    }

    return days
  })
  const selectedDateKeys = createMemo(() => Object.keys(selectedDates()).sort())

  const selectedDateLabels = createMemo(() => {
    const keys = selectedDateKeys()

    if (keys.length === 0) {
      return 'No dates selected'
    }

    const labels = keys.map((ds) =>
      intlFormat(parseISO(ds), {
        weekday: 'short',
        day: 'numeric',
      }),
    )

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
      if (selectedDateKeys().length >= 7) {
        return
      }

      setSelectedDates({ ...cur, [ds]: true })
    }
  }

  async function create(submitEvent: SubmitEvent & { currentTarget: HTMLFormElement }) {
    submitEvent.preventDefault()

    const formData = new FormData(submitEvent.currentTarget)
    const title = String(formData.get('eventName') ?? '').trim()
    const organizer = String(formData.get('organizerName') ?? '').trim()
    const timeStart = String(formData.get('timeStart') ?? '')
    const timeEnd = String(formData.get('timeEnd') ?? '')

    if (!title) {
      setValidationError('Please enter a title.')

      return
    }
    const dates = selectedDateKeys()

    if (dates.length === 0) {
      setValidationError('Please pick at least one date.')

      return
    }

    const defaultWindowStartMin = parseTimeStringToMinutes(timeStart)
    const defaultWindowEndMin = parseTimeStringToMinutes(timeEnd)

    if (
      defaultWindowStartMin === null ||
      defaultWindowEndMin === null ||
      defaultWindowStartMin >= defaultWindowEndMin
    ) {
      setValidationError('Please choose a valid time range (start must be before end).')

      return
    }

    if (!organizer) {
      setValidationError('Enter your name')

      return
    }
    setValidationError('')
    const slotStartsUtcIso = buildSlotStartsUtcIso({
      dates,
      slotMinutes: SLOT_DURATION,
      windowStartMin: defaultWindowStartMin,
      windowEndMin: defaultWindowEndMin,
      timezone: localTimezone,
    })

    if (slotStartsUtcIso.length === 0) {
      setValidationError('Please choose a valid time range.')

      return
    }

    const createdEvent: AppEvent = {
      id: nanoid(),
      name: title,
      created: Date.now(),
      slotStartsUtcIso,
      participants: [
        {
          name: organizer,
          slots: {},
        },
      ],
    }
    await createEvent(createdEvent)
    setSelectedParticipantName(createdEvent.id, organizer)
    pushRecentEvent({ id: createdEvent.id, name: createdEvent.name, created: createdEvent.created })
    props.onOpenEvent(createdEvent.id)
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

      <form class="form-card r" onSubmit={create as JSX.EventHandler<HTMLFormElement, SubmitEvent>}>
        <div class="field">
          <label for="event-name">Title:</label>
          <Win95Field
            kind="input"
            id="event-name"
            name="eventName"
            placeholder="e.g. Game Night, Intro Call"
            autoFocus
            wrapperClass="landing__event-name"
            controlClass="landing__text-input-control"
          />
        </div>

        <fieldset class="field landing__group">
          <legend>Which dates might work?</legend>
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
                {intlFormat(new Date(calYear(), calMonth(), 1), {
                  month: 'long',
                  year: 'numeric',
                })}
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
                        ? intlFormat(parseISO(day.ds), {
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
              value="10:00"
              options={TIMES}
              wrapperClass="landing__time-select"
            />
            <span>to</span>
            <Win95Field
              kind="select"
              id="time-end"
              name="timeEnd"
              size="small"
              value="18:00"
              options={TIMES}
              wrapperClass="landing__time-select"
            />
          </div>
        </div>

        <div class="field">
          <label for="organizer-name">Your name:</label>
          <Win95Field
            kind="input"
            id="organizer-name"
            name="organizerName"
            wrapperClass="landing__event-name"
            controlClass="landing__text-input-control"
          />
        </div>
        <Win95Button fullWidth variant="cta" class="create-btn" type="submit">
          <span class="hk">C</span>reate scheduling link
        </Win95Button>
      </form>

      <div class="landing-section">
        <div class="how-title">How it works</div>
        <div class="how-steps r">
          <div class="how-step row row--start row--gap-md">
            <div class="how-num r">1</div>
            <div class="how-text">Create a scheduling link and share it with everyone</div>
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
              As people respond, the app shows the times that work best
            </div>
          </div>
          <div class="how-step row row--start row--gap-md">
            <div class="how-num r">4</div>
            <div class="how-text">Review the best overlaps the app suggests</div>
          </div>
        </div>
      </div>

      <div class="landing-section">
        <div class="section-title">Your recent links</div>
        <div class="recent-panel r">
          {recentEvents().length === 0 ? (
            <div class="empty-text recent-empty">No recent links</div>
          ) : (
            recentEvents().map((e) => (
              <a
                class="recent-item"
                href={`/e/${e.id}`}
                onClick={(event) => {
                  event.preventDefault()
                  pushRecentEvent(e)
                  props.onOpenEvent(e.id)
                }}
              >
                <span class="flag-ico">
                  <FlagIcon />
                </span>
                {e.name}
                <span class="recent-date">
                  | {intlFormat(new Date(e.created), { month: 'short', day: 'numeric' })}
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
