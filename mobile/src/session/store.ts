import { useSyncExternalStore } from 'react'

import { ApiError, getApiErrorMessage } from '@/api/errors'
import { apiUrl } from '@/config'
import { clearSession, readSession, writeSession } from './vault'

export type SessionState = {
  /** loading: 저장된 로그인을 아직 읽지 않았다. */
  status: 'loading' | 'signedOut' | 'signedIn'
  accessToken: string | null
}

/**
 * 세션 갱신 결과. 웹의 src/shared/api/authSession.ts와 같은 구분이다.
 * - refreshed: 새 access token을 저장했다.
 * - unauthorized: 세션이 끝났다. /v0/refresh가 401·403으로 답했거나 그사이 로그아웃했다.
 * - transient: 세션이 끝났다는 답이 없다(무응답, 5xx, 429 등). 저장된 토큰은 그대로 두고 나중에 다시 시도한다.
 */
export type RefreshResult =
  | { kind: 'refreshed'; token: string }
  | { kind: 'unauthorized' }
  | { kind: 'transient'; status: number; data: unknown }

const REFRESH_TIMEOUT_MS = 15_000

let state: SessionState = { status: 'loading', accessToken: null }
const listeners = new Set<() => void>()
// 로그인·로그아웃마다 올린다. 그 전에 보낸 갱신의 늦은 답이 새 세션을 덮지 못하게 한다.
let epoch = 0
let pendingRefresh: Promise<RefreshResult> | null = null
// 방금 로그인한 계정에 이메일이 없다. 로그인한 화면이 열리면 한 번 읽어 이메일 등록 화면을 연다.
let emailRegistrationDue = false

/** 이메일 등록 화면을 열어야 하면 true를 돌려주고 표시를 지운다. */
export const consumeEmailRegistration = () => {
  const due = emailRegistrationDue
  emailRegistrationDue = false
  return due
}

const setState = (next: SessionState) => {
  state = next
  listeners.forEach((listener) => listener())
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const getSession = () => state
export const getAccessToken = () => state.accessToken
export const useSession = () => useSyncExternalStore(subscribe, getSession, getSession)

const persist = (token: string) => {
  writeSession({ accessToken: token }).catch((error: unknown) => {
    // 저장에 실패해도 이번 실행은 로그인 상태다. 다음 실행에서 다시 로그인하게 된다.
    console.warn('[session] 로그인 정보를 저장하지 못했어요:', error)
  })
}

const forget = () => {
  clearSession().catch((error: unknown) => {
    console.warn('[session] 저장된 로그인 정보를 지우지 못했어요:', error)
  })
}

/** 앱을 켤 때 한 번. 저장된 토큰이 있으면 네트워크를 기다리지 않고 바로 로그인 상태로 시작한다. */
export const bootSession = async () => {
  if (state.status !== 'loading') return
  const stored = await readSession()
  if (state.status !== 'loading') return
  setState(stored ? { status: 'signedIn', accessToken: stored.accessToken } : { status: 'signedOut', accessToken: null })
}

const readBody = async (response: Response): Promise<unknown> => {
  try {
    const raw = await response.text()
    if (!raw) return null
    try {
      return JSON.parse(raw)
    } catch {
      return raw
    }
  } catch {
    return null
  }
}

const tokenOf = (data: unknown) => {
  const token = data && typeof data === 'object' ? (data as { token?: unknown }).token : undefined
  return typeof token === 'string' && token ? token : null
}

/**
 * 아이디·비밀번호 로그인. access token은 응답 본문으로, refresh token은 쿠키로 온다.
 * 쿠키는 OS의 쿠키 저장소가 보관하고 이후 /v0/refresh 요청에 실어 보낸다.
 */
export const signIn = async (username: string, password: string) => {
  let response: Response
  try {
    response = await fetch(apiUrl('/login', 'v0'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ username, password }),
      credentials: 'include',
    })
  } catch (error) {
    throw new ApiError('', 0, error)
  }
  const data = await readBody(response)
  if (!response.ok) throw new ApiError(getApiErrorMessage(data), response.status, data)
  const token = tokenOf(data)
  if (!token) throw new ApiError('', response.status, data)
  epoch += 1
  emailRegistrationDue = (data as { emailRequired?: unknown }).emailRequired === true
  persist(token)
  setState({ status: 'signedIn', accessToken: token })
}

const requestRefresh = async (): Promise<RefreshResult> => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REFRESH_TIMEOUT_MS)
  try {
    let response: Response
    try {
      response = await fetch(apiUrl('/refresh', 'v0'), {
        method: 'POST',
        headers: { Accept: 'application/json' },
        credentials: 'include',
        signal: controller.signal,
      })
    } catch (error) {
      return { kind: 'transient', status: 0, data: error }
    }
    if (response.status === 401 || response.status === 403) return { kind: 'unauthorized' }
    const data = await readBody(response)
    if (!response.ok) return { kind: 'transient', status: response.status, data }
    const token = tokenOf(data)
    return token ? { kind: 'refreshed', token } : { kind: 'transient', status: response.status, data }
  } finally {
    clearTimeout(timer)
  }
}

/** 쿠키의 refresh token으로 access token을 새로 받는다. 동시에 부른 요청은 한 번의 갱신을 함께 기다린다. */
export const refreshSession = (): Promise<RefreshResult> => {
  if (state.status === 'signedOut') return Promise.resolve({ kind: 'unauthorized' })
  if (pendingRefresh) return pendingRefresh
  const startedAt = epoch
  const request = (async (): Promise<RefreshResult> => {
    const result = await requestRefresh()
    // 기다리는 동안 로그아웃하거나 다시 로그인했다. 이 답은 그 전 세션의 것이라 버린다.
    if (epoch !== startedAt) {
      return state.accessToken ? { kind: 'refreshed', token: state.accessToken } : { kind: 'unauthorized' }
    }
    if (result.kind === 'refreshed') {
      persist(result.token)
      setState({ status: 'signedIn', accessToken: result.token })
    }
    return result
  })().finally(() => {
    if (pendingRefresh === request) pendingRefresh = null
  })
  pendingRefresh = request
  return request
}

/** 서버가 세션이 끝났다고 답했다(갱신 401·403). 이 기기의 로그인 정보를 지우고 로그인 화면으로 간다. */
export const endSession = () => {
  if (state.status === 'signedOut') return
  epoch += 1
  emailRegistrationDue = false
  forget()
  setState({ status: 'signedOut', accessToken: null })
}

/**
 * 로그아웃. 서버에서 refresh token을 폐기한 뒤 이 기기의 정보를 지운다.
 * 서버에 닿지 못하면 실패로 알리고 로그인 상태를 유지한다. 서버 세션이 살아 있는데 기기에서만 지우지 않기 위해서다.
 */
export const signOut = async () => {
  const token = state.accessToken
  let response: Response
  try {
    response = await fetch(apiUrl('/logout', 'v0'), {
      method: 'POST',
      headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      credentials: 'include',
    })
  } catch (error) {
    throw new ApiError('', 0, error)
  }
  // 401은 이미 끝난 세션이다. 그대로 로그아웃을 마친다.
  if (!response.ok && response.status !== 401) {
    const data = await readBody(response)
    throw new ApiError(getApiErrorMessage(data), response.status, data)
  }
  endSession()
}
