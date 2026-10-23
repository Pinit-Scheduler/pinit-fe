export type PersonalAccessTokenScope = 'mcp:read' | 'mcp:write'

export type PersonalAccessTokenAccess = 'read' | 'write'

export type PersonalAccessTokenStatus = 'active' | 'expired' | 'revoked'

/** GET /v2/personal-access-tokens 항목. 평문 토큰은 포함하지 않는다. */
export type PersonalAccessToken = {
  id: number
  name: string
  tokenPrefix: string
  scopes: PersonalAccessTokenScope[]
  createdAt: string
  expiresAt: string
  lastUsedAt: string | null
  revokedAt: string | null
}

export type CreatePersonalAccessTokenRequest = {
  name: string
  scopes: PersonalAccessTokenScope[]
  expiresInDays?: number
}

/** POST 응답. `token`은 이 응답에서만 한 번 내려오는 평문 토큰이다. */
export type CreatedPersonalAccessToken = {
  id: number
  name: string
  token: string
  tokenPrefix: string
  scopes: PersonalAccessTokenScope[]
  createdAt: string
  expiresAt: string
}
