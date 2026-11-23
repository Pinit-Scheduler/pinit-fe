// 앱 안의 WebView에서 도는 웹 앱이 앱(네이티브)에 보내는 메시지. 의존성이 없어 node 테스트에서 그대로 불러 쓴다.
// 웹 쪽 짝은 웹 소스의 src/shared/native/nativeShell.ts다. 메시지를 더하거나 바꾸면 두 파일을 함께 고친다.

export type WebMessage =
  /** 이 웹 화면이 할 일을 마쳤다(상세·폼을 닫음, 맨 처음 화면에서 뒤로). 앱은 WebView 화면을 닫는다. */
  | { type: 'close' }
  /** 웹이 앱이 직접 그리는 화면(오늘, 로그인)으로 가려 한다. 앱이 그 화면을 대신 연다. */
  | { type: 'route'; path: string }
  /** 회원이 웹 화면에서 로그아웃을 눌렀다. 서버 로그아웃과 기기 정리는 앱이 한다. */
  | { type: 'logout' }
  /** 웹의 access token이 만료됐다. 앱이 갱신해 같은 id로 답한다. */
  | { type: 'refresh'; id: string }

export const parseWebMessage = (raw: unknown): WebMessage | null => {
  if (typeof raw !== 'string') return null
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (!value || typeof value !== 'object') return null
  const message = value as { type?: unknown; path?: unknown; id?: unknown }
  switch (message.type) {
    case 'close':
    case 'logout':
      return { type: message.type }
    case 'route':
      return typeof message.path === 'string' && message.path.startsWith('/')
        ? { type: 'route', path: message.path }
        : null
    case 'refresh':
      return typeof message.id === 'string' && message.id ? { type: 'refresh', id: message.id } : null
    default:
      return null
  }
}

/** 웹이 넘긴 경로를 앱의 어느 화면이 맡는지. */
export type NativeTarget = 'today' | 'auth'

export const nativeTargetOf = (path: string): NativeTarget | null => {
  const pathname = path.split(/[?#]/, 1)[0].replace(/\/+$/, '') || '/'
  if (pathname === '/' || pathname === '/login') return 'auth'
  if (pathname === '/app' || pathname === '/app/today') return 'today'
  return null
}

/** 앱이 웹의 갱신 요청에 답하는 내용. 웹의 RefreshAnswer와 같은 세 가지다. */
export type RefreshReply =
  | { id: string; kind: 'token'; token: string }
  | { id: string; kind: 'unauthorized' }
  | { id: string; kind: 'transient' }

/**
 * WebView에 열 경로를 고른다. 앱 안에서 만든 경로만 오지만, 딥링크로 들어온 값이 다른 사이트를 열지 못하게
 * 사이트 안의 절대 경로만 받는다. 그 밖의 값은 fallback으로 바꾼다.
 */
export const safeWebPath = (path: unknown, fallback = '/app/settings') => {
  if (typeof path !== 'string') return fallback
  // "//host"와 "/\host"는 브라우저가 다른 호스트로 해석한다.
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) return fallback
  return path
}

/** 웹 앱과 같은 출처인지. 다른 출처는 WebView 안에서 열지 않고 기기의 브라우저로 넘긴다. */
export const isSameOrigin = (url: string, origin: string) => {
  const normalized = origin.replace(/\/+$/, '')
  return url === normalized || url.startsWith(normalized + '/') || url.startsWith(normalized + '?') || url.startsWith(normalized + '#')
}
