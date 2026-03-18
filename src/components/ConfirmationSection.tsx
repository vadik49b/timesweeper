import { createMemo, createSignal, Show } from 'solid-js'
import Win95Button from './Win95Button'
import ConfirmationTable from './ConfirmationTable'
import {
  getParticipantSlotValue,
  hasParticipantAvailability,
  type AppEvent,
  type DisplaySlot,
  type SlotValue,
} from '../event-helpers'

type SummaryCell = { name: string; value: SlotValue; isCurrent: boolean }
export type SummaryGroups = { yes: string[]; maybe: string[]; no: string[] }
export type SummaryIntersectionTime = DisplaySlot
type SummaryIntersectionDate = {
  day: string
  dayKey: string
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

interface Props {
  event: AppEvent
  currentName: string
  displaySlots: DisplaySlot[]
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

  function peopleGroupsForSlot(slotIndex: number): SummaryGroups {
    const slot = props.displaySlots[slotIndex]

    if (!slot) {
      return emptySummaryGroups()
    }

    const participantNames = [
      ...props.event.participants.map((participant) => participant.name),
    ].sort((a, b) => {
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
      const participant = props.event.participants.find((entry) => entry.name === name)
      const value = getParticipantSlotValue(participant, slot.startUtcIso)
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

  function timesByDayEntries(slots: SummaryIntersectionTime[]) {
    const timesByDay = new Map<string, string[]>()

    slots.forEach((slot) => {
      const existing = timesByDay.get(slot.dayLabel)

      if (existing) {
        existing.push(slot.timeLabel)

        return
      }

      timesByDay.set(slot.dayLabel, [slot.timeLabel])
    })

    return [...timesByDay.entries()]
  }

  const summaryIntersections = createMemo<SummaryIntersection[]>(() => {
    if (props.displaySlots.length === 0) {
      return []
    }

    const participantNames = [
      ...props.event.participants.map((participant) => participant.name),
    ].sort((a, b) => {
      if (a === props.currentName) {
        return -1
      }

      if (b === props.currentName) {
        return 1
      }

      return 0
    })
    const dayOrder = new Map<string, number>()
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

    props.displaySlots.forEach((slot) => {
      if (!dayOrder.has(slot.dayKey)) {
        dayOrder.set(slot.dayKey, dayOrder.size)
      }

      const cells: SummaryCell[] = participantNames.map((name) => {
        const participant = props.event.participants.find((entry) => entry.name === name)
        const value = getParticipantSlotValue(participant, slot.startUtcIso)

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
          times: [slot],
        })

        return
      }

      existing.times.push(slot)
    })

    const entries: SummaryIntersection[] = [...intersections.values()].map((entry) => {
      const byDate = new Map<string, SummaryIntersectionDate>()

      entry.times.forEach((slot) => {
        const dateGroup = byDate.get(slot.dayKey)

        if (!dateGroup) {
          byDate.set(slot.dayKey, {
            day: slot.dayLabel,
            dayKey: slot.dayKey,
            times: [slot],
          })

          return
        }

        dateGroup.times.push(slot)
      })

      const dates = [...byDate.values()]
        .sort((a, b) => {
          const aOrder = dayOrder.get(a.dayKey) ?? Number.MAX_SAFE_INTEGER
          const bOrder = dayOrder.get(b.dayKey) ?? Number.MAX_SAFE_INTEGER

          return aOrder - bOrder
        })
        .map((dateGroup) => ({
          ...dateGroup,
          times: [...dateGroup.times].sort((a, b) => a.slotIndex - b.slotIndex),
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
    return summaryIntersections().map((intersection) => {
      const slots = intersection.dates.flatMap((dateGroup) => dateGroup.times)
      const first = slots[0]
      const groups = first ? peopleGroupsForSlot(first.slotIndex) : emptySummaryGroups()

      return {
        key: intersection.key,
        groups,
        yesCount: groups.yes.length,
        maybeCount: groups.maybe.length,
        noCount: groups.no.length,
        kind: intersection.kind,
        slots,
      }
    })
  })
  const visibleSummarySplitRows = createMemo(() => {
    const all = summarySplitRows()

    if (showAllSummaryRows()) {
      return all
    }

    return all.slice(0, SPLIT_ROWS_PREVIEW_COUNT)
  })
  const participantsWithAvailability = createMemo(() => {
    return props.event.participants.filter((participant) => hasParticipantAvailability(participant))
      .length
  })
  const canShowSuggestions = createMemo(() => participantsWithAvailability() >= 2)
  const suggestionsHelperText = createMemo(() => {
    const pending = props.event.participants
      .filter((participant) => participant.name !== props.currentName)
      .filter((participant) => !hasParticipantAvailability(participant))
      .map((participant) => participant.name)

    if (summarySplitRows().length === 0) {
      if (pending.length > 0) {
        return `Still waiting on availability from ${pending.join(', ')}. Suggestions will show up once participants start filling their availability.`
      }

      return 'Suggestions will show up once participants start filling their availability.'
    }

    if (pending.length === 0) {
      return 'Suggestions update as participants continue filling availability.'
    }

    return `Suggestions update as participants continue filling availability. ${pending.join(', ')} haven't marked availability yet.`
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
        <Show when={canShowSuggestions()} fallback={<></>}>
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
