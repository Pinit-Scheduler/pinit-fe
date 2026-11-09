import { handleMockRequest } from './handlers'
import { mockWorkspaceRemote } from './workspace'

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
    if (ms <= 0) return resolve()
    const timer = window.setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        window.clearTimeout(timer)
        reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
      },
      { once: true },
    )
  })

export const setupMockServer = () => {
  if (isInstalled) return
  if (typeof window === 'undefined' || typeof window.fetch !== 'function') return

  const originalFetch = window.fetch.bind(window)
  let latency = readLatency()

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
    },
  })

  isInstalled = true
  console.info(
    '[mock] Local mock API is active (VITE_USE_MOCK_API=true). __pinitMock.remote.* simulates teammate changes.',
  )
}
