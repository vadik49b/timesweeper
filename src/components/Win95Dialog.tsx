import { createEffect, onCleanup } from 'solid-js'
import type { JSX } from 'solid-js'
import Win95Button from './Win95Button'

let openDialogCount = 0
let previousBodyOverflow = ''
let previousBodyPosition = ''
let previousBodyTop = ''
let previousBodyWidth = ''
let previousHtmlOverflow = ''
let lockedScrollY = 0
let nextDialogId = 1
const dialogStack: number[] = []

interface Props {
  title: string
  class?: string
  bodyClass?: string
  onClose?: () => void
  showCloseButton?: boolean
  children: JSX.Element
}

export default function Win95Dialog(props: Props) {
  const dialogId = nextDialogId++
  const dialogClass = () => ['dialog', 'r', props.class].filter(Boolean).join(' ')
  const dialogBodyClass = () => ['dialog-body', props.bodyClass].filter(Boolean).join(' ')
  const dialogTitleId = () =>
    `dialog-title-${props.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
  const showCloseButton = () => props.showCloseButton ?? true

  createEffect(() => {
    dialogStack.push(dialogId)

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return
      }

      const topDialogId = dialogStack[dialogStack.length - 1]

      if (topDialogId !== dialogId) {
        return
      }

      if (!props.onClose) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      props.onClose()
    }

    document.addEventListener('keydown', onKeyDown)

    onCleanup(() => {
      document.removeEventListener('keydown', onKeyDown)
      const index = dialogStack.lastIndexOf(dialogId)

      if (index === -1) {
        return
      }

      dialogStack.splice(index, 1)
    })
  })

  createEffect(() => {
    if (openDialogCount === 0) {
      lockedScrollY = window.scrollY
      previousBodyOverflow = document.body.style.overflow
      previousBodyPosition = document.body.style.position
      previousBodyTop = document.body.style.top
      previousBodyWidth = document.body.style.width
      previousHtmlOverflow = document.documentElement.style.overflow
      document.documentElement.style.overflow = 'hidden'
      document.body.style.overflow = 'hidden'
      document.body.style.position = 'fixed'
      document.body.style.top = `-${lockedScrollY}px`
      document.body.style.width = '100%'
    }

    openDialogCount += 1

    onCleanup(() => {
      openDialogCount = Math.max(0, openDialogCount - 1)

      if (openDialogCount === 0) {
        document.documentElement.style.overflow = previousHtmlOverflow
        document.body.style.overflow = previousBodyOverflow
        document.body.style.position = previousBodyPosition
        document.body.style.top = previousBodyTop
        document.body.style.width = previousBodyWidth
        window.scrollTo(0, lockedScrollY)
      }
    })
  })

  return (
    <div class="dialog-overlay" role="presentation">
      <div class={dialogClass()} role="dialog" aria-modal="true" aria-labelledby={dialogTitleId()}>
        <div class="win95-window__title-bar">
          <span id={dialogTitleId()}>{props.title}</span>
          <div class="win95-window__title-buttons">
            {showCloseButton() && (
              <Win95Button
                size="small"
                class="win95-window__title-button"
                ariaLabel={`Close ${props.title}`}
                onClick={props.onClose ?? (() => {})}
              >
                X
              </Win95Button>
            )}
          </div>
        </div>
        <div class={dialogBodyClass()}>{props.children}</div>
      </div>
    </div>
  )
}
