export const READ_SCOPE = 'mcp:read'
export const WRITE_SCOPE = 'mcp:write'

export type ConsentScopeOption = {
  scope: string
  label: string
  required: boolean
}

const SCOPE_LABELS: Record<string, string> = {
  [READ_SCOPE]: '일정·작업 보기',
  [WRITE_SCOPE]: '일정·작업 만들기·수정·상태 변경 (삭제는 불가)',
}

export const describeScope = (scope: string) => SCOPE_LABELS[scope] ?? scope

/**
 * 동의 화면 체크박스. 읽기는 항상 필요(mcp:write가 mcp:read를 포함하는 백엔드 규칙과 같음)하고,
 * 쓰기는 요청됐을 때만 보여 주며 해제할 수 있다. 지원하지 않는 scope는 표시하지도 허용하지도 않는다.
 */
export const buildConsentScopeOptions = (requestedScopes: readonly string[]): ConsentScopeOption[] => {
  const options: ConsentScopeOption[] = [{ scope: READ_SCOPE, label: describeScope(READ_SCOPE), required: true }]
  if (requestedScopes.includes(WRITE_SCOPE)) {
    options.push({ scope: WRITE_SCOPE, label: describeScope(WRITE_SCOPE), required: false })
  }
  return options
}

export const getUnsupportedScopes = (requestedScopes: readonly string[]) =>
  requestedScopes.filter((scope) => !(scope in SCOPE_LABELS))

/** decision API에 보낼 scope. 읽기는 항상 포함하고 쓰기는 사용자가 체크했을 때만 넣는다. */
export const toDecisionScopes = (requestedScopes: readonly string[], includeWrite: boolean) =>
  buildConsentScopeOptions(requestedScopes)
    .filter((option) => option.required || (option.scope === WRITE_SCOPE && includeWrite))
    .map((option) => option.scope)

export const hasWriteScope = (scopes: readonly string[]) => scopes.includes(WRITE_SCOPE)

/** 서버가 준 redirectUri로만 이동하되, javascript: 같은 스킴은 막는다. */
export const isNavigableRedirectUri = (uri: unknown): uri is string => {
  if (typeof uri !== 'string' || !uri) return false
  try {
    const { protocol } = new URL(uri)
    return protocol === 'https:' || protocol === 'http:'
  } catch {
    return false
  }
}

export const isRequestExpired = (expiresAt: string, now: number = Date.now()) => {
  const expiry = Date.parse(expiresAt)
  return Number.isNaN(expiry) || expiry <= now
}

export type ConsentErrorKind = 'expired' | 'unauthorized' | 'network' | 'unknown'

export type ConsentError = {
  kind: ConsentErrorKind
  message: string
}

const readStatus = (error: unknown) => {
  const status = error && typeof error === 'object' ? (error as { status?: unknown }).status : undefined
  return typeof status === 'number' ? status : undefined
}

const readMessage = (error: unknown) => {
  const message = error && typeof error === 'object' ? (error as { message?: unknown }).message : undefined
  return typeof message === 'string' && message.trim() ? message : undefined
}

export const EXPIRED_REQUEST_MESSAGE =
  '연결 요청이 만료됐거나 찾을 수 없어요. AI 클라이언트에서 연결을 다시 시작해주세요.'

// ApiError(status 0 = fetch 실패)를 import 없이 구조로 판별한다.
export const toConsentError = (error: unknown): ConsentError => {
  const status = readStatus(error)
  if (status === 404 || status === 410) return { kind: 'expired', message: EXPIRED_REQUEST_MESSAGE }
  if (status === 401) return { kind: 'unauthorized', message: '로그인이 만료됐어요. 다시 로그인한 뒤 이어서 진행해주세요.' }
  if (status === 0) {
    return { kind: 'network', message: '서버에 연결하지 못했어요. 네트워크 상태를 확인한 뒤 다시 시도해주세요.' }
  }
  return { kind: 'unknown', message: readMessage(error) ?? '요청을 처리하지 못했어요. 잠시 후 다시 시도해주세요.' }
}
