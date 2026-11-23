import { setRefreshTransport, type RefreshAnswer } from '@shared/api/authSession'
import {
  isNativeRefreshReply,
  isNativeShellUserAgent,
  type NativeMessage,
  type NativeRefreshReply,
} from './nativeShellRules'

type NativeWindow = Window & {
  /** react-native-webview가 넣어 주는 통로. */
  ReactNativeWebView?: { postMessage: (message: string) => void }
  /** 앱이 갱신 결과를 돌려줄 때 부른다(앱 저장소의 src/bridge/scripts.ts). */
  __pinitNativeReply?: (reply: unknown) => void
}

const nativeWindow = () => (typeof window === 'undefined' ? null : (window as NativeWindow))

/** 핀잇 앱의 WebView 안에서 돌고 있는지. 앱이 User-Agent에 붙인 표식으로 안다. */
export const isNativeShell = () =>
  typeof navigator !== 'undefined' && isNativeShellUserAgent(navigator.userAgent)

/** 앱에 메시지를 보낸다. 보냈으면 true. 앱 밖이거나 통로가 없으면 아무것도 하지 않는다. */
export const postToNative = (message: NativeMessage) => {
  const bridge = isNativeShell() ? nativeWindow()?.ReactNativeWebView : undefined
  if (!bridge) return false
  bridge.postMessage(JSON.stringify(message))
  return true
}

const NO_ANSWER: RefreshAnswer = { kind: 'transient', status: 0, data: null }
const waiting = new Map<string, (reply: NativeRefreshReply) => void>()
let sequence = 0

/**
 * 앱 안에서는 세션 갱신을 앱에 맡긴다. refresh token은 앱이 쥐고 있고, WebView의 쿠키 저장소가
 * 앱과 같다고 기대하지 않기 위해서다. 앱이 시간 안에 답하지 않으면 세션이 끝났다고 보지 않는다(transient).
 */
const requestNativeRefresh = (timeoutMs: number) =>
  new Promise<RefreshAnswer>((resolve) => {
    const id = `refresh-${Date.now()}-${++sequence}`
    const timer = setTimeout(() => {
      waiting.delete(id)
      resolve(NO_ANSWER)
    }, timeoutMs)
    waiting.set(id, (reply) => {
      clearTimeout(timer)
      waiting.delete(id)
      if (reply.kind === 'token') resolve({ kind: 'token', token: reply.token })
      else if (reply.kind === 'unauthorized') resolve({ kind: 'unauthorized' })
      else resolve(NO_ANSWER)
    })
    if (!postToNative({ type: 'refresh', id })) {
      clearTimeout(timer)
      waiting.delete(id)
      resolve(NO_ANSWER)
    }
  })

/**
 * 앱 안이면 첫 렌더 전에 한 번 부른다(main.tsx). 아래 탭을 숨기는 CSS 표식을 달고,
 * 세션 갱신을 앱에 맡기도록 바꾼다. 앱 밖에서는 아무것도 하지 않는다.
 */
export const installNativeShell = () => {
  const host = nativeWindow()
  if (!host || !isNativeShell()) return false
  document.documentElement.classList.add('native-shell')
  host.__pinitNativeReply = (reply) => {
    if (isNativeRefreshReply(reply)) waiting.get(reply.id)?.(reply)
  }
  setRefreshTransport(requestNativeRefresh)
  return true
}
