import type { JSX } from 'solid-js'

interface Props {
  class?: string
  disabled?: boolean
  type?: 'button' | 'submit' | 'reset'
  ariaLabel?: string
  ariaPressed?: boolean
  style?: JSX.CSSProperties
  onClick?: () => void
  children?: JSX.Element
}

export default function MineCellButton(props: Props) {
  return (
    <button
      type={props.type ?? 'button'}
      class={['mine-cell', props.class].filter(Boolean).join(' ')}
      disabled={props.disabled}
      aria-label={props.ariaLabel}
      aria-pressed={props.ariaPressed}
      style={props.style}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  )
}
