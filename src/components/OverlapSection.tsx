import { createMemo, createSignal, Show } from 'solid-js'
import Win95Button from './Win95Button'
import OverlapTable from './OverlapTable'
import GridSection from './GridSection'
import {
  formatParticipantDisplayName,
  getParticipantSlotValue,
  hasParticipantAvailability,
  type AppEvent,
  type DisplaySlot,
  type Participant,
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
  currentParticipant: Participant | null
  displaySlots: DisplaySlot[]
}

const SPLIT_ROWS_PREVIEW_COUNT = 10

export default function OverlapSection(props: Props) {
  const [showAllSummaryRows, setShowAllSummaryRows] = createSignal(false)

  const summaryRows = createMemo<SummarySplitRow[]>(() => {
    if (props.displaySlots.length === 0) {
      return []
    }

    const otherParticipants = props.event.participants.filter((participant) => {
      return participant.name !== props.currentName
    })

    const participants = props.currentParticipant && hasParticipantAvailability(props.currentParticipant)
      ? [props.currentParticipant, ...otherParticipants]
      : otherParticipants

    const rows = props.displaySlots.reduce((acc, slot) => {
      const { groups, key } = participants.reduce(
        (slotAcc, participant) => {
          const { groups } = slotAcc
          const value = getParticipantSlotValue(participant, slot.startUtcIso)
          const displayName = formatParticipantDisplayName(participant.name, props.currentName)

          slotAcc.key += String(value)

          if (value === 1) {
            groups.yes.push(displayName)

            return slotAcc
          }

          if (value === 2) {
            groups.maybe.push(displayName)

            return slotAcc
          }

          groups.no.push(displayName)
          return slotAcc
        },
        {
          groups: {
            yes: [],
            maybe: [],
            no: [],
          } as ParticipantSummaryGroups,
          key: '',
        },
      )
      const yesCount = groups.yes.length
      const maybeCount = groups.maybe.length
      const canAttend = yesCount + maybeCount

      if (canAttend === 0) {
        return acc
      }

      const existing = acc.get(key)

      if (!existing) {
        const noCount = groups.no.length

        acc.set(key, {
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

        return acc
      }

      existing.slots.push(slot)
      return acc
    }, new Map<string, SummarySplitRow>())

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

  const hasSummaryRows = createMemo(() => summaryRows().length > 0)

  const suggestionsHelperText = createMemo(() => {
    const marked = props.event.participants.filter((participant) =>
      hasParticipantAvailability(participant),
    )

    if (marked.length === 0) {
      return 'No availability responses yet. This table will fill in as people respond.'
    }

    const pending = props.event.participants
      .filter((participant) => participant.name !== props.currentName)
      .filter((participant) => !hasParticipantAvailability(participant))
      .map((participant) => participant.name)

    if (pending.length === 0) {
      return 'Suggestions update as participants continue filling availability.'
    }

    return `Suggestions update as participants continue filling availability. ${pending.join(', ')} haven't marked availability yet.`
  })

  return (
    <GridSection number={3} title="Group availability">
      <p class="grid-view__suggestions-helper">{suggestionsHelperText()}</p>
      <Show when={hasSummaryRows()}>
        <div class="summary-table-wrap">
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
    </GridSection>
  )
}
