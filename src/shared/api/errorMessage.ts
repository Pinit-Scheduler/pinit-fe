const readMessage = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined

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

  return '요청을 처리하지 못했습니다. 다시 시도해주세요.'
}

/** FE가 서버에 보내기 전에 막은 경우(버전 정보 없음 등). 화면에 문구를 그대로 보여 준다. */
export class ClientGuardError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ClientGuardError'
  }
}

/**
 * 오류 문구는 백엔드가 정하는 정책이다. 서버가 응답한 실패(HTTP 상태가 400 이상인 ApiError)는 서버 문구를
 * 그대로 보여 준다. FE가 요청 전에 막은 ClientGuardError는 그 안내 문구를 그대로 보여 준다.
 * 그 밖의 경우(네트워크 오류 status 0, 예상하지 못한 예외)만 화면의 기본 문구를 쓴다.
 * 브라우저의 영문 네트워크 오류는 노출하지 않는다.
 * httpClient가 이 모듈을 가져오므로 ApiError를 import하지 않고 status 필드로 판별한다.
 * 테스트가 모듈을 서로 다른 vm 컨텍스트에서 불러오므로 ClientGuardError도 instanceof가 아니라 name으로 판별한다.
 */
export const getRequestFailureMessage = (
  error: unknown,
  fallback: string,
): string => {
  if (!error || typeof error !== 'object') return fallback
  const { name, status, message } = error as {
    name?: unknown
    status?: unknown
    message?: unknown
  }
  if (name === 'ClientGuardError') return readMessage(message) ?? fallback
  if (typeof status !== 'number' || status < 400) return fallback
  return readMessage(message) ?? fallback
}
