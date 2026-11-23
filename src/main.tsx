import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@shared/styles/theme.css'
import '@shared/styles/motion.css'
import '@app/App.css'
import './index.css'
import App from '@app/App.tsx'
import '@shared/styles/information.css'
import { watchSystemTheme } from '@shared/theme/theme'
import { listenForInstallPrompt } from '@shared/pwa/installPrompt'
import { installNativeShell } from '@shared/native/nativeShell'

const enableMockApi =
  import.meta.env.DEV && import.meta.env.VITE_USE_MOCK_API === 'true'

if (enableMockApi) {
  const { setupMockServer } = await import('./mocks/mockServer')
  setupMockServer()
}

// Inside the Pinit app's WebView: hide the bottom tab and let the app renew the session.
const inNativeShell = installNativeShell()

watchSystemTheme()
listenForInstallPrompt()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// The app's WebView always loads the deployed site and has no install or web push, so it runs
// without the service worker. A cached shell there could also outlive an app update.
if (import.meta.env.PROD && !inNativeShell && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    let hasNotifiedForUpdate = false

    navigator.serviceWorker
      .register('/sw.js', { updateViaCache: 'none' })
      .then((registration) => {
        // Trigger an update check when the user revisits.
        registration.update()

        registration.onupdatefound = () => {
          const installingWorker = registration.installing
          if (!installingWorker) return

          installingWorker.addEventListener('statechange', () => {
            if (
              installingWorker.state === 'installed' &&
              navigator.serviceWorker.controller
            ) {
              // Preserve in-progress forms. The shell offers an explicit reload action.
              if (!hasNotifiedForUpdate) {
                hasNotifiedForUpdate = true
                window.dispatchEvent(new Event('pinit:update-ready'))
              }
            }
          })
        }
      })
      .catch((error) =>
        console.error('Service worker registration failed:', error),
      )
  })
}
