import { createMemo, createSignal, Show } from 'solid-js'
import Win95Button from './Win95Button'
import ConfirmationTable from './ConfirmationTable'
import type { AppEvent, SlotValue } from '../types'

type SummaryCell = { name: string; value: SlotValue; isCurrent: boolean }
export type SummaryGroups = { yes: string[]; maybe: string[]; no: string[] }
export type SummaryIntersectionTime = {
  day: string
  dk: string
  time: string
  ti: number
}
type SummaryIntersectionDate = {
  day: string
  dk: string
  times: SummaryIntersectionTime[]
}
type SummaryIntersection = {
  key: string
  allGroups: SummaryGroups
  score: number
  canAttend: number
  kind: 'best' | 'almost' | 'partial'
  dates: SummaryIntersectionDate[]
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

type Day = {
  key: string
  label: string
}

type Time = {
  label: string
  value: string
}

interface Props {
  event: AppEvent | null
  days: Day[]
  times: Time[]
  currentName: string
  myState: Record<string, number[]>
  others: Record<string, Record<string, number[]>>
  onReviewCandidates: (candidates: SummaryIntersectionTime[]) => void
}

const SPLIT_ROWS_PREVIEW_COUNT = 10

function emptySummaryGroups(): SummaryGroups {
  return {
    yes: [],
    maybe: [],
    no: [],
  }
}

export default function ConfirmationSection(props: Props) {
  const [showAllSummaryRows, setShowAllSummaryRows] = createSignal(false)

  function peopleGroupsForSlot(dayKey: string, timeIndex: number): SummaryGroups {
    const ev = props.event

    if (!ev) {
      return emptySummaryGroups()
    }

    const participantNames = [...ev.participants.map((p) => p.name)].sort((a, b) => {
      if (a === props.currentName) {
        return -1
      }

      if (b === props.currentName) {
        return 1
      }

      return a.localeCompare(b)
    })

    const groups = emptySummaryGroups()

    participantNames.forEach((name) => {
      const value =
        name === props.currentName
          ? ((props.myState[dayKey]?.[timeIndex] ?? 0) as SlotValue)
          : ((props.others[name]?.[dayKey]?.[timeIndex] ?? 0) as SlotValue)
      const displayName = name === props.currentName ? 'You' : name

      if (value === 1) {
        groups.yes.push(displayName)

        return
      }

      if (value === 2) {
        groups.maybe.push(displayName)

        return
      }

      groups.no.push(displayName)
    })

    return groups
  }

  function statusNameGroups(groups: SummaryGroups) {
    return [
      { value: 1 as SlotValue, names: groups.yes },
      { value: 2 as SlotValue, names: groups.maybe },
      { value: 0 as SlotValue, names: groups.no },
    ].filter((group) => group.names.length > 0)
  }

  function timesByDayEntries(slots: SummaryIntersectionTime[]) {
    const timesByDay = new Map<string, string[]>()

    slots.forEach((slot) => {
      const existing = timesByDay.get(slot.day)

      if (existing) {
        existing.push(slot.time)

        return
      }

      timesByDay.set(slot.day, [slot.time])
    })

    return [...timesByDay.entries()]
  }

  const summaryIntersections = createMemo<SummaryIntersection[]>(() => {
    const ev = props.event
    const d = props.days
    const t = props.times

    if (!ev || d.length === 0 || t.length === 0) {
      return []
    }

    const participantNames = [...ev.participants.map((p) => p.name)].sort((a, b) => {
      if (a === props.currentName) {
        return -1
      }

      if (b === props.currentName) {
        return 1
      }

      return 0
    })

    const dayOrder = new Map(ev.dates.map((dayKey, index) => [dayKey, index]))
    const intersections = new Map<
      string,
      {
        key: string
        allGroups: SummaryGroups
        score: number
        canAttend: number
        kind: 'best' | 'almost' | 'partial'
        times: SummaryIntersectionTime[]
      }
    >()

    d.forEach((day) => {
      t.forEach((slot, ti) => {
        const cells: SummaryCell[] = participantNames.map((name) => {
          const value =
            name === props.currentName
              ? ((props.myState[day.key]?.[ti] ?? 0) as SlotValue)
              : ((props.others[name]?.[day.key]?.[ti] ?? 0) as SlotValue)

          return {
            name,
            value,
            isCurrent: name === props.currentName,
          }
        })
        const yesCount = cells.filter((cell) => cell.value === 1).length
        const maybeCount = cells.filter((cell) => cell.value === 2).length
        const canAttend = yesCount + maybeCount

        if (canAttend === 0) {
          return
        }

        const score = yesCount + maybeCount * 0.5
        const noCount = cells.length - canAttend
        const kind = noCount === 0 ? 'best' : noCount === 1 ? 'almost' : 'partial'
        const key = cells.map((cell) => String(cell.value)).join('')
        const allGroups: SummaryGroups = {
          yes: cells
            .filter((cell) => cell.value === 1)
            .map((cell) => (cell.isCurrent ? 'You' : cell.name)),
          maybe: cells
            .filter((cell) => cell.value === 2)
            .map((cell) => (cell.isCurrent ? 'You' : cell.name)),
          no: cells
            .filter((cell) => cell.value === 0)
            .map((cell) => (cell.isCurrent ? 'You' : cell.name)),
        }

        const existing = intersections.get(key)

        if (!existing) {
          intersections.set(key, {
            key,
            allGroups,
            score,
            canAttend,
            kind,
            times: [{ dk: day.key, ti, day: day.label, time: slot.label }],
          })

          return
        }

        existing.times.push({ dk: day.key, ti, day: day.label, time: slot.label })
      })
    })

    const entries: SummaryIntersection[] = [...intersections.values()].map((entry) => {
      const byDate = new Map<string, SummaryIntersectionDate>()
      entry.times.forEach((timeEntry) => {
        const dateGroup = byDate.get(timeEntry.dk)

        if (!dateGroup) {
          byDate.set(timeEntry.dk, {
            day: timeEntry.day,
            dk: timeEntry.dk,
            times: [timeEntry],
          })

          return
        }

        dateGroup.times.push(timeEntry)
      })

      const dates = [...byDate.values()]
        .sort((a, b) => {
          const aOrder = dayOrder.get(a.dk) ?? Number.MAX_SAFE_INTEGER
          const bOrder = dayOrder.get(b.dk) ?? Number.MAX_SAFE_INTEGER

          return aOrder - bOrder
        })
        .map((dateGroup) => ({
          ...dateGroup,
          times: [...dateGroup.times].sort((a, b) => a.ti - b.ti),
        }))

      return {
        key: entry.key,
        allGroups: entry.allGroups,
        score: entry.score,
        canAttend: entry.canAttend,
        kind: entry.kind,
        dates,
      }
    })

    const kindRank: Record<SummaryIntersection['kind'], number> = { best: 0, almost: 1, partial: 2 }

    entries.sort((a, b) => {
      if (kindRank[a.kind] !== kindRank[b.kind]) {
        return kindRank[a.kind] - kindRank[b.kind]
      }

      if (a.score !== b.score) {
        return b.score - a.score
      }

      if (a.canAttend !== b.canAttend) {
        return b.canAttend - a.canAttend
      }

      return (
        b.dates.reduce((sum, day) => sum + day.times.length, 0) -
        a.dates.reduce((sum, day) => sum + day.times.length, 0)
      )
    })

    return entries
  })
  const summarySplitRows = createMemo<SummarySplitRow[]>(() => {
    const intersections = summaryIntersections()
    const rows: SummarySplitRow[] = []

    intersections.forEach((intersection) => {
      const slots: SummaryIntersectionTime[] = []

      intersection.dates.forEach((dateGroup) => {
        dateGroup.times.forEach((timeEntry) => {
          slots.push(timeEntry)
        })
      })
      const first = slots[0]
      const groups = first ? peopleGroupsForSlot(first.dk, first.ti) : emptySummaryGroups()
      const yesCount = groups.yes.length
      const maybeCount = groups.maybe.length
      const noCount = groups.no.length

      rows.push({
        key: intersection.key,
        groups,
        yesCount,
        maybeCount,
        noCount,
        kind: intersection.kind,
        slots,
      })
    })

    return rows
  })
  const visibleSummarySplitRows = createMemo(() => {
    const all = summarySplitRows()

    if (showAllSummaryRows()) {
      return all
    }

    return all.slice(0, SPLIT_ROWS_PREVIEW_COUNT)
  })
  const participantsWithAvailability = createMemo(() => {
    const ev = props.event

    if (!ev) {
      return 0
    }

    return ev.participants.filter((participant) => {
      if (participant.name === props.currentName) {
        return Object.values(props.myState).some((daySlots) => daySlots.some((v) => v > 0))
      }

      return participant.slots.some((v) => v > 0)
    }).length
  })
  const canShowSuggestions = createMemo(() => participantsWithAvailability() >= 2)
  const suggestionsHelperText = createMemo(() => {
    const ev = props.event
    const base = 'Suggestions update as people continue filling availability.'

    if (!ev) {
      return base
    }

    const pending = ev.participants
      .filter((participant) => {
        if (participant.name === props.currentName) {
          return false
        }

        const hasUpdated = participant.updatedAt !== null
        const hasAnyAvailability = participant.slots.some((value) => value > 0)

        return !hasUpdated && !hasAnyAvailability
      })
      .map((participant) => participant.name)

    if (pending.length === 0) {
      return `${base} Everyone has seen the link you shared.`
    }

    return `${base} ${pending.join(', ')} haven't opened the link yet.`
  })

  return (
    <section class="grid-view__section">
      <div class="grid-view__section-header">
        <span class="grid-view__section-number">3.</span>
        <span>Confirm time</span>
        <hr />
      </div>
      <div class="grid-view__section-body">
        <p class="grid-view__suggestions-helper grid-view__panel-content--title-aligned">
          {suggestionsHelperText()}
        </p>
        <Show
          when={canShowSuggestions()}
          fallback={
            <div class="empty-text grid-view__panel-content--title-aligned">
              Not enough people yet to suggest times.
            </div>
          }
        >
          <Show
            when={summarySplitRows().length > 0}
            fallback={
              <div class="empty-text grid-view__panel-content--title-aligned">
                No candidate times yet
              </div>
            }
          >
            <div class="summary-table-wrap grid-view__panel-content--title-aligned">
              <ConfirmationTable
                rows={visibleSummarySplitRows()}
                onReview={(row) => props.onReviewCandidates(row.slots)}
                statusNameGroups={statusNameGroups}
                timesByDayEntries={timesByDayEntries}
              />
              <Show when={summarySplitRows().length > SPLIT_ROWS_PREVIEW_COUNT}>
                <div class="summary-list__meta-row">
                  <div class="summary-list__toggle-row">
                    <Win95Button
                      size="small"
                      onClick={() => setShowAllSummaryRows(!showAllSummaryRows())}
                    >
                      <Show
                        when={showAllSummaryRows()}
                        fallback={`Show all ${summarySplitRows().length} groups`}
                      >
                        Show fewer groups
                      </Show>
                    </Win95Button>
                  </div>
                </div>
              </Show>
            </div>
          </Show>
        </Show>
      </div>
    </section>
  )
}
