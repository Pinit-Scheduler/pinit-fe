import { buildAuthUrl } from './config'
import { getAccessToken, isAccessTokenExpired, isLoggedOut, setAuthTokens } from './authTokens'

// HTTP requests, AuthGuard and AppShell all join this one refresh operation.
let pending: Promise<string | null> | null = null
let failed: { token: string | null; until: number } | null = null

export const refreshAccessTokenFromCookie = (): Promise<string | null> => {
  if (isLoggedOut()) return Promise.resolve(null)
  if (pending) return pending
  const before = getAccessToken()
  if (failed?.token === before && Date.now() < failed.until) return Promise.resolve(null)

  const request = (async () => {
    let next: string | null = null
    try {
      const response = await fetch(buildAuthUrl('/refresh'), {
        method: 'POST', credentials: 'include',
      })
      if (response.ok) {
        const data: { token?: unknown } = await response.json()
        if (typeof data.token === 'string' && data.token.length > 0) next = data.token
      }
    } catch {
      // The caller decides whether its own rejected token should be removed.
    }
    if (isLoggedOut()) return null
    const current = getAccessToken()
    // A login/logout or another tab may have changed the session while awaiting the server.
    if (current !== before) return current && !isAccessTokenExpired(current) ? current : null
    if (!next) {
      failed = { token: before, until: Date.now() + 1000 }
      return null
    }
    failed = null
    setAuthTokens({ accessToken: next })
    return next
  })().finally(() => {
    if (pending === request) pending = null
  })
  pending = request
  return request
}
