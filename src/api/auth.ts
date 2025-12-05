import { httpClient } from './httpClient'
import { setAuthTokens } from './authTokens'

export type AuthProvider = 'naver' | 'google'

const AUTH_BASE_URL =
  import.meta.env.VITE_AUTH_BASE_URL ||
  (import.meta.env.PROD ? 'https://auth.pinit.go-gradually.me' : 'http://localhost:8080')

export const getAuthBaseUrl = () => AUTH_BASE_URL

export type LoginResponse = {
  token?: string
  refreshToken?: string
}

export type SocialLoginPayload = {
  code?: string
  state?: string
  accessToken?: string
  error?: string
  errorDescription?: string
}

export const buildAuthorizeUrl = (provider: AuthProvider) =>
  `${AUTH_BASE_URL}/login/oauth2/authorize/${provider}`

export const exchangeSocialLogin = async (provider: AuthProvider, payload: SocialLoginPayload) => {
  const query = new URLSearchParams()
  if (payload.code) query.set('code', payload.code)
  if (payload.state) query.set('state', payload.state)
  if (payload.accessToken) query.set('access_token', payload.accessToken)
  if (payload.error) query.set('error', payload.error)
  if (payload.errorDescription) query.set('error_description', payload.errorDescription)

  const url = `${AUTH_BASE_URL}/login/oauth2/code/${provider}?${query.toString()}`
  const response = await httpClient<LoginResponse>(url, {
    method: 'GET',
    credentials: 'include',
  })

  setAuthTokens({
    accessToken: response?.token ?? null,
    refreshToken: response?.refreshToken ?? null,
  })

  return response
}
