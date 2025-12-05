export type AuthProvider = 'naver' | 'google'

const AUTH_BASE_URL =
  import.meta.env.VITE_AUTH_BASE_URL ||
  (import.meta.env.PROD ? 'https://auth.pinit.go-gradually.me' : 'http://localhost:8080')

export const getAuthBaseUrl = () => AUTH_BASE_URL

export const buildAuthorizeUrl = (provider: AuthProvider) =>
  `${AUTH_BASE_URL}/login/oauth2/authorize/${provider}`
