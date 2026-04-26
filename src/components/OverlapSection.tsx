import { createMemo, createSignal, Show } from 'solid-js'
import Win95Button from './Win95Button'
import OverlapTable from './OverlapTable'
import GridSection from './GridSection'
import {
  emptyParticipantSummaryGroups,
  formatParticipantDisplayName,
  getParticipantSlotValue,
  getOrderedParticipants,
  hasParticipantAvailability,
  type AppEvent,
  type DisplaySlot,
  type ParticipantSummaryGroups,
} from '../event-helpers'

type SummaryIntersectionTime = DisplaySlot
type SummarySplitRow = {
  key: string
  groups: ParticipantSummaryGroups
  yesCount: number
  maybeCount: number
  noCount: number
  kind: 'best' | 'almost' | 'partial'
  slots: SummaryIntersectionTime[]
  score: number
  canAttend: number
}

interface Props {
  event: AppEvent
  currentName: string
  displaySlots: DisplaySlot[]
}

const SPLIT_ROWS_PREVIEW_COUNT = 10

export default function OverlapSection(props: Props) {
  const [showAllSummaryRows, setShowAllSummaryRows] = createSignal(false)

  const summaryRows = createMemo<SummarySplitRow[]>(() => {
    if (props.displaySlots.length === 0) {
      return []
    }

    const orderedParticipants = getOrderedParticipants(props.event.participants, props.currentName)
    const rows = new Map<string, SummarySplitRow>()

    props.displaySlots.forEach((slot) => {
      const groups = emptyParticipantSummaryGroups()
      let key = ''

      orderedParticipants.forEach((participant) => {
        const value = getParticipantSlotValue(participant, slot.startUtcIso)
        const displayName = formatParticipantDisplayName(participant.name, props.currentName)

        key += String(value)

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
      const yesCount = groups.yes.length
      const maybeCount = groups.maybe.length
      const canAttend = yesCount + maybeCount

      if (canAttend === 0) {
        return
      }

      const existing = rows.get(key)

      if (!existing) {
        const noCount = groups.no.length

        rows.set(key, {
          key,
          groups,
          yesCount,
          maybeCount,
          noCount,
          kind: noCount === 0 ? 'best' : noCount === 1 ? 'almost' : 'partial',
          slots: [slot],
          score: yesCount + maybeCount * 0.5,
          canAttend,
        })

        return
      }

      existing.slots.push(slot)
    })

    const kindRank: Record<SummarySplitRow['kind'], number> = { best: 0, almost: 1, partial: 2 }

    return [...rows.values()].sort((a, b) => {
      if (kindRank[a.kind] !== kindRank[b.kind]) {
        return kindRank[a.kind] - kindRank[b.kind]
      }

      if (a.score !== b.score) {
        return b.score - a.score
      }

      if (a.canAttend !== b.canAttend) {
        return b.canAttend - a.canAttend
      }

      return b.slots.length - a.slots.length
    })
  })
  const visibleSummaryRows = createMemo(() => {
    const all = summaryRows()

    if (showAllSummaryRows()) {
      return all
    }

    return all.slice(0, SPLIT_ROWS_PREVIEW_COUNT)
  })
  const canShowSuggestions = createMemo(
    () => props.event.participants.filter(hasParticipantAvailability).length >= 2,
  )
  const suggestionsHelperText = createMemo(() => {
    const pending = props.event.participants
      .filter((participant) => participant.name !== props.currentName)
      .filter((participant) => !hasParticipantAvailability(participant))
      .map((participant) => participant.name)

    if (summaryRows().length === 0) {
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
    <GridSection number={3} title="Compare best overlaps">
      <p class="grid-view__suggestions-helper grid-view__panel-content--title-aligned">
        {suggestionsHelperText()}
      </p>
      <Show when={canShowSuggestions()} fallback={<></>}>
        <Show
          when={summaryRows().length > 0}
          fallback={
            <div class="empty-text grid-view__panel-content--title-aligned">
              No candidate times yet
            </div>
          }
        >
          <div class="summary-table-wrap grid-view__panel-content--title-aligned">
            <OverlapTable rows={visibleSummaryRows()} />
            <Show when={summaryRows().length > SPLIT_ROWS_PREVIEW_COUNT}>
              <div class="summary-list__meta-row">
                <div class="summary-list__toggle-row">
                  <Win95Button
                    size="small"
                    onClick={() => setShowAllSummaryRows(!showAllSummaryRows())}
                  >
                    <Show
                      when={showAllSummaryRows()}
                      fallback={`Show all ${summaryRows().length} overlaps`}
                    >
                      Show fewer overlaps
                    </Show>
                  </Win95Button>
                </div>
              </div>
            </Show>
          </div>
        </Show>
      </Show>
    </GridSection>
  )
}
