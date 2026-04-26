import { For, Index, Show } from 'solid-js'
import Win95Button from './Win95Button'
import Win95Dialog from './Win95Dialog'
import Win95Field from './Win95Field'
import DialogActions from './DialogActions'

interface Props {
  eventName: string
  organizerName: string
  participantNames: string[]
  visibleParticipantNames: string[]
  newParticipantNames: string[]
  showAllParticipants: boolean
  onEventNameInput: (value: string) => void
  onRemoveParticipant: (index: number) => void
  onAddParticipantRow: () => void
  onUpdateParticipantRow: (index: number, value: string) => void
  onRemoveParticipantRow: (index: number) => void
  onToggleAllParticipants: () => void
  onSave: () => void
  onCancel: () => void
}

export default function SettingsDialog(props: Props) {
  return (
    <Win95Dialog title="Edit details" class="dialog--settings" onClose={props.onCancel}>
      <label class="settings__label" for="settings-event-name">
        Title:
      </label>
      <Win95Field
        kind="input"
        id="settings-event-name"
        name="settingsEventName"
        value={props.eventName}
        wrapperClass="dialog__field"
        onInput={props.onEventNameInput}
      />
      <label class="settings__label" for="settings-organizer-name">
        Organizer:
      </label>
      <p class="settings__organizer">{props.organizerName}</p>
      <p class="settings__label">Dates:</p>
      <p class="settings__organizer">Locked after setup to keep everyone aligned.</p>
      <p class="settings__label">Participants:</p>
      <div class="settings__participants-list">
        <table class="settings__participants-table">
          <thead>
            <tr>
              <th>Name</th>
              <th class="settings__participants-action-col">Action</th>
            </tr>
          </thead>
          <tbody>
            <For each={props.visibleParticipantNames}>
              {(participantName, index) => (
                <tr>
                  <td class="settings__participant-name">{participantName}</td>
                  <td class="settings__participant-action-cell">
                    <Win95Button
                      size="small"
                      variant="toolbar"
                      class="settings__participant-remove"
                      onClick={() => props.onRemoveParticipant(index())}
                    >
                      Remove
                    </Win95Button>
                  </td>
                </tr>
              )}
            </For>
            <Index each={props.newParticipantNames}>
              {(participantName, index) => (
                <tr>
                  <td class="settings__participant-input-cell">
                    <Win95Field
                      kind="input"
                      name={`settingsNewParticipantName${index}`}
                      size="small"
                      value={participantName()}
                      placeholder="Name"
                      wrapperClass="settings__participant-input"
                      onInput={(value) => props.onUpdateParticipantRow(index, value)}
                    />
                  </td>
                  <td class="settings__participant-action-cell">
                    <Win95Button
                      size="small"
                      variant="toolbar"
                      class="settings__participant-remove"
                      onClick={() => props.onRemoveParticipantRow(index)}
                    >
                      Remove
                    </Win95Button>
                  </td>
                </tr>
              )}
            </Index>
          </tbody>
        </table>
      </div>
      <div class="settings__participants-actions">
        <Win95Button size="small" variant="toolbar" onClick={props.onAddParticipantRow}>
          Add another row
        </Win95Button>
      </div>
      <Show when={props.participantNames.length > 5}>
        <div class="settings__participants-toggle">
          <Win95Button size="small" variant="toolbar" onClick={props.onToggleAllParticipants}>
            <Show
              when={props.showAllParticipants}
              fallback={`Show all ${props.participantNames.length} participants`}
            >
              Show fewer participants
            </Show>
          </Win95Button>
        </div>
      </Show>
      <DialogActions>
        <Win95Button class="dialog-btn" onClick={props.onSave}>
          Save
        </Win95Button>
        <Win95Button class="dialog-btn" onClick={props.onCancel}>
          Cancel
        </Win95Button>
      </DialogActions>
    </Win95Dialog>
  )
}
