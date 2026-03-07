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
  isDesktop: boolean
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
      classList={{
        'availability-grid': true,
        'availability-grid--horizontal': props.isDesktop,
      }}
      style={{
        '--days': String(Math.min(Math.max(props.days.length, 1), 7)),
        '--times': String(Math.max(props.times.length, 1)),
      }}
    >
      <Show
        when={props.isDesktop}
        fallback={
          <>
            <div class="availability-grid__corner" />
            <For each={props.days}>{(day) => <div class="availability-grid__day">{day.label}</div>}</For>
            <For each={props.times}>
              {(time, timeIndex) => (
                <>
                  <div class="availability-grid__time">{time.label}</div>
                  <For each={props.days}>
                    {(day, dayIndex) => (
                      <button
                        type="button"
                        classList={{
                          'availability-grid__cell': true,
                          'availability-grid__cell--yes': props.myState[day.key]?.[timeIndex()] === 1,
                          'availability-grid__cell--maybe': props.myState[day.key]?.[timeIndex()] === 2,
                          'availability-grid__cell--first-row': timeIndex() === 0,
                          'availability-grid__cell--first-col': dayIndex() === 0,
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
                </>
              )}
            </For>
          </>
        }
      >
        <div class="availability-grid__corner" />
        <For each={props.times}>
          {(time) => <div class="availability-grid__day availability-grid__day--time-head">{time.label}</div>}
        </For>
        <For each={props.days}>
          {(day, dayIndex) => (
            <>
              <div class="availability-grid__time availability-grid__time--day-head">{day.label}</div>
              <For each={props.times}>
                {(time, timeIndex) => (
                  <button
                    type="button"
                    classList={{
                      'availability-grid__cell': true,
                      'availability-grid__cell--yes': props.myState[day.key]?.[timeIndex()] === 1,
                      'availability-grid__cell--maybe': props.myState[day.key]?.[timeIndex()] === 2,
                      'availability-grid__cell--first-row': dayIndex() === 0,
                      'availability-grid__cell--first-col': timeIndex() === 0,
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
            </>
          )}
        </For>
      </Show>
    </div>
  )
}
