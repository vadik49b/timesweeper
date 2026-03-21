/* @refresh reload */
import { render } from 'solid-js/web'
import { makeEventListener } from '@solid-primitives/event-listener'
import { MetaProvider } from '@solidjs/meta'
import './styles/base.css'
import App from './App.tsx'

const root = document.getElementById('root')

render(
  () => (
    <MetaProvider>
      <App />
    </MetaProvider>
  ),
  root!,
)

if ('serviceWorker' in navigator) {
  if (import.meta.env.PROD) {
    makeEventListener(window, 'load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // Keep app working without SW in unsupported/restricted environments.
      })
    })
  } else {
    // Prevent SW from hijacking Vite HMR during local development.
    navigator.serviceWorker.getRegistrations().then((regs) => {
      regs.forEach((reg) => {
        void reg.unregister()
      })
    })
  }
}
