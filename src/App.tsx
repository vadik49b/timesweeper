import { createSignal, Show, onMount, onCleanup } from 'solid-js'
import Landing from './Landing'
import Grid from './Grid'

function parseEventIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/e\/([^/]+)$/)
  return match ? decodeURIComponent(match[1]) : null
}

export default function App() {
  const [eventId, setEventId] = createSignal<string | null>(
    parseEventIdFromPath(window.location.pathname),
  )

  function navigateToEvent(id: string) {
    const nextPath = `/e/${encodeURIComponent(id)}`
    if (window.location.pathname !== nextPath) {
      window.history.pushState({ eventId: id }, '', nextPath)
    }
    setEventId(id)
  }

  onMount(() => {
    const onPopState = () => {
      setEventId(parseEventIdFromPath(window.location.pathname))
    }
    window.addEventListener('popstate', onPopState)
    onCleanup(() => window.removeEventListener('popstate', onPopState))
  })

  return (
    <Show when={eventId() === null} fallback={<Grid eventId={eventId()!} />}>
      <Landing onOpenEvent={navigateToEvent} />
    </Show>
  )
}
