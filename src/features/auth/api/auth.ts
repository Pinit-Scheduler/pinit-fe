import { ensureDeviceId, setAuthTokens } from '@shared/api/authTokens'
import { buildAuthUrl } from '@shared/api/config'
import { httpClient } from '@shared/api/httpClient'
import { refreshAccessTokenFromCookie } from '@shared/api/authSession'

export type AuthProvider = 'naver'

export type LoginResponse = {
  token?: string
  refreshToken?: string
  /** 이메일이 없는 로컬 회원이면 true. 소셜 로그인 응답에는 없을 수 있다. */
  emailRequired?: boolean
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
  /** 정규화한 이메일과 그 이메일로 받은 6자리 코드. 서버 설정과 관계없이 항상 함께 보낸다. */
  email: string
  code: string
}

export type LoginPayload = {
  username: string
  password: string
}

export const buildAuthorizeUrl = (provider: AuthProvider) =>
  buildAuthUrl(`/login/oauth2/authorize/${provider}`)

export const exchangeSocialLogin = async (provider: AuthProvider, payload: SocialLoginPayload) => {
  const query = new URLSearchParams()
  if (payload.code) query.set('code', payload.code)
  if (payload.state) query.set('state', payload.state)
  if (payload.accessToken) query.set('access_token', payload.accessToken)
  if (payload.error) query.set('error', payload.error)
  if (payload.errorDescription) query.set('error_description', payload.errorDescription)

  const url = buildAuthUrl(`/login/oauth2/code/${provider}?${query.toString()}`)
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
  const url = buildAuthUrl('/login')
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
  const url = buildAuthUrl('/signup')
  return httpClient<void>(url, {
    method: 'POST',
    json: payload,
    credentials: 'include',
  })
}

export const logout = async () => {
  const url = buildAuthUrl('/logout')
  await httpClient<void>(url, {
    method: 'POST',
    credentials: 'include',
  })
  setAuthTokens({ accessToken: null })
}

export const refreshAccessToken = async () => {
  const token = await refreshAccessTokenFromCookie()
  if (!token) throw new Error('토큰 재발급에 실패했습니다.')
  return { token } satisfies LoginResponse
}
