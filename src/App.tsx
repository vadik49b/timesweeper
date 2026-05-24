import { createSignal, Show, Suspense, lazy, onMount } from 'solid-js'
import { makeEventListener } from '@solid-primitives/event-listener'

const Landing = lazy(() => import('./Landing'))
const Grid = lazy(() => import('./GridContainer'))

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

    makeEventListener(window, 'popstate', onPopState)
  })

  return (
    <Suspense fallback={null}>
      <Show when={eventId()} keyed fallback={<Landing onOpenEvent={navigateToEvent} />}>
        {(id) => <Grid eventId={id} />}
      </Show>
    </Suspense>
  )
}
