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
