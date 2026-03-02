import { createSignal, Show, Suspense, lazy, onMount } from 'solid-js'
import { makeEventListener } from '@solid-primitives/event-listener'
import { touchEventRecent } from './db'

const Landing = lazy(() => import('./Landing'))
const Grid = lazy(() => import('./Grid'))

function parseEventIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/e\/([^/]+)$/)

  return match ? decodeURIComponent(match[1]) : null
}

export default function App() {
  const [eventId, setEventId] = createSignal<string | null>(
    parseEventIdFromPath(window.location.pathname),
  )

  function touchRecentSilently(id: string | null) {
    if (!id) {
      return
    }

    queueMicrotask(() => {
      touchEventRecent(id).catch(() => {})
    })
  }

  function navigateToEvent(id: string) {
    const nextPath = `/e/${encodeURIComponent(id)}`

    if (window.location.pathname !== nextPath) {
      window.history.pushState({ eventId: id }, '', nextPath)
    }

    setEventId(id)
    touchRecentSilently(id)
  }

  onMount(() => {
    const onPopState = () => {
      const id = parseEventIdFromPath(window.location.pathname)
      setEventId(id)
      touchRecentSilently(id)
    }

    const initialId = parseEventIdFromPath(window.location.pathname)
    touchRecentSilently(initialId)
    makeEventListener(window, 'popstate', onPopState)
  })

  return (
    <Suspense fallback={null}>
      <Show when={eventId() === null} fallback={<Grid eventId={eventId()!} />}>
        <Landing onOpenEvent={navigateToEvent} />
      </Show>
    </Suspense>
  )
}
