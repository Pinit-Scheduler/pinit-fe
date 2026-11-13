// 이메일 코드 요청·제출 실패를 화면 문구로 바꾼다(이메일 인증·비밀번호 찾기 설계 §7·§12).
// 서버 문구가 있으면 그대로 쓰고, 없을 때만 상태 코드별 기본 문구를 쓴다.

/** send: 코드 받기, submit: 코드를 실은 가입·재설정·등록 요청 */
export type EmailAuthStage = 'send' | 'submit'

export type EmailAuthFailure = {
  message: string
  /** 받은 코드를 더 쓸 수 없어 새 코드를 받아야 한다(409: 코드는 소비됐지만 저장이 충돌함). */
  requiresNewCode: boolean
}

export const EMAIL_AUTH_MESSAGES = {
  network: '서버에 연결하지 못했어요. 네트워크를 확인하고 다시 시도해 주세요.',
  invalid: '입력한 내용을 다시 확인해 주세요.',
  conflict: '처리하는 동안 다른 요청과 겹쳤어요. 새 코드를 받아 다시 시도해 주세요.',
  tooMany: '요청이 너무 많아요. 잠시 후 다시 시도해 주세요.',
  mailFailed: '메일을 보내지 못했어요. 잠시 후 다시 시도해 주세요.',
  unavailable: '지금은 처리할 수 없어요. 잠시 후 다시 시도해 주세요.',
  unknown: '요청을 처리하지 못했어요. 다시 시도해 주세요.',
} as const

// httpClient의 ApiError(status, message)를 모양으로 읽는다.
const readField = (error: unknown, key: 'status' | 'message'): unknown =>
  error && typeof error === 'object' ? (error as Record<string, unknown>)[key] : undefined

// 서버가 코드를 이미 쓴 뒤 실패한 400에 붙이는 안내(비밀번호 재설정에서 새 비밀번호가 현재와 같음).
// 상태 코드만으로는 다른 400과 구별되지 않아 문구로 판단한다(auth PasswordResetService·EmailConflictException).
const NEW_CODE_HINT = '새 인증 코드'

const readStatus = (error: unknown): number | null => {
  const status = readField(error, 'status')
  return typeof status === 'number' ? status : null
}

// httpClient는 서버 문구가 없으면 빈 문구를 넣는다. 그 경우는 서버 문구가 없는 것으로 본다.
const readServerMessage = (error: unknown): string | null => {
  const message = readField(error, 'message')
  if (typeof message !== 'string') return null
  const trimmed = message.trim()
  return trimmed || null
}

export const describeEmailAuthError = (error: unknown, stage: EmailAuthStage): EmailAuthFailure => {
  const status = readStatus(error)
  const serverMessage = readServerMessage(error)
  const failure = (fallback: string, requiresNewCode = false): EmailAuthFailure => ({
    message: serverMessage ?? fallback,
    requiresNewCode,
  })

  switch (status) {
    case 0:
      // 서버 응답 없이 실패했다. 이때 message는 브라우저 문구("Failed to fetch")라 보여 주지 않는다.
      return { message: EMAIL_AUTH_MESSAGES.network, requiresNewCode: false }
    case 400:
      // 코드 틀림·만료(서버가 한 문구로 응답), 입력 규칙 위반, 아이디 중복 등. 서버 문구가 이유를 말한다.
      return failure(
        EMAIL_AUTH_MESSAGES.invalid,
        stage === 'submit' && serverMessage !== null && serverMessage.includes(NEW_CODE_HINT),
      )
    case 409:
      return failure(EMAIL_AUTH_MESSAGES.conflict, true)
    case 429:
      return failure(EMAIL_AUTH_MESSAGES.tooMany)
    case 503:
      // 코드 받기의 503은 메일 발송 실패다. 제출의 503은 코드 저장소 장애라 메일 문구를 쓰지 않는다.
      return failure(stage === 'send' ? EMAIL_AUTH_MESSAGES.mailFailed : EMAIL_AUTH_MESSAGES.unavailable)
    default:
      return failure(EMAIL_AUTH_MESSAGES.unknown)
  }
}
