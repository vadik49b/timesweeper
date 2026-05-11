import { createSignal, onCleanup, onMount, For, Show } from 'solid-js'
import ParticipantStatusList from './ParticipantStatusList'
import SummaryInline from './SummaryInline'
import type { DisplaySlot, ParticipantSummaryGroups } from '../event-helpers'

type SummarySplitRow = {
  key: string
  groups: ParticipantSummaryGroups
  yesCount: number
  maybeCount: number
  noCount: number
  kind: 'best' | 'almost' | 'partial'
  slots: DisplaySlot[]
}

type SummaryDayGroup = {
  dateLabel: string
  timeLabel: string
}

type SummaryDateGroup = {
  dateLabel: string
  intervals: SummaryDayGroup[]
}

interface Props {
  rows: SummarySplitRow[]
}

export default function OverlapTable(props: Props) {
  const [isDesktop, setIsDesktop] = createSignal(false)

  function getMeridiem(value: string): string | null {
    const match = value.match(/\s([AP]M)$/)

    return match ? match[1] : null
  }

  function formatTimeRange(start: DisplaySlot, end: DisplaySlot): string {
    if (start.dayKey === end.endDayKey) {
      const startMeridiem = getMeridiem(start.timeLabel)
      const endMeridiem = getMeridiem(end.endTimeLabel)

      if (startMeridiem && startMeridiem === endMeridiem) {
        return `${start.timeLabel.slice(0, -3)}–${end.endTimeLabel}`
      }

      return `${start.timeLabel}–${end.endTimeLabel}`
    }

    return `${start.timeLabel}–${end.endTimeLabel}`
  }

  function formatDateRange(start: DisplaySlot, end: DisplaySlot): string {
    if (start.dayKey === end.endDayKey) {
      return start.dayLabel
    }

    return `${start.dayLabel} – ${end.endDayLabel}`
  }

  function buildIntervals(slots: DisplaySlot[]): SummaryDayGroup[] {
    const { intervals, rangeStart, previous } = slots.reduce(
      (acc, slot) => {
        if (!acc.rangeStart || !acc.previous) {
          return {
            ...acc,
            rangeStart: slot,
            previous: slot,
          }
        }

        if (slot.slotIndex === acc.previous.slotIndex + 1) {
          return {
            ...acc,
            previous: slot,
          }
        }

        return {
          intervals: [
            ...acc.intervals,
            {
              dateLabel: formatDateRange(acc.rangeStart, acc.previous),
              timeLabel: formatTimeRange(acc.rangeStart, acc.previous),
            },
          ],
          rangeStart: slot,
          previous: slot,
        }
      },
      {
        intervals: [] as SummaryDayGroup[],
        rangeStart: null as DisplaySlot | null,
        previous: null as DisplaySlot | null,
      },
    )

    return rangeStart && previous
      ? [
          ...intervals,
          {
            dateLabel: formatDateRange(rangeStart, previous),
            timeLabel: formatTimeRange(rangeStart, previous),
          },
        ]
      : intervals
  }

  function groupIntervalsByDate(slots: DisplaySlot[]): SummaryDateGroup[] {
    return buildIntervals(slots).reduce<SummaryDateGroup[]>((dateGroups, interval) => {
      const currentDateGroup = dateGroups[dateGroups.length - 1]

      if (currentDateGroup?.dateLabel === interval.dateLabel) {
        return [
          ...dateGroups.slice(0, -1),
          {
            ...currentDateGroup,
            intervals: [...currentDateGroup.intervals, interval],
          },
        ]
      }

      return [
        ...dateGroups,
        {
          dateLabel: interval.dateLabel,
          intervals: [interval],
        },
      ]
    }, [])
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
                      <For each={groupIntervalsByDate(splitRow.slots)}>
                        {(dateGroup) => (
                          <For each={dateGroup.intervals}>
                            {(interval, intervalIndex) => (
                              <tr>
                                <Show when={intervalIndex() === 0}>
                                  <th
                                    scope="row"
                                    rowSpan={dateGroup.intervals.length}
                                    class="summary-slots-mobile-table__day-cell"
                                  >
                                    {dateGroup.dateLabel}
                                  </th>
                                </Show>
                                <td>
                                  <span class="summary-slots-mobile-table__time-text">
                                    {interval.timeLabel}
                                  </span>
                                </td>
                              </tr>
                            )}
                          </For>
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
                const dateGroups = groupIntervalsByDate(splitRow.slots)
                const totalRows = dateGroups.reduce(
                  (sum, dateGroup) => sum + dateGroup.intervals.length,
                  0,
                )

                return (
                  <For each={dateGroups}>
                    {(dateGroup, dateIndex) => (
                      <For each={dateGroup.intervals}>
                        {(interval, intervalIndex) => (
                          <tr>
                            <Show when={dateIndex() === 0 && intervalIndex() === 0}>
                              <td rowSpan={totalRows}>
                                <SummaryInline
                                  yesCount={splitRow.yesCount}
                                  maybeCount={splitRow.maybeCount}
                                  noCount={splitRow.noCount}
                                />
                                <ParticipantStatusList groups={splitRow.groups} />
                              </td>
                            </Show>
                            <Show when={intervalIndex() === 0}>
                              <td rowSpan={dateGroup.intervals.length}>
                                <span class="summary-slots-table__date">
                                  {dateGroup.dateLabel}
                                </span>
                              </td>
                            </Show>
                            <td>
                              <span class="summary-slots-table__time-text">
                                {interval.timeLabel}
                              </span>
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
