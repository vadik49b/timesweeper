import { For } from 'solid-js'
import StatusMiniCell from './StatusMiniCell'
import { participantStatusRows, type ParticipantSummaryGroups } from '../event-helpers'

interface Props {
  groups: ParticipantSummaryGroups
}

export default function ParticipantStatusList(props: Props) {
  return (
    <div class="participant-status-list">
      <For each={participantStatusRows(props.groups)}>
        {(group) => (
          <div class="participant-status-list__row">
            <StatusMiniCell value={group.value} class="status-mini-cell--aligned" />
            <span>{group.names.join(', ')}</span>
          </div>
        )}
      </For>
    </div>
  )
}
