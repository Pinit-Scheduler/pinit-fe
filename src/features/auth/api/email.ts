import { buildAuthUrl } from '@shared/api/config'
import { httpClient } from '@shared/api/httpClient'

// 이메일 인증 코드 API(이메일 인증·비밀번호 찾기 설계 §7). 코드 받기는 가입 여부와 관계없이 항상 202다.

/** 로그인 없이 받는 코드의 목적. 기존 회원 등록(REGISTER)은 로그인한 회원 API를 쓴다. */
export type EmailCodePurpose = 'SIGNUP' | 'PASSWORD_RESET'

export type PasswordResetPayload = {
  email: string
  code: string
  newPassword: string
}

export type EmailRegistrationPayload = {
  email: string
  code: string
}

export const requestEmailCode = (email: string, purpose: EmailCodePurpose) =>
  httpClient<void>(buildAuthUrl('/email-codes'), {
    method: 'POST',
    json: { email, purpose },
    credentials: 'include',
  })

/** 성공하면 재설정 전에 발급된 로그인 세션은 모두 끊긴다. 새 세션은 주지 않으므로 다시 로그인한다. */
export const resetPassword = (payload: PasswordResetPayload) =>
  httpClient<void>(buildAuthUrl('/password-reset'), {
    method: 'POST',
    json: payload,
    credentials: 'include',
  })

export const requestMyEmailCode = (email: string) =>
  httpClient<void>(buildAuthUrl('/me/email-codes'), {
    method: 'POST',
    json: { email },
    credentials: 'include',
  })

export const registerMyEmail = (payload: EmailRegistrationPayload) =>
  httpClient<void>(buildAuthUrl('/me/email'), {
    method: 'POST',
    json: payload,
    credentials: 'include',
  })
