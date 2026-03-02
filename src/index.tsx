/* @refresh reload */
import { render } from 'solid-js/web'
import { makeEventListener } from '@solid-primitives/event-listener'
import './styles/base.css'
import './styles/grid.css'
import './styles/landing.css'
import App from './App.tsx'

const root = document.getElementById('root')

render(() => <App />, root!)

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
