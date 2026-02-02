import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@app/App.css'
import './index.css'
import App from '@app/App.tsx'

const enableMockApi = import.meta.env.DEV && import.meta.env.VITE_USE_MOCK_API === 'true'

if (enableMockApi) {
  const { setupMockServer } = await import('./mocks/mockServer')
  setupMockServer()
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    let hasRefreshedForUpdate = false

    navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => {
        // Trigger an update check when the user revisits.
        registration.update()

        registration.onupdatefound = () => {
          const installingWorker = registration.installing
          if (!installingWorker) return

          installingWorker.addEventListener('statechange', () => {
            if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // A new service worker is ready; refresh once to activate it on clients.
              if (!hasRefreshedForUpdate) {
                hasRefreshedForUpdate = true
                window.location.reload()
              }
            }
          })
        }
      })
      .catch((error) => console.error('Service worker registration failed:', error))
  })
}
