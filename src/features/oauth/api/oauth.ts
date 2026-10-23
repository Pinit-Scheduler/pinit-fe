import { buildApiUrl } from '@shared/api/config'
import { httpClient } from '@shared/api/httpClient'
import type {
  OAuthAuthorizationRequest,
  OAuthDecisionRequest,
  OAuthDecisionResponse,
  OAuthGrant,
} from '../types/oauth'

// 동의 API는 버전 prefix 없이 issuer(API host) 루트의 /oauth 아래에 있다.
const buildOAuthUrl = (path: string) => buildApiUrl(`/oauth${path}`, '')

export const fetchAuthorizationRequest = (requestId: string) =>
  httpClient<OAuthAuthorizationRequest>(buildOAuthUrl(`/authorize/requests/${encodeURIComponent(requestId)}`))

// 응답의 redirectUri에 1회용 authorization code가 담기므로 디버그 로그에 남기지 않는다.
export const submitAuthorizationDecision = (decision: OAuthDecisionRequest) =>
  httpClient<OAuthDecisionResponse>(buildOAuthUrl('/authorize/decision'), {
    method: 'POST',
    json: decision,
    sensitiveResponse: true,
  })

const GRANTS_API_VERSION = 'v2'

export const fetchOAuthGrants = () => httpClient<OAuthGrant[]>(buildApiUrl('/oauth/grants', GRANTS_API_VERSION))

export const revokeOAuthGrant = (grantId: OAuthGrant['grantId']) =>
  httpClient<void>(buildApiUrl(`/oauth/grants/${encodeURIComponent(String(grantId))}`, GRANTS_API_VERSION), {
    method: 'DELETE',
  })
