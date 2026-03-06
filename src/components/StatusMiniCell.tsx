import type { SlotValue } from '../types'

interface Props {
  value: SlotValue
  class?: string
}

function statusMark(value: SlotValue) {
  if (value === 1) {
    return '✓'
  }

  if (value === 2) {
    return '?'
  }

  return ''
}

export default function StatusMiniCell(props: Props) {
  return (
    <span
      classList={{
        'summary-table__cell': true,
        'summary-table__cell--mini': true,
        'summary-table__cell--yes': props.value === 1,
        'summary-table__cell--maybe': props.value === 2,
        'summary-table__cell--no': props.value === 0,
        [props.class ?? '']: !!props.class,
      }}
    >
      {statusMark(props.value)}
    </span>
  )
}
