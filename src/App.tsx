import { createSignal, Show } from 'solid-js'
import Landing from './Landing'
import Grid from './Grid'

export default function App() {
  const [view, setView] = createSignal<'landing' | 'grid'>('landing')

  return (
    <Show when={view() === 'landing'} fallback={<Grid />}>
      <Landing onCreateEvent={() => setView('grid')} />
    </Show>
  )
}
