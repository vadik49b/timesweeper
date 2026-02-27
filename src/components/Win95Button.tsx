import type { JSX } from 'solid-js'

interface Props {
  class?: string
  size?: 'normal' | 'small'
  fullWidth?: boolean
  disabled?: boolean
  title?: string
  ariaLabel?: string
  onClick?: JSX.EventHandlerUnion<HTMLButtonElement, MouseEvent>
  children: JSX.Element
}

export default function Win95Button(props: Props) {
  const className = () =>
    [
      'win95-button',
      'r',
      `win95-button--${props.size ?? 'normal'}`,
      props.fullWidth ? 'win95-button--full-width' : '',
      props.class,
    ]
      .filter(Boolean)
      .join(' ')
  return (
    <button
      type="button"
      class={className()}
      onClick={props.onClick}
      disabled={props.disabled}
      title={props.title}
      aria-label={props.ariaLabel}
    >
      {props.children}
    </button>
  )
}
