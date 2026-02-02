const ACCESS_TOKEN_KEY = 'pinit.accessToken'
const REFRESH_TOKEN_KEY = 'pinit.refreshToken'
const LOGOUT_MARKER_KEY = 'pinit.logoutMarker'
const DEVICE_ID_KEY = 'pinit.deviceId'

const hasWindow = () => typeof window !== 'undefined'

const createDeviceId = () => {
  const cryptoObj = hasWindow() ? window.crypto : undefined
  if (cryptoObj?.randomUUID) return cryptoObj.randomUUID()
  return `device-${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`
}

export const ensureDeviceId = () => {
  if (!hasWindow()) return null
  const existing = window.localStorage.getItem(DEVICE_ID_KEY)
  if (existing) return existing
  const next = createDeviceId()
  window.localStorage.setItem(DEVICE_ID_KEY, next)
  return next
}

export const setAuthTokens = (tokens: { accessToken?: string | null; refreshToken?: string | null }) => {
  if (!hasWindow()) return
  // 로그인 성공 시 로그아웃 마커 제거
  window.localStorage.removeItem(LOGOUT_MARKER_KEY)
  const { accessToken } = tokens
  if (accessToken) {
    window.localStorage.setItem(ACCESS_TOKEN_KEY, accessToken)
  } else if (accessToken === null) {
    window.localStorage.removeItem(ACCESS_TOKEN_KEY)
  }
  // refresh 토큰은 httpOnly 쿠키로만 관리하며, 로컬스토리지에 남아있을 경우 제거
  window.localStorage.removeItem(REFRESH_TOKEN_KEY)
}

export const getAccessToken = () => {
  if (!hasWindow()) return null
  return window.localStorage.getItem(ACCESS_TOKEN_KEY)
}

const parseJwtPayload = (token: string) => {
  try {
    const base64 = token.split('.')[1]
    if (!base64) return null
    const normalized = base64.replace(/-/g, '+').replace(/_/g, '/')
    const json = atob(normalized)
    return JSON.parse(json) as { exp?: number }
  } catch {
    return null
  }
}

export const isAccessTokenExpired = (token: string, skewMs = 60_000) => {
  const payload = parseJwtPayload(token)
  if (!payload?.exp) return false
  const now = Date.now()
  const exp = payload.exp * 1000
  return exp - skewMs <= now
}

export const clearAuthTokens = () => {
  if (!hasWindow()) return
  window.localStorage.removeItem(ACCESS_TOKEN_KEY)
  window.localStorage.removeItem(REFRESH_TOKEN_KEY)
}

export const markLoggedOut = () => {
  if (!hasWindow()) return
  window.localStorage.setItem(LOGOUT_MARKER_KEY, '1')
}

export const isLoggedOut = () => {
  if (!hasWindow()) return false
  return window.localStorage.getItem(LOGOUT_MARKER_KEY) === '1'
}

export const clearLogoutMarker = () => {
  if (!hasWindow()) return
  window.localStorage.removeItem(LOGOUT_MARKER_KEY)
}
