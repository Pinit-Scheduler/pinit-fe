import type {
  CreatePersonalAccessTokenRequest,
  CreatedPersonalAccessToken,
  PersonalAccessToken,
  PersonalAccessTokenAccess,
  PersonalAccessTokenScope,
  PersonalAccessTokenStatus,
} from '../types/personalAccessToken'

// 백엔드 정책(pinit.auth.personal-access-token.*)과 같은 값
export const MAX_ACTIVE_PERSONAL_ACCESS_TOKENS = 10
export const MAX_TOKEN_NAME_LENGTH = 100
export const DEFAULT_EXPIRY_DAYS = 90
export const MAX_EXPIRY_DAYS = 365
export const EXPIRY_DAY_OPTIONS = [30, 90, 180, 365] as const

export const CONFLICT_MESSAGE_PREFIX = '현재 상태에서는 이 동작을 할 수 없어요.'

export type CreatePersonalAccessTokenForm = {
  name: string
  access: PersonalAccessTokenAccess
  expiresInDays: number
}

export type CreatePersonalAccessTokenFormErrors = Partial<Record<'name' | 'expiresInDays', string>>

// 평문 토큰 형식: pinit_pat_<prefix 12자>_<secret>. 목록에는 prefix만 내려온다.
export const PLAINTEXT_TOKEN_PREFIX = 'pinit_pat_'

export const formatTokenHint = (tokenPrefix: string) => `${PLAINTEXT_TOKEN_PREFIX}${tokenPrefix}_…`

export const scopesForAccess =(access: PersonalAccessTokenAccess): PersonalAccessTokenScope[] =>
  access === 'write' ? ['mcp:read', 'mcp:write'] : ['mcp:read']

export const accessFromScopes = (scopes: readonly string[]): PersonalAccessTokenAccess =>
  scopes.includes('mcp:write') ? 'write' : 'read'

// 백엔드 PersonalAccessToken.isActive와 동일: 폐기되지 않았고 만료 시각이 지금보다 뒤
export const getTokenStatus = (
  token: Pick<PersonalAccessToken, 'expiresAt' | 'revokedAt'>,
  now: number = Date.now(),
): PersonalAccessTokenStatus => {
  if (token.revokedAt) return 'revoked'
  const expiresAt = Date.parse(token.expiresAt)
  if (Number.isNaN(expiresAt) || expiresAt <= now) return 'expired'
  return 'active'
}

export const countActiveTokens = (tokens: readonly PersonalAccessToken[], now: number = Date.now()) =>
  tokens.filter((token) => getTokenStatus(token, now) === 'active').length

export const validateCreateForm = (form: CreatePersonalAccessTokenForm): CreatePersonalAccessTokenFormErrors => {
  const errors: CreatePersonalAccessTokenFormErrors = {}
  const name = form.name.trim()
  if (!name) {
    errors.name = '토큰 이름을 입력해주세요.'
  } else if (name.length > MAX_TOKEN_NAME_LENGTH) {
    errors.name = `토큰 이름은 ${MAX_TOKEN_NAME_LENGTH}자 이하여야 해요.`
  }
  if (!Number.isInteger(form.expiresInDays) || form.expiresInDays < 1 || form.expiresInDays > MAX_EXPIRY_DAYS) {
    errors.expiresInDays = `만료 기간은 1일 이상 ${MAX_EXPIRY_DAYS}일 이하로 선택해주세요.`
  }
  return errors
}

export const toCreateRequest = (form: CreatePersonalAccessTokenForm): CreatePersonalAccessTokenRequest => ({
  name: form.name.trim(),
  scopes: scopesForAccess(form.access),
  expiresInDays: form.expiresInDays,
})

// 목록 상태에는 평문 토큰을 남기지 않고 메타데이터만 보관한다.
export const toTokenMetadata = (created: CreatedPersonalAccessToken): PersonalAccessToken => ({
  id: created.id,
  name: created.name,
  tokenPrefix: created.tokenPrefix,
  scopes: created.scopes,
  createdAt: created.createdAt,
  expiresAt: created.expiresAt,
  lastUsedAt: null,
  revokedAt: null,
})

// ApiError(status, message)를 import 없이 구조로 판별한다.
const readStatus = (error: unknown) => {
  const status = error && typeof error === 'object' ? (error as { status?: unknown }).status : undefined
  return typeof status === 'number' ? status : undefined
}

const readMessage = (error: unknown, fallback: string) => {
  const message = error && typeof error === 'object' ? (error as { message?: unknown }).message : undefined
  return typeof message === 'string' && message.trim() ? message : fallback
}

export const toCreateErrorMessage = (error: unknown) => {
  const message = readMessage(error, '토큰을 발급하지 못했어요.')
  return readStatus(error) === 409 ? `${CONFLICT_MESSAGE_PREFIX} ${message}` : message
}

export const toRevokeErrorMessage = (error: unknown) =>
  readStatus(error) === 404
    ? '토큰을 찾을 수 없어요. 목록을 새로 불러왔어요.'
    : readMessage(error, '토큰을 폐기하지 못했어요.')
