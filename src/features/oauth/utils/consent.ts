import { readFailureMessage } from '@shared/api/errorMessage'

export const READ_SCOPE = 'mcp:read'
export const WRITE_SCOPE = 'mcp:write'
export const DELETE_SCOPE = 'mcp:delete'

export type ConsentScopeOption = {
  scope: string
  label: string
  required: boolean
  /** 동의 화면을 처음 열었을 때 체크 여부. 필수 scope는 항상 체크돼 있다. */
  defaultChecked: boolean
  /** 체크 전에 알려야 하는 위험 안내 */
  warning?: string
  /** 이 화면이 모르는 scope(서버에 새로 추가된 권한 등). 이름을 그대로 보여 준다. */
  unknown?: boolean
}

type KnownScope = Omit<ConsentScopeOption, 'scope' | 'unknown'>

const KNOWN_SCOPES: Record<string, KnownScope> = {
  [READ_SCOPE]: {
    label: '개인·공유 스페이스의 일정·작업·프로젝트·참여자 보기',
    required: true,
    defaultChecked: true,
  },
  [WRITE_SCOPE]: {
    label: '개인·공유 스페이스의 내용 만들기·수정·상태 변경 (삭제는 불가)',
    required: false,
    defaultChecked: true,
  },
  // 요청돼도 기본은 해제. 사용자가 직접 체크해야만 허용한다.
  [DELETE_SCOPE]: {
    label: '스페이스·프로젝트·일정·작업 삭제 및 초대 철회·참여자 제외 (미리보기 후 확인)',
    required: false,
    defaultChecked: false,
    warning:
      '삭제·초대 철회·참여자 제외·스페이스 나가기는 미리보기를 확인한 뒤에만 실행돼요. 영구 삭제와 반복 범위 삭제는 되돌릴 수 없어요.',
  },
}

const KNOWN_SCOPE_ORDER = [READ_SCOPE, WRITE_SCOPE, DELETE_SCOPE]

const normalizeScopes = (scopes: readonly string[] | null | undefined) =>
  new Set(
    (Array.isArray(scopes) ? scopes : [])
      .map((scope) => scope.trim())
      .filter(Boolean),
  )

/**
 * 동의 화면 체크박스. 읽기는 항상 필요(쓰기·삭제가 읽기를 포함하는 백엔드 규칙과 같음)하고,
 * `requestedScopes`의 쓰기·삭제는 요청됐을 때만 보여 준다. `optInScopes`(ADR-0014, 예: mcp:delete)는
 * 항상 체크 해제로 시작하고, 모르는 scope는 이름 그대로 체크 해제 상태로 보여 준다.
 * 백엔드가 `optInScopes`를 보내지 않으면(이전 버전) 빈 목록으로 본다.
 */
export const buildConsentScopeOptions = (
  requestedScopes: readonly string[],
  optInScopes: readonly string[] | null = [],
): ConsentScopeOption[] => {
  const optIn = normalizeScopes(optInScopes)
  const offered = new Set([...normalizeScopes(requestedScopes), ...optIn])
  const toOption = (scope: string): ConsentScopeOption => {
    const known = KNOWN_SCOPES[scope]
    const base = known
      ? { scope, ...known }
      : {
          scope,
          label: scope,
          required: false,
          defaultChecked: false,
          unknown: true,
        }
    // opt-in scope는 사용자가 직접 체크해야만 허용한다.
    return optIn.has(scope) && !base.required
      ? { ...base, defaultChecked: false }
      : base
  }
  const known = KNOWN_SCOPE_ORDER.filter(
    (scope) => scope === READ_SCOPE || offered.has(scope),
  ).map(toOption)
  const unknown = [...offered]
    .filter((scope) => !(scope in KNOWN_SCOPES))
    .map(toOption)
  return [...known, ...unknown]
}

/** 처음 체크돼 있을 선택 scope 목록 */
export const getDefaultSelectedScopes = (
  requestedScopes: readonly string[],
  optInScopes: readonly string[] | null = [],
) =>
  buildConsentScopeOptions(requestedScopes, optInScopes)
    .filter((option) => !option.required && option.defaultChecked)
    .map((option) => option.scope)

/**
 * decision API에 보낼 scope. 백엔드는 `scopes`가 없으면 `requestedScopes`만 주므로 항상 명시적으로 보낸다.
 * 필수 scope는 항상, 선택 scope는 화면에 보였고 사용자가 체크했을 때만 넣는다.
 */
export const toDecisionScopes = (
  requestedScopes: readonly string[],
  optInScopes: readonly string[] | null,
  selectedScopes: Iterable<string>,
) => {
  const selected = new Set(selectedScopes)
  return buildConsentScopeOptions(requestedScopes, optInScopes)
    .filter((option) => option.required || selected.has(option.scope))
    .map((option) => option.scope)
}

export const hasDeleteScope = (scopes: readonly string[]) =>
  scopes.includes(DELETE_SCOPE)

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

export const isRequestExpired = (
  expiresAt: string,
  now: number = Date.now(),
) => {
  const expiry = Date.parse(expiresAt)
  return Number.isNaN(expiry) || expiry <= now
}

export type ConsentErrorKind =
  | 'expired'
  | 'unauthorized'
  | 'network'
  | 'unknown'

export type ConsentError = {
  kind: ConsentErrorKind
  message: string
}

const readStatus = (error: unknown) => {
  const status =
    error && typeof error === 'object'
      ? (error as { status?: unknown }).status
      : undefined
  return typeof status === 'number' ? status : undefined
}

export const EXPIRED_REQUEST_MESSAGE =
  '연결 요청이 만료됐거나 찾을 수 없어요. AI 클라이언트에서 연결을 다시 시작해 주세요.'

/**
 * 상태 코드는 화면 흐름(kind)만 정한다. 서버가 문구를 보냈으면 그 문구를 쓰고, 없을 때만 아래 문장을 쓴다.
 * ApiError(status 0 = fetch 실패)를 import 없이 구조로 판별한다.
 */
export const toConsentError = (error: unknown): ConsentError => {
  const status = readStatus(error)
  const kind: ConsentErrorKind =
    status === 404 || status === 410
      ? 'expired'
      : status === 401
        ? 'unauthorized'
        : status === 0
          ? 'network'
          : 'unknown'
  const fallback = {
    expired: EXPIRED_REQUEST_MESSAGE,
    unauthorized: '로그인이 만료됐어요. 다시 로그인한 뒤 이어서 진행해 주세요.',
    network: '서버에 연결하지 못했어요. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.',
    unknown: '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.',
  }[kind]
  return { kind, message: readFailureMessage(error) ?? fallback }
}
