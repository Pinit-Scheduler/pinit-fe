import { buildAuthUrl } from './config'
import { getAccessToken, isAccessTokenExpired, isLoggedOut, setAuthTokens } from './authTokens'

/**
 * The outcome of the shared cookie refresh.
 * - refreshed: a usable access token is stored (ours, or one another tab or login stored meanwhile).
 * - unauthorized: the session really ended. /refresh answered 401 or 403, the user logged out on
 *   this device, or the stored token was removed while the refresh was waiting.
 * - transient: nothing says the session ended. The request failed without a response (status 0),
 *   or the server answered something else (5xx, 429, another status, or a success without a token).
 *   The stored token stays and the caller retries later. `data` is the response body or the thrown error.
 */
export type RefreshResult =
  | { kind: 'refreshed'; token: string }
  | { kind: 'unauthorized' }
  | { kind: 'transient'; status: number; data: unknown }

const UNAUTHORIZED: RefreshResult = { kind: 'unauthorized' }

// HTTP requests, AuthGuard, AppShell, LandingPage and realtime streams all join this one refresh.
let pending: Promise<RefreshResult> | null = null
// Only an answered 401/403 is remembered. A transient failure is tried again by the next caller.
let failed: { token: string | null; until: number } | null = null

const readBody = async (response: Response): Promise<unknown> => {
  try {
    const raw = await response.text()
    try {
      return JSON.parse(raw)
    } catch {
      return raw
    }
  } catch {
    return null
  }
}

type RefreshAnswer =
  | { kind: 'token'; token: string }
  | { kind: 'unauthorized' }
  | { kind: 'transient'; status: number; data: unknown }

const requestRefresh = async (): Promise<RefreshAnswer> => {
  let response: Response
  try {
    response = await fetch(buildAuthUrl('/refresh'), { method: 'POST', credentials: 'include' })
  } catch (error) {
    return { kind: 'transient', status: 0, data: error }
  }
  if (response.status === 401 || response.status === 403) return { kind: 'unauthorized' }
  const data = await readBody(response)
  if (!response.ok) return { kind: 'transient', status: response.status, data }
  const token = data && typeof data === 'object' ? (data as { token?: unknown }).token : undefined
  if (typeof token === 'string' && token.length > 0) return { kind: 'token', token }
  return { kind: 'transient', status: response.status, data }
}

export const refreshSession = (): Promise<RefreshResult> => {
  if (isLoggedOut()) return Promise.resolve(UNAUTHORIZED)
  if (pending) return pending
  const before = getAccessToken()
  if (failed?.token === before && Date.now() < failed.until) return Promise.resolve(UNAUTHORIZED)

  const request = (async (): Promise<RefreshResult> => {
    const answer = await requestRefresh()
    if (isLoggedOut()) return UNAUTHORIZED
    const current = getAccessToken()
    // A login/logout or another tab may have changed the session while awaiting the server.
    if (current !== before) {
      if (current && !isAccessTokenExpired(current)) return { kind: 'refreshed', token: current }
      // Only an ended session removes the token, so a removed one means it ended. Ask again otherwise.
      return current ? { kind: 'transient', status: 0, data: null } : UNAUTHORIZED
    }
    if (answer.kind === 'unauthorized') {
      failed = { token: before, until: Date.now() + 1000 }
      return UNAUTHORIZED
    }
    if (answer.kind === 'transient') return answer
    failed = null
    setAuthTokens({ accessToken: answer.token })
    return { kind: 'refreshed', token: answer.token }
  })().finally(() => {
    if (pending === request) pending = null
  })
  pending = request
  return request
}

/** The refresh got no answer about the session (RefreshResult 'transient'). It may still be valid. */
export class RefreshUnavailableError extends Error {
  status: number
  data: unknown

  constructor(status: number, data: unknown) {
    super('Session refresh unavailable')
    this.name = 'RefreshUnavailableError'
    this.status = status
    this.data = data
  }
}

/**
 * refreshSession as a token: the new token, or null once the session ended. A transient failure
 * rejects with RefreshUnavailableError, so a caller with its own retry loop simply retries.
 */
export const refreshAccessTokenFromCookie = async (): Promise<string | null> => {
  const result = await refreshSession()
  if (result.kind === 'refreshed') return result.token
  if (result.kind === 'unauthorized') return null
  throw new RefreshUnavailableError(result.status, result.data)
}
