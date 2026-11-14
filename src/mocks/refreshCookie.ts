/**
 * The mock's stand-in for the httpOnly refresh_token cookie. Login sets it, logout removes it, and
 * /v0/refresh answers 401 without it, like the server. It lives in localStorage so it survives a
 * reload the way the cookie does; the rest of the mock state still starts over.
 */
const COOKIE_KEY = 'pinit.mock.refreshCookie'
const FAILURE_KEY = 'pinit.mock.refreshFailure'

/** A refresh that gets no answer about the session: 'network' (no response) or 'unavailable' (502 page). */
export type MockRefreshFailure = 'network' | 'unavailable'

const storage = () => {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

const write = (key: string, value: string | null) => {
  try {
    if (value === null) storage()?.removeItem(key)
    else storage()?.setItem(key, value)
  } catch {
    /* 이번 요청에만 적용한다 */
  }
}

const read = (key: string) => {
  try {
    return storage()?.getItem(key) ?? null
  } catch {
    return null
  }
}

export const setMockRefreshCookie = (memberId: number | null) =>
  write(COOKIE_KEY, memberId === null ? null : String(memberId))

export const readMockRefreshCookie = (): number | null => {
  const value = Number(read(COOKIE_KEY))
  return Number.isInteger(value) && value > 0 ? value : null
}

export const setMockRefreshFailure = (failure: MockRefreshFailure | null) => write(FAILURE_KEY, failure)

export const readMockRefreshFailure = (): MockRefreshFailure | null => {
  const value = read(FAILURE_KEY)
  return value === 'network' || value === 'unavailable' ? value : null
}
