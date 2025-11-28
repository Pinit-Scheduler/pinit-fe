const API_BASE_URL = "http://localhost:8080"

export class ApiError extends Error {
  status: number
  data: unknown

  constructor(message: string, status: number, data: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.data = data
  }
}

export type HttpClientOptions = RequestInit & {
  json?: unknown
}

export const httpClient = async <T>(path: string, options: HttpClientOptions = {}): Promise<T> => {
  const { json, headers, ...rest } = options
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: json ? JSON.stringify(json) : undefined,
    ...rest,
  })

  if (!response.ok) {
    let payload: unknown
    try {
      payload = await response.json()
    } catch (error) {
      payload = await response.text()
    }
    throw new ApiError('API 요청이 실패했습니다.', response.status, payload)
  }

  if (response.status === 204) {
    return undefined as T
  }

  return (await response.json()) as T
}

