// 서버가 문구를 주지 않았을 때 쓰는 기본 문구. 호출부가 서버 문구 여부를 구분할 때도 쓴다.
export const DEFAULT_API_ERROR_MESSAGE = '요청을 처리하지 못했습니다. 다시 시도해주세요.'

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

  return DEFAULT_API_ERROR_MESSAGE
}
