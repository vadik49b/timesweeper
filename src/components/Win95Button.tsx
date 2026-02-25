import type { JSX } from 'solid-js'

interface Props {
  class?: string
  onClick?: JSX.EventHandlerUnion<HTMLDivElement, MouseEvent>
  children: JSX.Element
}

export default function Win95Button(props: Props) {
  const className = () => ['win95-button', 'r', props.class].filter(Boolean).join(' ')
  return (
    <div class={className()} onClick={props.onClick}>
      {props.children}
    </div>
  )
}
