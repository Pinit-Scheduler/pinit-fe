import { API_BASE_URL, AUTH_BASE_URL, buildAuthUrl, buildUrl } from './config'
import { getAccessToken, isAccessTokenExpired, setAuthTokens } from './authTokens'

let refreshInFlight: Promise<string | null> | null = null
let lastRefreshAttempt = 0

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// 앱 시작 시 설정 확인
console.log('🔌 API Configuration:', {
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

  const tryRefreshToken = async () => {
    if (refreshInFlight) return refreshInFlight

    const now = Date.now()
    const elapsed = now - lastRefreshAttempt
    const waitMs = elapsed >= 1000 ? 0 : 1000 - elapsed

    refreshInFlight = (async () => {
      if (waitMs > 0) {
        await sleep(waitMs)
      }
      lastRefreshAttempt = Date.now()
      try {
        const refreshUrl = buildAuthUrl('/refresh')
        console.log('🔄 Attempting token refresh...')
        const response = await fetch(refreshUrl, {
          method: 'POST',
          credentials: 'include',
        })
        if (!response.ok) {
          console.warn('⚠️ Refresh request failed:', { status: response.status })
          return null
        }
        const data = await response.json() as { token?: string | null; refreshToken?: string | null }
        const nextAccess = data?.token ?? null
        setAuthTokens({ accessToken: nextAccess })
        accessToken = nextAccess
        if (nextAccess) {
          console.log('✅ Token refreshed successfully')
          return nextAccess
        }
        console.warn('⚠️ Refresh response missing access token')
        return null
      } catch (error) {
        console.error('🔥 Refresh request errored:', error)
        return null
      } finally {
        refreshInFlight = null
      }
    })()

    return refreshInFlight
  }

  const ensureValidAccessToken = async () => {
    if (!accessToken) return null
    if (!isAccessTokenExpired(accessToken)) return accessToken
    console.log('⌛ Access token expired, refreshing via cookie')
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
  console.log(`📡 [${new Date().toISOString()}] API Request:`, {
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
    console.log(`📥 [${new Date().toISOString()}] API Response:`, {
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
      console.log(`✅ Success (No Content):`, url)
      return undefined as T
    }

    const rawBody = await response.text()
    if (!rawBody) {
      console.log(`✅ Success (Empty Body):`, url)
      return undefined as T
    }

    const contentType = response.headers.get('content-type') || ''
    const data = contentType.includes('application/json')
      ? (JSON.parse(rawBody) as T)
      : (rawBody as unknown as T)

    console.log(`✅ Success:`, {
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
