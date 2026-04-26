import type { JSX } from 'solid-js'

interface Props {
  number: number
  title: string
  bodyClass?: string
  children: JSX.Element
}

export default function GridSection(props: Props) {
  const bodyClass = () => ['grid-view__section-body', props.bodyClass].filter(Boolean).join(' ')

  return (
    <section class="grid-view__section">
      <div class="grid-view__section-header">
        <span class="grid-view__section-number">{props.number}.</span>
        <span>{props.title}</span>
        <hr />
      </div>
      <div class={bodyClass()}>{props.children}</div>
    </section>
  )
}
