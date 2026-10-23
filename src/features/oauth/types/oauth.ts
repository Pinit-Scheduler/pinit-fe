/** GET /oauth/authorize/requests/{id}: 동의 화면 표시용 pending authorization 요약 */
export type OAuthAuthorizationRequest = {
  requestId: string
  clientName: string
  clientId: string
  redirectHost: string
  localhostRedirect: boolean
  requestedScopes: string[]
  expiresAt: string
}

export type OAuthDecisionRequest = {
  requestId: string
  approve: boolean
  scopes: string[]
}

export type OAuthDecisionResponse = {
  redirectUri: string
}

/** GET /v2/oauth/grants 항목: 사용자가 동의한 AI 클라이언트 연결 */
export type OAuthGrant = {
  grantId: number | string
  clientName: string
  clientId: string
  scopes: string[]
  createdAt: string
  lastUsedAt: string | null
}
