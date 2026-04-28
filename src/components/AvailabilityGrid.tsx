import { For, Show } from 'solid-js'
import type { DisplayDay, DisplaySlot, DisplayTime, SlotMap } from '../event-helpers'

interface Props {
  days: DisplayDay[]
  times: DisplayTime[]
  slotByDayTime: Record<string, DisplaySlot | undefined>
  selectedSlots: SlotMap
  onCycle: (slotIndex: number) => void
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

function nextStatusLabel(value: number | undefined): string {
  if (value === 1) {
    return 'maybe'
  }

  if (value === 2) {
    return 'no'
  }

  return 'yes'
}

export default function AvailabilityGrid(props: Props) {
  const gridTemplateRows = () =>
    [
      'var(--day-header-height)',
      ...props.times.map((time) =>
        time.gapBefore ? 'calc(var(--size-cell) + var(--space-050) + var(--space-050))' : 'var(--size-cell)',
      ),
    ].join(' ')

  return (
    <div
      class="availability-grid"
      style={{
        '--days': String(Math.max(props.days.length, 1)),
        '--times': String(Math.max(props.times.length, 1)),
        'grid-template-rows': gridTemplateRows(),
      }}
    >
      <div class="availability-grid__corner" />
      <For each={props.days}>
        {(day, dayIndex) => (
          <div class="availability-grid__day" style={{ '--di': String(dayIndex()) }}>
            <span class="availability-grid__day-weekday">{day.weekdayLabel}</span>
            <span class="availability-grid__day-date">
              <Show when={day.showMonthLabel}>
                <span class="availability-grid__day-month">{day.monthLabel}</span>
              </Show>
              <span class="availability-grid__day-number">{day.dayNumberLabel}</span>
            </span>
          </div>
        )}
      </For>
      <For each={props.times}>
        {(time, timeIndex) => (
          <div
            classList={{
              'availability-grid__time': true,
              'availability-grid__time--after-gap': time.gapBefore,
            }}
            style={{ '--ti': String(timeIndex()) }}
          >
            {time.label}
          </div>
        )}
      </For>
      <For each={props.times}>
        {(time, timeIndex) => (
          <Show when={time.gapBefore}>
            <div
              class="availability-grid__gap-time"
              style={{ '--ti': String(timeIndex()) }}
              aria-hidden="true"
            >
              ...
            </div>
          </Show>
        )}
      </For>
      <For each={props.times}>
        {(time, timeIndex) => (
          <For each={props.days}>
            {(day, dayIndex) => {
              const slot = () => props.slotByDayTime[`${day.key}|${time.key}`]
              const slotIndex = () => slot()?.slotIndex
              const slotValue = () => {
                const nextSlot = slot()

                return nextSlot === undefined
                  ? undefined
                  : props.selectedSlots[nextSlot.startUtcIso]
              }
              const hasSlot = () => slotIndex() !== undefined
              const cellLabel = () =>
                hasSlot()
                  ? `${day.label} at ${time.label}. Your availability is ${statusLabel(
                      slotValue(),
                    )}. Click to mark ${nextStatusLabel(slotValue())}.`
                  : `${day.label} at ${time.label}. No availability slot here.`
              const cellTitle = () =>
                hasSlot()
                  ? `${day.label}, ${time.label}: mark ${nextStatusLabel(slotValue())}`
                  : `${day.label}, ${time.label}: no slot`

              return (
                <button
                  type="button"
                  classList={{
                    'availability-grid__cell': true,
                    'availability-grid__cell--yes': slotValue() === 1,
                    'availability-grid__cell--maybe': slotValue() === 2,
                    'availability-grid__cell--first-time': timeIndex() === 0,
                    'availability-grid__cell--first-day': dayIndex() === 0,
                    'availability-grid__cell--after-gap': time.gapBefore,
                    'availability-grid__cell--empty': !hasSlot(),
                  }}
                  style={{
                    '--ti': String(timeIndex()),
                    '--di': String(dayIndex()),
                  }}
                  aria-label={cellLabel()}
                  title={cellTitle()}
                  disabled={!hasSlot()}
                  onClick={() => {
                    const nextSlotIndex = slotIndex()

                    if (nextSlotIndex === undefined) {
                      return
                    }

                    props.onCycle(nextSlotIndex)
                  }}
                >
                  <Show when={slotValue() === 1}>
                    <span class="availability-grid__icon">✔</span>
                  </Show>
                  <Show when={slotValue() === 2}>
                    <span class="availability-grid__icon">?</span>
                  </Show>
                </button>
              )
            }}
          </For>
        )}
      </For>
    </div>
  )
}
