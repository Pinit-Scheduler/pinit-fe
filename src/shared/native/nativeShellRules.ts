// 핀잇 앱(pinit-ios·pinit-android 저장소)의 WebView 안에서 돌 때의 규칙. 의존성이 없어야 node 테스트에서 그대로 불러 쓸 수 있다.
// 앱 쪽 짝은 앱 저장소의 src/bridge/protocol.ts와 src/config.ts다. 메시지나 표식을 바꾸면 두 쪽을 함께 고친다.

/** 앱이 WebView의 User-Agent 끝에 붙이는 표식(앱 저장소 src/config.ts의 APP_USER_AGENT). */
export const NATIVE_SHELL_MARK = 'PinitApp/'

export const isNativeShellUserAgent = (userAgent: string | null | undefined) =>
  typeof userAgent === 'string' && userAgent.includes(NATIVE_SHELL_MARK)

/** 웹이 앱에 보내는 메시지. */
export type NativeMessage =
  /** 이 웹 화면이 할 일을 마쳤다. 앱은 WebView 화면을 닫는다. */
  | { type: 'close' }
  /** 앱이 직접 그리는 화면(오늘, 로그인)으로 가려 한다. 앱이 그 화면을 연다. */
  | { type: 'route'; path: string }
  /** 회원이 로그아웃을 눌렀다. 서버 로그아웃과 기기 정리는 앱이 한다. */
  | { type: 'logout' }
  /** access token이 만료됐다. 앱이 갱신해 같은 id로 답한다. */
  | { type: 'refresh'; id: string }

/**
 * 앱이 직접 그리는 화면의 경로인지. 앱 안에서는 웹이 이 화면을 그리지 않고 앱에 넘긴다.
 * - `/`, `/login`: 로그인은 앱 화면이다. 세션이 끝나 웹이 로그인으로 가려 할 때도 여기로 온다.
 * - `/app`, `/app/today`: '오늘'은 앱 화면이다.
 * 일정·작업 목록(`/app/schedules`, `/app/tasks`)은 넘기지 않는다. 웹 화면에서 스페이스를 고르거나
 * 검색·필터를 쓰려고 들어온 흐름을 그대로 이어 가기 위해서다.
 */
export const isNativeRoute = (pathname: string) => {
  const path = pathname.replace(/\/+$/, '') || '/'
  return path === '/' || path === '/login' || path === '/app' || path === '/app/today'
}

/** 화면을 닫으며 목록으로 돌아갈 때 location.state에 싣는 표식. 앱 안에서는 목록 대신 WebView를 닫는다. */
export const NATIVE_CLOSE_STATE = 'nativeClose'

export const isNativeCloseState = (state: unknown) =>
  !!state && typeof state === 'object' && (state as Record<string, unknown>)[NATIVE_CLOSE_STATE] === true

/** 앱이 갱신 요청에 답하는 내용(앱 저장소 src/bridge/protocol.ts의 RefreshReply). */
export type NativeRefreshReply =
  | { id: string; kind: 'token'; token: string }
  | { id: string; kind: 'unauthorized' }
  | { id: string; kind: 'transient' }

export const isNativeRefreshReply = (value: unknown): value is NativeRefreshReply => {
  if (!value || typeof value !== 'object') return false
  const reply = value as { id?: unknown; kind?: unknown; token?: unknown }
  if (typeof reply.id !== 'string' || !reply.id) return false
  if (reply.kind === 'token') return typeof reply.token === 'string' && reply.token.length > 0
  return reply.kind === 'unauthorized' || reply.kind === 'transient'
}
