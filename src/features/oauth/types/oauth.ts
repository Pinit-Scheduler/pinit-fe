/** GET /oauth/authorize/requests/{id}: 동의 화면 표시용 pending authorization 요약 */
export type OAuthAuthorizationRequest = {
  requestId: string
  clientName: string
  clientId: string
  redirectHost: string
  localhostRedirect: boolean
  /** 기본으로 허용할 scope */
  requestedScopes: string[]
  /** ADR-0014: 체크 해제 상태로 보여 주고 사용자가 체크해야만 허용하는 scope(예: mcp:delete). 이전 백엔드는 보내지 않는다. */
  optInScopes?: string[]
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

/**
 * GET /v2/oauth/grants 항목: 사용자가 동의한 AI 클라이언트. 같은 client의 활성 grant는 한 항목으로 묶이고,
 * grantId를 DELETE하면 그 client의 연결(기기)이 모두 끊긴다.
 */
export type OAuthGrant = {
  grantId: number | string
  clientName: string
  clientId: string
  scopes: string[]
  createdAt: string
  lastUsedAt: string | null
  /** 묶인 활성 grant(기기) 수. 묶기 이전 백엔드는 보내지 않는다. */
  connectionCount?: number
}
