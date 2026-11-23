import { isTokenExpired } from '@/lib/jwt'
import { endSession, getAccessToken, refreshSession } from '@/session/store'
import { ApiError, getApiErrorMessage } from './errors'

type Options = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  json?: unknown
  signal?: AbortSignal
}

const SESSION_ENDED = '로그인이 끝났어요. 다시 로그인해 주세요.'

/** 새 access token. 세션이 끝났으면 로그인 화면으로 보내고 401을, 답을 못 받았으면 status 0을 던진다. */
const renew = async () => {
  const result = await refreshSession()
  if (result.kind === 'refreshed') return result.token
  if (result.kind === 'unauthorized') {
    endSession()
    throw new ApiError(SESSION_ENDED, 401, null)
  }
  // 세션이 끝났다는 답은 없다. 저장된 토큰은 두고 이번 요청만 네트워크 실패로 알린다.
  throw new ApiError('', 0, result.data)
}

const readBody = async (response: Response): Promise<unknown> => {
  if (response.status === 204) return undefined
  const raw = await response.text()
  if (!raw) return undefined
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

/**
 * 로그인한 회원의 API 요청. 만료가 가까운 토큰은 보내기 전에 갱신하고,
 * 401을 받으면 한 번 갱신한 뒤 같은 요청을 다시 보낸다(웹 httpClient와 같은 순서).
 */
export const api = async <T>(url: string, { method = 'GET', json, signal }: Options = {}): Promise<T> => {
  const body = json === undefined ? undefined : JSON.stringify(json)
  const send = async (token: string) => {
    try {
      return await fetch(url, {
        method,
        headers: {
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          Authorization: `Bearer ${token}`,
        },
        body,
        credentials: 'include',
        signal,
      })
    } catch (error) {
      if (signal?.aborted) throw error
      throw new ApiError('', 0, error)
    }
  }

  let token = getAccessToken()
  let renewed = false
  if (!token || isTokenExpired(token, Date.now())) {
    token = await renew()
    renewed = true
  }
  let response = await send(token)
  if (response.status === 401 && !renewed) {
    token = await renew()
    response = await send(token)
  }
  const data = await readBody(response)
  if (!response.ok) {
    // 방금 받은 토큰으로도 401이면 이 세션으로는 더 할 수 있는 일이 없다.
    if (response.status === 401) endSession()
    throw new ApiError(getApiErrorMessage(data), response.status, data)
  }
  return data as T
}
