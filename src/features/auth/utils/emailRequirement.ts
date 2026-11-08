import { EMAIL_REGISTRATION_PATH } from './authPaths'

// 이메일이 없는 기존 로컬 회원의 필수 등록(이메일 인증·비밀번호 찾기 설계 §8).
// 서버가 계산한 emailRequired를 로그인 응답이나 GET /me/account에서 받아, 페이지를 새로 열기 전까지 회원별로 기억한다.
// 서버는 다른 API를 막지 않으므로(설계 §3 비범위) 화면 이동만 정한다.

type Listener = () => void

export const createEmailRequirementStore = () => {
  let entry: { subject: string; required: boolean } | null = null
  const listeners = new Set<Listener>()

  return {
    /** 이 회원의 값을 아직 모르면 null. 다른 회원으로 바뀌었으면 모르는 것으로 본다. */
    get: (subject: string | null): boolean | null =>
      subject !== null && entry?.subject === subject ? entry.required : null,
    set: (subject: string | null, required: boolean) => {
      if (subject === null) return
      if (entry?.subject === subject && entry.required === required) return
      entry = { subject, required }
      listeners.forEach((listener) => listener())
    },
    subscribe: (listener: Listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

export const emailRequirement = createEmailRequirementStore()

/** 서버 응답의 emailRequired. 필드가 없는 응답(이전 서버, 소셜 로그인)은 값을 정하지 않는다. */
export const readEmailRequired = (response: unknown): boolean | null => {
  if (!response || typeof response !== 'object') return null
  const value = (response as { emailRequired?: unknown }).emailRequired
  return typeof value === 'boolean' ? value : null
}

/**
 * 로그인한 화면에서 할 일.
 * - toRegistration: 등록이 필요한데 다른 화면에 있다. 지금 경로를 기억하고 등록 화면으로 보낸다.
 * - leaveRegistration: 등록이 필요 없는데 등록 화면에 있다(등록을 마쳤거나 소셜 계정). 원래 가려던 곳으로 보낸다.
 * - render: 그대로 보여 준다.
 */
export type EmailGateDecision = 'render' | 'toRegistration' | 'leaveRegistration'

/** 라우터처럼 대소문자와 끝의 `/`를 무시하고 등록 화면 경로인지 본다. */
export const isEmailRegistrationPath = (pathname: string) =>
  pathname.replace(/\/+$/, '').toLowerCase() === EMAIL_REGISTRATION_PATH

export const decideEmailGate = (required: boolean, pathname: string): EmailGateDecision => {
  const onRegistration = isEmailRegistrationPath(pathname)
  if (required) return onRegistration ? 'render' : 'toRegistration'
  return onRegistration ? 'leaveRegistration' : 'render'
}
