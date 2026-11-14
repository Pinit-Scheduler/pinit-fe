import { handleMockRequest } from './handlers'
import { mockWorkspaceRemote } from './workspace'
import { setChangeDeliveryDelay, STREAM_POLL_MS } from './workspaceState'
import { setMockRefreshFailure, type MockRefreshFailure } from './refreshCookie'

let isInstalled = false

const LATENCY_KEY = 'pinit.mock.latency'

/**
 * 응답 지연(ms). 실제 네트워크처럼 늦게 오는 응답에서 깜빡임과 로딩 표시를 확인할 때 쓴다.
 * 개발자 도구에서 `__pinitMock.setLatency(400)`으로 바꾸면 새로고침해도 남는다. 기본은 0이다.
 */
const readLatency = () => {
  try {
    const value = Number(window.localStorage.getItem(LATENCY_KEY) ?? 0)
    return Number.isFinite(value) && value > 0 ? value : 0
  } catch {
    return 0
  }
}

const wait = (ms: number, signal?: AbortSignal | null) =>
  new Promise<void>((resolve, reject) => {
    const aborted = () =>
      reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'))
    if (signal?.aborted) return aborted()
    if (ms <= 0) return resolve()
    const onAbort = () => {
      window.clearTimeout(timer)
      aborted()
    }
    const timer = window.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })

export const setupMockServer = () => {
  if (isInstalled) return
  if (typeof window === 'undefined' || typeof window.fetch !== 'function') return

  const originalFetch = window.fetch.bind(window)
  let latency = readLatency()
  // 실시간 이벤트는 응답이 도착한 뒤에 온다. 서버가 기록을 주기적으로 읽어 보내는 것과 같은 순서다.
  setChangeDeliveryDelay(() => latency + STREAM_POLL_MS)

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    const mocked = await handleMockRequest(request)
    if (mocked) {
      // 실시간 스트림은 바로 연결한다. 지연은 한 번 읽고 끝나는 응답에만 준다.
      if (!mocked.headers.get('Content-Type')?.includes('text/event-stream'))
        await wait(latency, request.signal)
      return mocked
    }
    return originalFetch(input, init)
  }

  Object.assign(window, {
    __pinitMock: {
      /** 다른 참여자가 바꾼 것처럼 작업을 바꾸고 실시간 이벤트를 보낸다. */
      remote: mockWorkspaceRemote,
      setLatency(ms: number) {
        latency = Math.max(0, Number(ms) || 0)
        try {
          window.localStorage.setItem(LATENCY_KEY, String(latency))
        } catch {
          /* 이번 탭에만 적용한다 */
        }
        return latency
      },
      /** 세션 갱신이 응답 없이 실패하게 한다('network' | 'unavailable'). null이면 되돌린다. 새로고침해도 남는다. */
      setRefreshFailure(failure: MockRefreshFailure | null) {
        setMockRefreshFailure(failure)
        return failure
      },
    },
  })

  isInstalled = true
  console.info(
    '[mock] Local mock API is active (VITE_USE_MOCK_API=true). __pinitMock.remote.* simulates teammate changes.',
  )
}
