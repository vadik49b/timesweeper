import { createSignal, onCleanup, onMount, For, Show } from 'solid-js'
import Win95Button from './Win95Button'
import StatusMiniCell from './StatusMiniCell'
import type { SlotValue } from '../types'

type SummaryGroups = { yes: string[]; maybe: string[]; no: string[] }
type SummaryIntersectionTime = {
  day: string
  dk: string
  time: string
  ti: number
}
type SummarySplitRow = {
  key: string
  groups: SummaryGroups
  yesCount: number
  maybeCount: number
  noCount: number
  kind: 'best' | 'almost' | 'partial'
  slots: SummaryIntersectionTime[]
}

interface Props {
  rows: SummarySplitRow[]
  onReview: (row: SummarySplitRow) => void
  statusNameGroups: (groups: SummaryGroups) => Array<{ value: SlotValue; names: string[] }>
  timesByDayEntries: (slots: SummaryIntersectionTime[]) => Array<[string, string[]]>
}

export default function ConfirmationTable(props: Props) {
  const [isDesktop, setIsDesktop] = createSignal(false)

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
                  <div class="summary-slots-mobile-card__people-list">
                    <For each={props.statusNameGroups(splitRow.groups)}>
                      {(group) => (
                        <div class="summary-slots-mobile-card__people-row">
                          <StatusMiniCell value={group.value} class="summary-slots-mobile-card__icon" />
                          <span>{group.names.join(', ')}</span>
                        </div>
                      )}
                    </For>
                  </div>
                </div>
                <div class="summary-slots-mobile-card__section">
                  <div class="summary-slots-mobile-card__label">Times</div>
                  <For each={props.timesByDayEntries(splitRow.slots)}>
                    {(dayGroup) => (
                      <div class="summary-slots-table__times-row">
                        <span class="summary-slots-table__times-day">{dayGroup[0]}:</span>{' '}
                        <span class="summary-slots-table__times-list">{dayGroup[1].join(', ')}</span>
                      </div>
                    )}
                  </For>
                </div>
                <div class="summary-slots-mobile-card__footer">
                  <Win95Button
                    fullWidth
                    class="summary-slots-mobile-card__action"
                    onClick={() => props.onReview(splitRow)}
                  >
                    Review suggestion
                  </Win95Button>
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
              <th>People</th>
              <th class="summary-slots-table__num">Yes</th>
              <th class="summary-slots-table__num">Maybe</th>
              <th class="summary-slots-table__num">No</th>
              <th>Times</th>
              <th class="summary-slots-table__action-col">Action</th>
            </tr>
          </thead>
          <tbody>
            <For each={props.rows}>
              {(splitRow) => (
                <tr
                  classList={{
                    'summary-slots-table__row--best': splitRow.kind === 'best',
                    'summary-slots-table__row--almost': splitRow.kind === 'almost',
                    'summary-slots-table__row--partial': splitRow.kind === 'partial',
                  }}
                >
                  <td class="summary-slots-table__people-cell">
                    <div class="summary-slots-table__people-main">
                      <For each={props.statusNameGroups(splitRow.groups)}>
                        {(group) => (
                          <div class="summary-slots-table__people-row">
                            <StatusMiniCell value={group.value} class="status-mini-cell--aligned" />
                            <span>{group.names.join(', ')}</span>
                          </div>
                        )}
                      </For>
                    </div>
                  </td>
                  <td class="summary-slots-table__num">{splitRow.yesCount}</td>
                  <td class="summary-slots-table__num">{splitRow.maybeCount}</td>
                  <td class="summary-slots-table__num">{splitRow.noCount}</td>
                  <td class="summary-slots-table__times-cell">
                    <For each={props.timesByDayEntries(splitRow.slots)}>
                      {(dayGroup) => (
                        <div class="summary-slots-table__times-row">
                          <span class="summary-slots-table__times-day">{dayGroup[0]}:</span>{' '}
                          <span class="summary-slots-table__times-list">{dayGroup[1].join(', ')}</span>
                        </div>
                      )}
                    </For>
                  </td>
                  <td class="summary-slots-table__action-cell">
                    <Win95Button
                      size="small"
                      variant="toolbar"
                      onClick={() => props.onReview(splitRow)}
                    >
                      Review
                    </Win95Button>
                  </td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>
    </Show>
  )
}
