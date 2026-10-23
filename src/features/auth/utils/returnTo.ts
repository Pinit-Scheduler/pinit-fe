// 로그인 뒤 돌아갈 앱 내부 경로. 네이버 로그인처럼 다른 origin을 거쳐 와도 같은 탭이면 유지되도록 sessionStorage에 둔다.
const RETURN_TO_KEY = 'pinit.authReturnTo'

// OAuth 동의 요청(10분)보다 조금 길게만 보관해, 버려진 값이 나중 로그인에 끼어들지 않게 한다.
export const RETURN_TO_TTL_MS = 15 * 60 * 1000

type ReturnToStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

type StoredReturnTo = {
  path: string
  savedAt: number
}

const getSessionStorage = (): ReturnToStorage | null => {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage
  } catch {
    return null
  }
}

// 같은 origin의 절대 경로만 허용한다(`//evil.example`, `/\evil.example`, 스킴 포함 URL 차단).
export const isSafeReturnPath = (path: unknown): path is string =>
  typeof path === 'string' &&
  path.startsWith('/') &&
  !path.startsWith('//') &&
  !path.startsWith('/\\') &&
  !/[\r\n\t]/.test(path)

// 로그인 화면으로 돌려보낼 경로는 기억하지 않는다.
const isAuthPath = (path: string) => /^\/(login|signup)(\/|\?|$)/.test(path)

export const rememberReturnTo = (
  path: string,
  storage: ReturnToStorage | null = getSessionStorage(),
  now: number = Date.now(),
) => {
  if (!storage || !isSafeReturnPath(path) || isAuthPath(path)) return
  try {
    storage.setItem(RETURN_TO_KEY, JSON.stringify({ path, savedAt: now } satisfies StoredReturnTo))
  } catch {
    /* 저장 공간을 쓸 수 없으면 기본 경로로 이동한다 */
  }
}

/** 기억한 경로를 한 번만 꺼낸다. 없거나 만료·변조됐으면 null. */
export const consumeReturnTo = (
  storage: ReturnToStorage | null = getSessionStorage(),
  now: number = Date.now(),
): string | null => {
  if (!storage) return null
  try {
    const raw = storage.getItem(RETURN_TO_KEY)
    storage.removeItem(RETURN_TO_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<StoredReturnTo>
    if (!isSafeReturnPath(parsed.path) || typeof parsed.savedAt !== 'number') return null
    if (now - parsed.savedAt > RETURN_TO_TTL_MS || parsed.savedAt > now) return null
    return parsed.path
  } catch {
    return null
  }
}

/**
 * 로그인 직후 이동할 곳. OAuth 동의 화면은 framing 차단 헤더가 붙은 문서로 다시 받아야 하므로
 * SPA 이동 대신 전체 페이지 이동을 쓴다.
 */
export const resolvePostLoginTarget = (returnTo: string | null, fallback = '/app') => {
  const path = returnTo ?? fallback
  return { path, fullPageLoad: path.startsWith('/oauth/') }
}
