const isDebug = import.meta.env.DEV

export const debugLog = (...args: unknown[]) => {
  if (!isDebug) return
  console.log(...args)
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export const createCookieTokenRefresher = (
  buildAuthUrl: (path: string) => string,
  setAccessToken: (token: string | null) => void,
) => {
  let refreshInFlight: Promise<string | null> | null = null
  let lastRefreshAttempt = 0

  return async () => {
    if (refreshInFlight) return refreshInFlight

    const now = Date.now()
    const elapsed = now - lastRefreshAttempt
    const waitMs = elapsed >= 1000 ? 0 : 1000 - elapsed

    refreshInFlight = (async () => {
      if (waitMs > 0) {
        await sleep(waitMs)
      }
      lastRefreshAttempt = Date.now()
      try {
        debugLog('🔄 Attempting token refresh...')
        const response = await fetch(buildAuthUrl('/refresh'), {
          method: 'POST',
          credentials: 'include',
        })
        if (!response.ok) {
          console.warn('⚠️ Refresh request failed:', { status: response.status })
          return null
        }
        const data = (await response.json()) as { token?: string | null; refreshToken?: string | null }
        const nextAccess = data?.token ?? null
        setAccessToken(nextAccess)
        if (nextAccess) {
          debugLog('✅ Token refreshed successfully')
        } else {
          console.warn('⚠️ Refresh response missing access token')
        }
        return nextAccess
      } catch (error) {
        console.error('🔥 Refresh request errored:', error)
        return null
      } finally {
        refreshInFlight = null
      }
    })()

    return refreshInFlight
  }
}
