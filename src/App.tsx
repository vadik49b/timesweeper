import { createSignal, Show } from 'solid-js'
import Landing from './Landing'
import Grid from './Grid'

export default function App() {
  const [eventId, setEventId] = createSignal<string | null>(null)

  return (
    <Show when={eventId() === null} fallback={<Grid eventId={eventId()!} />}>
      <Landing onCreateEvent={(id: string) => setEventId(id)} />
    </Show>
  )
}
