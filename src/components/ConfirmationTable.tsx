import { createSignal, onCleanup, onMount, For, Show } from 'solid-js'
import Win95Button from './Win95Button'
import ParticipantStatusList from './ParticipantStatusList'
import type { ParticipantSummaryGroups } from '../event-helpers'
import type { SummaryIntersectionTime } from './ConfirmationSection'

type SummarySplitRow = {
  key: string
  groups: ParticipantSummaryGroups
  yesCount: number
  maybeCount: number
  noCount: number
  kind: 'best' | 'almost' | 'partial'
  slots: SummaryIntersectionTime[]
}

type SummaryDayGroup = {
  dayLabel: string
  slots: SummaryIntersectionTime[]
}

interface Props {
  rows: SummarySplitRow[]
  onConfirm: (slot: SummaryIntersectionTime) => void
}

export default function ConfirmationTable(props: Props) {
  const [isDesktop, setIsDesktop] = createSignal(false)

  function slotsByDay(slots: SummaryIntersectionTime[]): SummaryDayGroup[] {
    const dayGroups: SummaryDayGroup[] = []

    slots.forEach((slot) => {
      const currentDay = dayGroups[dayGroups.length - 1]

      if (currentDay?.dayLabel === slot.dayLabel) {
        currentDay.slots.push(slot)

        return
      }

      dayGroups.push({
        dayLabel: slot.dayLabel,
        slots: [slot],
      })
    })

    return dayGroups
  }

  onMount(() => {
    const desktopQuery = window.matchMedia('(min-width: 700px)')
    const onDesktopChange = () => {
      setIsDesktop(desktopQuery.matches)
    }

    onDesktopChange()
    desktopQuery.addEventListener('change', onDesktopChange)

    onCleanup(() => {
      desktopQuery.removeEventListener('change', onDesktopChange)
    })
  })

  return (
    <Show
      when={isDesktop()}
      fallback={
        <div class="summary-slots-mobile-list">
          <For each={props.rows}>
            {(splitRow, index) => (
              <div class="summary-slots-mobile-card">
                <div class="summary-slots-mobile-card__section">
                  <div class="summary-slots-mobile-card__label">
                    Option {index() + 1}: {splitRow.yesCount} yes, {splitRow.maybeCount} maybe,{' '}
                    {splitRow.noCount} no
                  </div>
                  <ParticipantStatusList groups={splitRow.groups} />
                </div>
                <div class="summary-slots-mobile-card__section">
                  <table class="summary-slots-mobile-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      <For each={slotsByDay(splitRow.slots)}>
                        {(dayGroup) => (
                          <tr>
                            <th scope="row" class="summary-slots-mobile-table__day-cell">
                              {dayGroup.dayLabel}
                            </th>
                            <td class="summary-slots-mobile-table__times-cell">
                              <div class="summary-slots-mobile-table__time-list">
                                <For each={dayGroup.slots}>
                                  {(slot) => (
                                    <Win95Button
                                      size="small"
                                      class="summary-slots-mobile-table__time-button"
                                      onClick={() => props.onConfirm(slot)}
                                    >
                                      {slot.timeLabel}
                                    </Win95Button>
                                  )}
                                </For>
                              </div>
                            </td>
                          </tr>
                        )}
                      </For>
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </For>
        </div>
      }
    >
      <div class="summary-slots-wrap">
        <table class="summary-slots-table">
          <thead>
            <tr>
              <th>Participants</th>
              <th class="summary-slots-table__num">Yes</th>
              <th class="summary-slots-table__num">Maybe</th>
              <th class="summary-slots-table__num">No</th>
              <th>Date</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            <For each={props.rows}>
              {(splitRow) => {
                const dayGroups = slotsByDay(splitRow.slots)
                const totalRows = splitRow.slots.length

                return (
                  <For each={dayGroups}>
                    {(dayGroup, dayIndex) => (
                      <For each={dayGroup.slots}>
                        {(slot, slotIndex) => (
                          <tr
                            classList={{
                              'summary-slots-table__row--best': splitRow.kind === 'best',
                              'summary-slots-table__row--almost': splitRow.kind === 'almost',
                              'summary-slots-table__row--partial': splitRow.kind === 'partial',
                            }}
                          >
                            <Show when={dayIndex() === 0 && slotIndex() === 0}>
                              <td class="summary-slots-table__people-cell" rowSpan={totalRows}>
                                <ParticipantStatusList groups={splitRow.groups} />
                              </td>
                              <td class="summary-slots-table__num" rowSpan={totalRows}>
                                {splitRow.yesCount}
                              </td>
                              <td class="summary-slots-table__num" rowSpan={totalRows}>
                                {splitRow.maybeCount}
                              </td>
                              <td class="summary-slots-table__num" rowSpan={totalRows}>
                                {splitRow.noCount}
                              </td>
                            </Show>
                            <Show when={slotIndex() === 0}>
                              <td
                                class="summary-slots-table__date-cell"
                                rowSpan={dayGroup.slots.length}
                              >
                                <span class="summary-slots-table__date">{dayGroup.dayLabel}</span>
                              </td>
                            </Show>
                            <td class="summary-slots-table__time-cell">
                              <Win95Button
                                size="small"
                                variant="toolbar"
                                class="summary-slots-table__time-button"
                                onClick={() => props.onConfirm(slot)}
                              >
                                {slot.timeLabel}
                              </Win95Button>
                            </td>
                          </tr>
                        )}
                      </For>
                    )}
                  </For>
                )
              }}
            </For>
          </tbody>
        </table>
      </div>
    </Show>
  )
}
