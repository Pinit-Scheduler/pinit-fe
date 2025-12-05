const ACCESS_TOKEN_KEY = 'pinit.accessToken'
const REFRESH_TOKEN_KEY = 'pinit.refreshToken'

const hasWindow = () => typeof window !== 'undefined'

export const setAuthTokens = (tokens: { accessToken?: string | null; refreshToken?: string | null }) => {
  if (!hasWindow()) return
  const { accessToken, refreshToken } = tokens
  if (accessToken) {
    window.localStorage.setItem(ACCESS_TOKEN_KEY, accessToken)
  }
  if (refreshToken) {
    window.localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken)
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
