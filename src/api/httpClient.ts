import { getAccessToken } from './authTokens'

const API_BASE_URL =
  import.meta.env.PROD && import.meta.env.VITE_API_BASE_URL
    ? import.meta.env.VITE_API_BASE_URL
    : import.meta.env.PROD
      ? 'https://api.pinit.go-gradually.me'
      : 'http://localhost:8080'

// 앱 시작 시 설정 확인
console.log('🔌 API Configuration:', {
  baseUrl: API_BASE_URL,
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
  const url = path.startsWith('http') ? path : `${API_BASE_URL}${path}`
  const accessToken = getAccessToken()
  const authHeader = accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined

  // 요청 로깅
  console.log(`📡 [${new Date().toISOString()}] API Request:`, {
    method: options.method || 'GET',
    url,
    body: json || undefined
  })

  try {
    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...authHeader,
        ...headers,
      },
      body: json ? JSON.stringify(json) : undefined,
      credentials: credentials || 'include',
      ...rest,
    })

    // 응답 로깅
    console.log(`📥 [${new Date().toISOString()}] API Response:`, {
      status: response.status,
      statusText: response.statusText,
      url
    })

    if (!response.ok) {
      let payload: unknown
      try {
        payload = await response.json()
      } catch {
        payload = await response.text()
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

    const data = (await response.json()) as T
    console.log(`✅ Success:`, {
      url,
      dataType: Array.isArray(data) ? `Array[${data.length}]` : typeof data,
      sampleData: Array.isArray(data) && data.length > 0 ? data[0] : data
    })
    return data
  } catch (error) {
    if (error instanceof ApiError) {
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
