import { buildApiUrl } from '@shared/api/config'
import { httpClient } from '@shared/api/httpClient'
import type {
  CreatePersonalAccessTokenRequest,
  CreatedPersonalAccessToken,
  PersonalAccessToken,
} from '../types/personalAccessToken'

const PAT_API_VERSION = 'v2'

const buildPatUrl = (path = '') => buildApiUrl(`/personal-access-tokens${path}`, PAT_API_VERSION)

export const fetchPersonalAccessTokens = () => httpClient<PersonalAccessToken[]>(buildPatUrl())

// 평문 토큰이 디버그 로그에 남지 않도록 응답 로깅을 끈다.
export const createPersonalAccessToken = (request: CreatePersonalAccessTokenRequest) =>
  httpClient<CreatedPersonalAccessToken>(buildPatUrl(), {
    method: 'POST',
    json: request,
    sensitiveResponse: true,
  })

export const revokePersonalAccessToken = (id: number) =>
  httpClient<void>(buildPatUrl(`/${id}`), { method: 'DELETE' })
