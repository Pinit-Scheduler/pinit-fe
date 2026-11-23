// 실패 응답의 문구를 읽는 규칙. 웹의 src/shared/api/errorMessage.ts, src/features/spaces/conflicts.ts와 같다.
// 오류 문구는 백엔드가 정한다. 앱은 서버 문구가 없을 때만 자기 문장을 쓴다.

export class ApiError extends Error {
  /** HTTP 상태. 응답을 받지 못했으면(네트워크 오류, 세션 갱신 무응답) 0. */
  status: number
  data: unknown

  constructor(message: string, status: number, data: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.data = data
  }
}

const readMessage = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined

/** 실패 응답 본문의 문구. 본문에 문구가 없으면 빈 문자열이라 화면의 기본 문구가 쓰인다. */
export const getApiErrorMessage = (payload: unknown): string => {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const body = payload as Record<string, unknown>
    const reasons = Array.isArray(body.errors)
      ? body.errors.flatMap((error: unknown) => {
          if (!error || typeof error !== 'object') return []
          const reason = readMessage((error as Record<string, unknown>).reason)
          return reason ? [reason] : []
        })
      : []
    if (reasons.length) return [...new Set(reasons)].join(' ')
    const message = readMessage(body.message)
    if (message) return message
  }
  return ''
}

const isServerResponse = (error: unknown) => {
  if (!error || typeof error !== 'object') return false
  const { status } = error as { status?: unknown }
  return typeof status === 'number' && status >= 400
}

/** 화면에 그대로 보여 줄 서버 문구. 네트워크 오류나 예상하지 못한 예외의 문구는 돌려주지 않는다. */
export const readFailureMessage = (error: unknown): string | undefined =>
  isServerResponse(error) ? readMessage((error as { message?: unknown }).message) : undefined

/**
 * 실패 문구. 서버 문구가 있으면 그대로 쓰고, 없으면 action 문장 뒤에 할 일을 붙인다.
 * 응답이 오지 않았으면 인터넷 연결 확인을, 응답은 왔지만 문구가 없으면 잠시 후 다시 시도를 안내한다.
 */
export const getRequestFailureMessage = (error: unknown, action: string): string => {
  const message = readFailureMessage(error)
  if (message) return message
  return isServerResponse(error)
    ? `${action} 잠시 후 다시 시도해 주세요.`
    : `${action} 인터넷 연결을 확인한 뒤 다시 시도해 주세요.`
}

/** 다른 참여자가 먼저 바꿔 버전이 어긋난 409. */
export const isEditConflict = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false
  const { status, data } = error as { status?: unknown; data?: unknown }
  if (status !== 409) return false
  const body = (data ?? {}) as { code?: unknown; errorCode?: unknown; type?: unknown }
  return /VERSION|OPTIMISTIC|STALE/i.test(String(body.code ?? body.errorCode ?? body.type ?? ''))
}

/** 목록·카드에서 난 409 안내. 화면은 최신 내용을 다시 받고, 자동으로 다시 보내지 않는다. */
export const conflictReloadedMessage = (error: unknown): string => {
  const message = readFailureMessage(error)
  return message
    ? `${message} 최신 내용을 다시 불러왔어요.`
    : '다른 참여자가 먼저 수정했어요. 최신 내용을 다시 불러왔으니 확인한 뒤 다시 해 주세요.'
}
