import { API_BASE_URL, AUTH_BASE_URL, buildAuthUrl, buildUrl } from './config'
import { getAccessToken, isAccessTokenExpired, setAuthTokens } from './authTokens'
import { createCookieTokenRefresher, debugLog } from './httpClientHelpers'

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
}

export const httpClient = async <T>(path: string, options: HttpClientOptions = {}): Promise<T> => {
  const { json, headers, credentials, ...rest } = options
  const url = path.startsWith('http') ? path : buildUrl(API_BASE_URL, path)
  let accessToken = getAccessToken()
  const body = json ? JSON.stringify(json) : undefined

  const tryRefreshToken = createCookieTokenRefresher(buildAuthUrl, (token) => {
    setAuthTokens({ accessToken: token })
    accessToken = token
  })

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
    setAuthTokens({ accessToken: null })
    accessToken = null
    const refreshed = await tryRefreshToken()
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
      // 서버에서 거부한 액세스 토큰은 바로 제거
      setAuthTokens({ accessToken: null })
      accessToken = null
      const refreshed = await tryRefreshToken()
      if (refreshed) {
        accessToken = refreshed
        response = await performFetch(refreshed)
      }
    }

    // 응답 로깅
    debugLog(`📥 [${new Date().toISOString()}] API Response:`, {
      status: response.status,
      statusText: response.statusText,
      url
    })

    if (!response.ok) {
      let payload: unknown
      const cloned = response.clone()
      try {
        payload = await cloned.json()
      } catch {
        try {
          payload = await cloned.text()
        } catch {
          payload = null
        }
      }
      console.error(`❌ API Error:`, { status: response.status, url, payload })
      throw new ApiError(
        `API 요청 실패: ${response.status} ${response.statusText}`,
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
      sampleData: Array.isArray(data) && data.length > 0 ? data[0] : data
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
