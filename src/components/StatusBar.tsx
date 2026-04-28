import { makeEventListener } from '@solid-primitives/event-listener'
import { Show, createSignal } from 'solid-js'

interface Props {
  ready: boolean
  class?: string
}

export default function StatusBar(props: Props) {
  const [isBrowserOnline, setIsBrowserOnline] = createSignal(window.navigator.onLine)

  makeEventListener(window, 'online', () => setIsBrowserOnline(true))
  makeEventListener(window, 'offline', () => setIsBrowserOnline(false))

  return (
    <Show when={props.ready && !isBrowserOnline()}>
      <div class={props.class} role="status" aria-live="polite">
        You're offline. Changes will sync when you're back online.
      </div>
    </Show>
  )
}
