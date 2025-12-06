const ACCESS_TOKEN_KEY = 'pinit.accessToken'
const REFRESH_TOKEN_KEY = 'pinit.refreshToken'
const LOGOUT_MARKER_KEY = 'pinit.logoutMarker'

const hasWindow = () => typeof window !== 'undefined'

export const setAuthTokens = (tokens: { accessToken?: string | null; refreshToken?: string | null }) => {
  if (!hasWindow()) return
  // 로그인 성공 시 로그아웃 마커 제거
  window.localStorage.removeItem(LOGOUT_MARKER_KEY)
  const { accessToken, refreshToken } = tokens
  if (accessToken) {
    window.localStorage.setItem(ACCESS_TOKEN_KEY, accessToken)
  } else if (accessToken === null) {
    window.localStorage.removeItem(ACCESS_TOKEN_KEY)
  }
  if (refreshToken) {
    window.localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken)
  } else if (refreshToken === null) {
    window.localStorage.removeItem(REFRESH_TOKEN_KEY)
  }
}

export const getAccessToken = () => {
  if (!hasWindow()) return null
  return window.localStorage.getItem(ACCESS_TOKEN_KEY)
}

export const getRefreshToken = () => {
  if (!hasWindow()) return null
  return window.localStorage.getItem(REFRESH_TOKEN_KEY)
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
