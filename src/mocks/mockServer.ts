import { handleMockRequest } from './handlers'

let isInstalled = false

export const setupMockServer = () => {
  if (isInstalled) return
  if (typeof window === 'undefined' || typeof window.fetch !== 'function') return

  const originalFetch = window.fetch.bind(window)

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    const mocked = await handleMockRequest(request)
    if (mocked) return mocked
    return originalFetch(input, init)
  }

  isInstalled = true
  console.info('[mock] Local mock API is active (VITE_USE_MOCK_API=true)')
}
