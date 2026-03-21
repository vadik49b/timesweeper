interface Props {
  yesCount: number
  maybeCount: number
  noCount: number
}

function formatCounts(props: Props) {
  return [
    props.yesCount > 0 ? `${props.yesCount} yes` : null,
    props.maybeCount > 0 ? `${props.maybeCount} maybe` : null,
    props.noCount > 0 ? `${props.noCount} no` : null,
  ]
    .filter(Boolean)
    .join(', ')
}

function summaryPhrase(props: Props) {
  const total = props.yesCount + props.maybeCount + props.noCount

  if (total === 0) {
    return ''
  }

  if (props.yesCount === total) {
    return 'Works for everyone'
  }

  if (props.noCount === total) {
    return 'Works for no one'
  }

  if (props.noCount === 0 && props.maybeCount > 0) {
    return 'Could work for everyone'
  }

  if (total >= 4 && props.noCount === 1 && props.maybeCount === 0) {
    return 'Works for almost everyone'
  }

  return ''
}

export default function SummaryInline(props: Props) {
  const countsText = formatCounts(props)
  const phrase = summaryPhrase(props)
  const text = phrase ? `${phrase}: ${countsText}` : `Summary: ${countsText}`

  return <p class="summary-inline">{text}</p>
}
