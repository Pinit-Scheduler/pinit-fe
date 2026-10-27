import { buildAuthUrl } from '@shared/api/config'
import { httpClient } from '@shared/api/httpClient'

// ADR-0022 계정 API. refresh 토큰 쿠키를 주고받으므로 credentials를 항상 포함한다.
export type AccountInfo = {
  /** 소셜 로그인 계정은 아이디가 없다(null). */
  username: string | null
  nickname: string
  socialLogin: boolean
}

export type ChangePasswordPayload = {
  currentPassword: string
  newPassword: string
}

export type WithdrawalPayload = {
  /** 로컬 계정만 보낸다. 소셜 계정은 최근 로그인의 refresh 토큰 쿠키로 재인증한다. */
  password: string | null
  confirmation: string
}

export const fetchAccount = () =>
  httpClient<AccountInfo>(buildAuthUrl('/me/account'), { credentials: 'include' })

export const changePassword = (payload: ChangePasswordPayload) =>
  httpClient<void>(buildAuthUrl('/me/password'), {
    method: 'POST',
    json: payload,
    credentials: 'include',
  })

export const withdrawAccount = (payload: WithdrawalPayload) =>
  httpClient<void>(buildAuthUrl('/me/withdrawal'), {
    method: 'POST',
    json: payload,
    credentials: 'include',
  })
