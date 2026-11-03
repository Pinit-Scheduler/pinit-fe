import { API_BASE_URL, AUTH_BASE_URL, buildUrl } from './config'
import { getAccessToken, getTokenSubject, isAccessTokenExpired, setAuthTokens } from './authTokens'
import { debugLog } from './httpClientHelpers'
import { refreshAccessTokenFromCookie } from './authSession'
import { getApiErrorMessage } from './errorMessage'

// 앱 시작 시 설정 확인
debugLog('🔌 API Configuration:', {
  apiBaseUrl: API_BASE_URL,
  authBaseUrl: AUTH_BASE_URL,
  timestamp: new Date().toISOString()
})

export class ApiError extends Error {
  status: number
  data: unknown
  url: string

  constructor(message: string, status: number, data: unknown, url: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.data = data
    this.url = url
  }
}

export type HttpClientOptions = RequestInit & {
  json?: unknown
  /** 응답 본문에 비밀값(예: OAuth authorization code가 담긴 redirectUri)이 있어 성공 응답 데이터를 로그에 남기지 않는다. */
  sensitiveResponse?: boolean
}

export const httpClient = async <T>(path: string, options: HttpClientOptions = {}): Promise<T> => {
  const { json, headers, credentials, sensitiveResponse, ...rest } = options
  const url = path.startsWith('http') ? path : buildUrl(API_BASE_URL, path)
  let accessToken = getAccessToken()
  const body = json ? JSON.stringify(json) : undefined

  let refreshAttempted = false
  const sameActor = (next: string) => !accessToken || next === accessToken ||
    (getTokenSubject(accessToken) !== null && getTokenSubject(accessToken) === getTokenSubject(next))

  const performFetch = async (token?: string) => {
    const nextToken = token ?? accessToken
    const nextAuth = nextToken ? { Authorization: `Bearer ${nextToken}` } : undefined
    return fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...nextAuth,
        ...headers,
      },
      body,
      credentials: credentials || 'include',
      ...rest,
    })
  }

  const ensureValidAccessToken = async () => {
    if (!accessToken) return null
    if (!isAccessTokenExpired(accessToken)) return accessToken
    debugLog('⌛ Access token expired, refreshing via cookie')
    refreshAttempted = true
    const refreshed = await refreshAccessTokenFromCookie()
    if (!refreshed || !sameActor(refreshed)) {
      if (getAccessToken() === accessToken) setAuthTokens({ accessToken: null })
      throw new ApiError('로그인이 필요합니다. 다시 로그인해 주세요.', 401, null, url)
    }
    return refreshed
  }

  const ensuredToken = await ensureValidAccessToken()
  if (ensuredToken) {
    accessToken = ensuredToken
  }

  // 요청 로깅
  debugLog(`📡 [${new Date().toISOString()}] API Request:`, {
    method: options.method || 'GET',
    url,
    body: json || undefined,
    hasAuthHeader: !!accessToken
  })

  try {
    let response = await performFetch()

    // 401일 때 refresh 토큰이 있으면 /refresh 요청 후 한 번만 재시도
    if (response.status === 401) {
      const current = getAccessToken()
      // A delayed 401 must not erase or refresh a token already renewed by another request.
      let refreshed: string | null = null
      if (current && current !== accessToken && !isAccessTokenExpired(current)) {
        if (sameActor(current)) refreshed = current
      } else if (!refreshAttempted && current === accessToken) {
        refreshAttempted = true
        refreshed = await refreshAccessTokenFromCookie()
        if (refreshed && !sameActor(refreshed)) refreshed = null
      }
      if (refreshed) {
        accessToken = refreshed
        response = await performFetch(refreshed)
      }
      if (response.status === 401 && accessToken && getAccessToken() === accessToken) {
        setAuthTokens({ accessToken: null })
      }
    }

    // 응답 로깅
    debugLog(`📥 [${new Date().toISOString()}] API Response:`, {
      status: response.status,
      statusText: response.statusText,
      url
    })

    if (!response.ok) {
      let payload: unknown = null
      try {
        const rawPayload = await response.text()
        try {
          payload = JSON.parse(rawPayload)
        } catch {
          payload = rawPayload
        }
      } catch { /* 응답 본문을 읽지 못하면 기본 오류 메시지를 사용 */ }
      console.error(`❌ API Error:`, { status: response.status, url, payload })
      throw new ApiError(
        getApiErrorMessage(payload),
        response.status,
        payload,
        url
      )
    }

    if (response.status === 204) {
      debugLog(`✅ Success (No Content):`, url)
      return undefined as T
    }

    const rawBody = await response.text()
    if (!rawBody) {
      debugLog(`✅ Success (Empty Body):`, url)
      return undefined as T
    }

    const contentType = response.headers.get('content-type') || ''
    const data = contentType.includes('application/json')
      ? (JSON.parse(rawBody) as T)
      : (rawBody as unknown as T)

    debugLog(`✅ Success:`, {
      url,
      dataType: Array.isArray(data) ? `Array[${data.length}]` : typeof data,
      sampleData: sensitiveResponse ? '[redacted]' : Array.isArray(data) && data.length > 0 ? data[0] : data
    })
    return data
  } catch (error) {
    if (error instanceof ApiError) {
      console.error('🔥 API Error caught:', {
        message: error.message,
        status: error.status,
        url: error.url,
        data: error.data,
      })
      throw error
    }
    console.error(`🔥 Network Error:`, { url, error })
    throw new ApiError(
      error instanceof Error ? error.message : '네트워크 오류',
      0,
      error,
      url
    )
  }
}
