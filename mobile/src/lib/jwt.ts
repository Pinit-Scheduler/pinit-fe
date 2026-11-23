// 액세스 토큰(JWT)의 만료 시각과 회원을 읽는다. 서명은 서버가 검증하므로 여기서는 본문만 읽는다.
// 의존성과 전역(atob)에 기대지 않아 node 테스트에서 그대로 불러 쓴다.

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

const decodeBase64Url = (input: string): string | null => {
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '')
  const bytes: number[] = []
  let buffer = 0
  let bits = 0
  for (const char of base64) {
    const value = ALPHABET.indexOf(char)
    if (value < 0) return null
    buffer = (buffer << 6) | value
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bytes.push((buffer >> bits) & 0xff)
    }
  }
  try {
    return decodeURIComponent(bytes.map((byte) => '%' + byte.toString(16).padStart(2, '0')).join(''))
  } catch {
    return null
  }
}

type Payload = { exp?: number; sub?: string | number; memberId?: string | number }

const readPayload = (token: string): Payload | null => {
  const segment = token.split('.')[1]
  if (!segment) return null
  const json = decodeBase64Url(segment)
  if (json === null) return null
  try {
    const payload: unknown = JSON.parse(json)
    return payload && typeof payload === 'object' ? (payload as Payload) : null
  } catch {
    return null
  }
}

/** 만료 60초 전부터 만료로 본다. 만료 시각을 읽을 수 없으면 서버 판단에 맡긴다(만료 아님). */
export const isTokenExpired = (token: string, now: number, skewMs = 60_000) => {
  const exp = readPayload(token)?.exp
  if (typeof exp !== 'number') return false
  return exp * 1000 - skewMs <= now
}

export const tokenSubject = (token: string) => {
  const payload = readPayload(token)
  const subject = payload?.sub ?? payload?.memberId
  return subject == null ? null : String(subject)
}
