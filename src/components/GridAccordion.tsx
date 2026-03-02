import { Show, type JSX } from 'solid-js'

interface Props {
  id: string
  title: JSX.Element
  collapsed: boolean
  onToggle: () => void
  children: JSX.Element
  bodyAlign?: 'arrow' | 'title'
  spaced?: boolean
  headerClass?: string
  bodyClass?: string
}

export default function GridAccordion(props: Props) {
  const toggleId = () => `panel-toggle-${props.id}`
  const bodyId = () => `panel-body-${props.id}`

  return (
    <>
      <button
        type="button"
        class="grid-view__panel-header"
        classList={{
          'grid-view__panel-header--spaced': !!props.spaced,
          [props.headerClass ?? '']: !!props.headerClass,
        }}
        id={toggleId()}
        onClick={props.onToggle}
        aria-controls={bodyId()}
        aria-expanded={!props.collapsed}
      >
        <div class="grid-view__panel-toggle">{props.collapsed ? '▸' : '▾'}</div>
        <span>{props.title}</span>
        <hr />
      </button>
      <Show when={!props.collapsed}>
        <div
          class="grid-view__panel-body"
          classList={{
            'grid-view__panel-body--title': props.bodyAlign === 'title',
            [props.bodyClass ?? '']: !!props.bodyClass,
          }}
          id={bodyId()}
          role="region"
          aria-labelledby={toggleId()}
        >
          {props.children}
        </div>
      </Show>
    </>
  )
}
