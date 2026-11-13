import type { EmailCodePurpose, PasswordResetPayload, EmailRegistrationPayload } from '../features/auth/api/email'
import { mockCategoryOwnerId } from './categories'
import { mockUsers } from './db'

// 개발용 모크. 이메일 인증 규칙(코드 해시·실패 횟수·발송 한도)은 서버(이메일 인증·비밀번호 찾기 설계 §6·§7)에 있고,
// 여기서는 화면 확인에 필요한 흐름만 흉내 낸다. 발급한 코드는 메일 대신 콘솔에 남긴다.
// demo 계정은 이메일이 있고, pinit 계정은 없어 로그인하면 등록 화면으로 간다.

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

const noContent = (status = 204) => new Response(null, { status })

const invalidCode = () => json({ message: '인증 코드가 올바르지 않거나 만료되었어요.' }, 400)

const readJson = async <T>(request: Request): Promise<Partial<T>> => {
  try {
    return ((await request.json()) as Partial<T>) ?? {}
  } catch {
    return {}
  }
}

const normalize = (email: unknown) => (typeof email === 'string' ? email.trim().toLowerCase() : '')

const memberEmails = new Map<number, string>([[1, 'demo@example.com']])
const codes = new Map<string, string>()

const findMemberByEmail = (email: string) =>
  [...memberEmails.entries()].find(([, registered]) => registered === email)?.[0] ?? null

const issueCode = (key: string, email: string) => {
  const code = String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0')
  codes.set(key, code)
  console.info(`[mock] ${email} 인증 코드: ${code}`)
}

const consumeCode = (key: string, code: unknown) => {
  if (typeof code !== 'string' || codes.get(key) !== code) return false
  codes.delete(key)
  return true
}

const maskEmail = (email: string) => {
  const [local, domain] = email.split('@')
  return `${local.slice(0, 2)}***@${domain}`
}

export const isMockEmailRequired = (userId: number) => !memberEmails.has(userId)

/** 가입 요청의 이메일·코드를 확인한다. 실패하면 응답, 성공하면 null. */
export const verifyMockSignupEmail = (email: unknown, code: unknown): Response | null => {
  const normalized = normalize(email)
  if (!normalized) return json({ message: '이메일을 입력해 주세요.' }, 400)
  if (findMemberByEmail(normalized) !== null) return invalidCode()
  return consumeCode(`SIGNUP:${normalized}`, code) ? null : invalidCode()
}

export const registerMockMemberEmail = (userId: number, email: unknown) => {
  memberEmails.set(userId, normalize(email))
}

export const handleEmailAuth = async (path: string, method: string, request: Request) => {
  if (method === 'POST' && path === '/v0/email-codes') {
    const body = await readJson<{ email: string; purpose: EmailCodePurpose }>(request)
    const email = normalize(body.email)
    const owner = email ? findMemberByEmail(email) : null
    // 가입은 쓰지 않은 이메일에만, 재설정은 등록된 이메일에만 코드를 보낸다. 응답은 언제나 같다.
    if (body.purpose === 'SIGNUP' && email && owner === null) issueCode(`SIGNUP:${email}`, email)
    if (body.purpose === 'PASSWORD_RESET' && owner !== null) issueCode(`PASSWORD_RESET:${email}`, email)
    return noContent(202)
  }

  if (method === 'POST' && path === '/v0/password-reset') {
    const body = await readJson<PasswordResetPayload>(request)
    const email = normalize(body.email)
    const user = mockUsers.find((candidate) => candidate.id === findMemberByEmail(email))
    if (!user || !consumeCode(`PASSWORD_RESET:${email}`, body.code)) return invalidCode()
    if (typeof body.newPassword === 'string') user.password = body.newPassword
    return noContent()
  }

  const isAccount = method === 'GET' && path === '/v0/me/account'
  const isRegistration = method === 'POST' && (path === '/v0/me/email-codes' || path === '/v0/me/email')
  if (!isAccount && !isRegistration) return null
  // 모크 토큰의 회원 번호를 읽는 기존 함수를 그대로 쓴다.
  const owner = mockCategoryOwnerId(request)
  if (owner === null) return json({ message: '로그인이 필요합니다.' }, 401)

  if (isAccount) {
    const user = mockUsers.find((candidate) => candidate.id === owner)
    if (!user) return json({ message: '회원을 찾을 수 없습니다.' }, 404)
    const email = memberEmails.get(owner)
    return json({
      username: user.username,
      nickname: user.nickname,
      socialLogin: false,
      email: email ? maskEmail(email) : null,
      emailRequired: !email,
    })
  }

  if (path === '/v0/me/email-codes') {
    const body = await readJson<{ email: string }>(request)
    const email = normalize(body.email)
    if (email && findMemberByEmail(email) === null) issueCode(`REGISTER:${owner}:${email}`, email)
    return noContent(202)
  }

  const body = await readJson<EmailRegistrationPayload>(request)
  const email = normalize(body.email)
  if (!consumeCode(`REGISTER:${owner}:${email}`, body.code)) return invalidCode()
  registerMockMemberEmail(owner, email)
  return noContent()
}
