import { createSignal, onCleanup, onMount, For, Show } from 'solid-js'
import ParticipantStatusList from './ParticipantStatusList'
import SummaryInline from './SummaryInline'
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
}

export default function ConfirmationTable(props: Props) {
  const [isDesktop, setIsDesktop] = createSignal(false)

  function formatSlotTime(slot: SummaryIntersectionTime): string {
    return new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(slot.startUtcIso))
  }

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
            {(splitRow) => (
              <div class="summary-slots-mobile-card">
                <div class="summary-slots-mobile-card__section">
                  <SummaryInline
                    yesCount={splitRow.yesCount}
                    maybeCount={splitRow.maybeCount}
                    noCount={splitRow.noCount}
                  />
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
                                  {(slot, slotIndex) => (
                                    <span class="summary-slots-mobile-table__time-text">
                                      <Show when={slotIndex() > 0}>
                                        <span>, </span>
                                      </Show>
                                      <span>{formatSlotTime(slot)}</span>
                                    </span>
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
              <th>Date</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            <For each={props.rows}>
              {(splitRow) => {
                const dayGroups = slotsByDay(splitRow.slots)
                const totalRows = dayGroups.length

                return (
                  <For each={dayGroups}>
                    {(dayGroup, dayIndex) => (
                      <tr
                        classList={{
                          'summary-slots-table__row--best': splitRow.kind === 'best',
                          'summary-slots-table__row--almost': splitRow.kind === 'almost',
                          'summary-slots-table__row--partial': splitRow.kind === 'partial',
                        }}
                      >
                        <Show when={dayIndex() === 0}>
                          <td class="summary-slots-table__people-cell" rowSpan={totalRows}>
                            <SummaryInline
                              yesCount={splitRow.yesCount}
                              maybeCount={splitRow.maybeCount}
                              noCount={splitRow.noCount}
                            />
                            <ParticipantStatusList groups={splitRow.groups} />
                          </td>
                        </Show>
                        <td class="summary-slots-table__date-cell">
                          <span class="summary-slots-table__date">{dayGroup.dayLabel}</span>
                        </td>
                        <td class="summary-slots-table__time-cell">
                          <span class="summary-slots-table__time-text">
                            <For each={dayGroup.slots}>
                              {(slot, slotIndex) => (
                                <>
                                  <Show when={slotIndex() > 0}>
                                    <span>, </span>
                                  </Show>
                                  <span>{formatSlotTime(slot)}</span>
                                </>
                              )}
                            </For>
                          </span>
                        </td>
                      </tr>
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
