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

/** 서버 응답이 아니라 FE가 직접 판단한 실패(버전 정보 없음, 응답이 요청과 맞지 않음 등). 화면에 문구를 그대로 보여 준다. */
export class ClientGuardError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ClientGuardError'
  }
}

const isServerResponse = (error: unknown) => {
  const status = error && typeof error === 'object' ? (error as { status?: unknown }).status : undefined
  return typeof status === 'number' && status >= 400
}

/**
 * 화면에 그대로 보여 줄 실패 문구. 서버가 응답한 실패(HTTP 상태가 400 이상인 ApiError)의 문구와
 * ClientGuardError의 안내 문구가 해당한다. 오류 문구는 백엔드가 정하므로 서버 문구를 상태 코드로 거르지 않는다.
 * 네트워크 오류(status 0)의 브라우저 영문 문구나 예상하지 못한 예외의 문구는 돌려주지 않는다.
 * httpClient가 이 모듈을 가져오므로 ApiError를 import하지 않고 status 필드로 판별한다.
 * 테스트가 모듈을 서로 다른 vm 컨텍스트에서 불러오므로 ClientGuardError도 instanceof가 아니라 name으로 판별한다.
 */
export const readFailureMessage = (error: unknown): string | undefined => {
  if (!error || typeof error !== 'object') return undefined
  const { name, message } = error as { name?: unknown; message?: unknown }
  return name === 'ClientGuardError' || isServerResponse(error) ? readMessage(message) : undefined
}

type FailureMessageOptions = {
  /** '다시 시도해 주세요' 앞에 들어갈 다시 시도할 곳. 예: '설정 → 휴지통에서' */
  retryFrom?: string
}

/**
 * 실패 문구. readFailureMessage가 있으면 그대로 쓰고, 없으면 action 문장 뒤에 할 일을 붙인다.
 * 응답이 오지 않았으면(네트워크 오류, 예상하지 못한 예외) 인터넷 연결 확인을, 응답은 왔지만 문구가 없으면 잠시 후 다시 시도를 안내한다.
 */
export const getRequestFailureMessage = (
  error: unknown,
  action: string,
  { retryFrom }: FailureMessageOptions = {},
): string => {
  const message = readFailureMessage(error)
  if (message) return message
  const retry = retryFrom ? `${retryFrom} 다시 시도해 주세요.` : '다시 시도해 주세요.'
  return isServerResponse(error)
    ? `${action} 잠시 후 ${retry}`
    : `${action} 인터넷 연결을 확인한 뒤 ${retry}`
}
