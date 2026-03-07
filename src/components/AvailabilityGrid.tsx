import { For, Show } from 'solid-js'

type Day = {
  key: string
  label: string
}

type Time = {
  label: string
  value: string
}

interface Props {
  days: Day[]
  times: Time[]
  myState: Record<string, number[]>
  isConfirmed: boolean
  onCycle: (dayKey: string, timeIndex: number) => void
}

function statusLabel(value: number | undefined): string {
  if (value === 1) {
    return 'yes'
  }

  if (value === 2) {
    return 'maybe'
  }

  return 'no'
}

export default function AvailabilityGrid(props: Props) {
  return (
    <div
      class="availability-grid"
      style={{
        '--days': String(Math.min(Math.max(props.days.length, 1), 7)),
        '--times': String(Math.max(props.times.length, 1)),
      }}
    >
      <div class="availability-grid__corner" />
      <For each={props.days}>
        {(day, dayIndex) => (
          <div class="availability-grid__day" style={{ '--di': String(dayIndex()) }}>
            {day.label}
          </div>
        )}
      </For>
      <For each={props.times}>
        {(time, timeIndex) => (
          <div class="availability-grid__time" style={{ '--ti': String(timeIndex()) }}>
            {time.label}
          </div>
        )}
      </For>
      <For each={props.times}>
        {(time, timeIndex) => (
          <For each={props.days}>
            {(day, dayIndex) => (
              <button
                type="button"
                classList={{
                  'availability-grid__cell': true,
                  'availability-grid__cell--yes': props.myState[day.key]?.[timeIndex()] === 1,
                  'availability-grid__cell--maybe': props.myState[day.key]?.[timeIndex()] === 2,
                  'availability-grid__cell--first-time': timeIndex() === 0,
                  'availability-grid__cell--first-day': dayIndex() === 0,
                }}
                style={{
                  '--ti': String(timeIndex()),
                  '--di': String(dayIndex()),
                }}
                aria-label={`${day.label} at ${time.label}. Current status: ${statusLabel(
                  props.myState[day.key]?.[timeIndex()],
                )}. Activate to cycle.`}
                disabled={props.isConfirmed}
                onClick={() => props.onCycle(day.key, timeIndex())}
              >
                <Show when={props.myState[day.key]?.[timeIndex()] === 1}>
                  <span class="availability-grid__icon">✔</span>
                </Show>
                <Show when={props.myState[day.key]?.[timeIndex()] === 2}>
                  <span class="availability-grid__icon">?</span>
                </Show>
              </button>
            )}
          </For>
        )}
      </For>
    </div>
  )
}
