import { normalizeEmail } from './accountRules'

// 인증 코드 받기 상태(이메일 인증·비밀번호 찾기 설계 §6·§8). 화면은 "코드 받기 → 코드를 실은 실제 요청" 두 단계다.
// 서버는 IP·이메일별로 60초에 한 번만 보내므로, 화면도 보낸 뒤 60초 동안 다시 받기를 막는다.
export const EMAIL_CODE_RESEND_SECONDS = 60

export type EmailCodeFlow = {
  /** 마지막으로 코드를 보낸 정규화한 이메일. 없으면 아직 보내지 않았거나 새 코드가 필요하다. */
  sentTo: string | null
  /** 마지막으로 보낸 시각(ms). 새 코드가 필요해져도 재전송 대기는 서버 한도를 따라 유지한다. */
  sentAt: number | null
}

export const INITIAL_EMAIL_CODE_FLOW: EmailCodeFlow = { sentTo: null, sentAt: null }

export const markEmailCodeSent = (email: string, now: number): EmailCodeFlow => ({
  sentTo: normalizeEmail(email),
  sentAt: now,
})

/** 받은 코드를 더 쓸 수 없을 때(409 등). 다시 받기 대기 시간은 그대로 둔다. */
export const requireNewEmailCode = (flow: EmailCodeFlow): EmailCodeFlow => ({ ...flow, sentTo: null })

export const isEmailCodeSentTo = (flow: EmailCodeFlow, email: string) =>
  flow.sentTo !== null && flow.sentTo === normalizeEmail(email)

/** 다시 받기까지 남은 초. 0이면 바로 받을 수 있다. */
export const resendWaitSeconds = (flow: EmailCodeFlow, now: number) => {
  if (flow.sentAt === null) return 0
  const remainingMs = flow.sentAt + EMAIL_CODE_RESEND_SECONDS * 1000 - now
  return remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0
}

export const emailCodeButtonLabel = (flow: EmailCodeFlow, waitSeconds: number, isSending: boolean) => {
  if (isSending) return '보내는 중...'
  if (waitSeconds > 0) return `다시 받기 (${waitSeconds}초)`
  return flow.sentAt === null ? '코드 받기' : '코드 다시 받기'
}

export type PasswordResetStep = 'request' | 'verify'

/** 비밀번호 찾기 화면 단계. 코드를 보낸 이메일이 있으면 코드·새 비밀번호를 입력한다. */
export const passwordResetStep = (flow: EmailCodeFlow): PasswordResetStep =>
  flow.sentTo === null ? 'request' : 'verify'
