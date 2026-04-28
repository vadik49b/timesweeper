interface Props {
  withLabels?: boolean
  class?: string
}

export default function AvailabilityLegend(props: Props) {
  const rootClass = () =>
    ['availability-legend', props.class].filter(Boolean).join(' ')
  const cellClass = (extra?: string) => ['grid-view__legend-cell', extra].filter(Boolean).join(' ')
  const arrow = '\u2192'

  return (
    <span class={rootClass()}>
      <span class={cellClass()} />
      <span class="availability-legend__label">{props.withLabels ? 'no' : ''}</span>
      <span class="availability-legend__arrow">{arrow}</span>
      <span class={cellClass('grid-view__legend-cell--open grid-view__legend-cell--yes')}>✔</span>
      <span class="availability-legend__label">{props.withLabels ? 'yes' : ''}</span>
      <span class="availability-legend__arrow">{arrow}</span>
      <span class={cellClass('grid-view__legend-cell--flagged')}>?</span>
      <span class="availability-legend__label">{props.withLabels ? 'maybe' : ''}</span>
      <span class="availability-legend__arrow">{arrow}</span>
      <span class={cellClass()} />
      <span class="availability-legend__label">{props.withLabels ? 'no' : ''}</span>
    </span>
  )
}
