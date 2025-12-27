import { httpClient } from './httpClient'
import { ensureDeviceId, setAuthTokens } from './authTokens'

export type AuthProvider = 'naver' | 'google'

const AUTH_BASE_URL =
  import.meta.env.VITE_AUTH_BASE_URL ||
  (import.meta.env.PROD ? 'https://auth.pinit.go-gradually.me' : 'http://localhost:8081')

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

export type SignupPayload = {
  username: string
  password: string
  nickname: string
}

export type LoginPayload = {
  username: string
  password: string
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
  })
  ensureDeviceId()

  return response
}

export const login = async (payload: LoginPayload) => {
  const url = `${AUTH_BASE_URL}/login`
  const response = await httpClient<LoginResponse>(url, {
    method: 'POST',
    json: payload,
    credentials: 'include',
  })

  setAuthTokens({
    accessToken: response?.token ?? null,
  })
  ensureDeviceId()

  return response
}

export const signup = async (payload: SignupPayload) => {
  const url = `${AUTH_BASE_URL}/signup`
  return httpClient<void>(url, {
    method: 'POST',
    json: payload,
    credentials: 'include',
  })
}

export const logout = async () => {
  const url = `${AUTH_BASE_URL}/logout`
  await httpClient<void>(url, {
    method: 'POST',
    credentials: 'include',
  })
  setAuthTokens({ accessToken: null })
}

export const refreshAccessToken = async () => {
  const url = `${AUTH_BASE_URL}/refresh`
  const response = await fetch(url, {
    method: 'POST',
    credentials: 'include',
  })
  if (!response.ok) {
    throw new Error(`토큰 재발급 실패: ${response.status}`)
  }
  const data: LoginResponse = await response.json()
  setAuthTokens({
    accessToken: data?.token ?? null,
  })
  return data
}
