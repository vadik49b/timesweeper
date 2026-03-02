import type { JSX } from 'solid-js'
import Win95Button from './Win95Button'

interface Props {
  title: string
  class?: string
  bodyClass?: string
  onClose: () => void
  children: JSX.Element
}

export default function Win95Dialog(props: Props) {
  const dialogClass = () => ['dialog', 'r', props.class].filter(Boolean).join(' ')
  const dialogBodyClass = () => ['dialog-body', props.bodyClass].filter(Boolean).join(' ')
  const dialogTitleId = () =>
    `dialog-title-${props.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`

  return (
    <div class="dialog-overlay" role="presentation">
      <div class={dialogClass()} role="dialog" aria-modal="true" aria-labelledby={dialogTitleId()}>
        <div class="win95-window__title-bar">
          <span id={dialogTitleId()}>{props.title}</span>
          <div class="win95-window__title-buttons">
            <Win95Button
              size="small"
              class="win95-window__title-button"
              ariaLabel={`Close ${props.title}`}
              onClick={props.onClose}
            >
              ×
            </Win95Button>
          </div>
        </div>
        <div class={dialogBodyClass()}>{props.children}</div>
      </div>
    </div>
  )
}
