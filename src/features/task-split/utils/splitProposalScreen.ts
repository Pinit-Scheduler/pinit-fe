import { getRequestFailureMessage, readFailureMessage } from '@shared/api/errorMessage'
import type { SplitCheck, SplitDetail } from '../api/splitProposals'
import { splitCheckOf, splitErrorOf } from '../api/splitErrors'

/**
 * 제안 화면이 무엇을 보여 줄지. `reload`는 요청이 아직 READY인데 검사·만들기가 거부됐다는 뜻이다
 * (경쟁에서 졌거나 화면이 오래됐다). 화면은 제안을 다시 읽고, 키가 맞는 조각은 고치던 모습을 잇는다.
 */
export type ProposalScreen =
  | { kind: 'ready'; detail: SplitDetail }
  | { kind: 'to-inbox' }
  | { kind: 'processed' }
  | { kind: 'expired' }
  | { kind: 'missing' }
  | { kind: 'reload' }
  | { kind: 'error'; message: string }

export type ApplyRejection =
  | { kind: 'screen'; screen: ProposalScreen }
  | { kind: 'admin-only' }
  | { kind: 'problems'; check: SplitCheck }
  /** 서버가 답한 그 밖의 거부 */
  | { kind: 'toast'; message: string }
  /** 응답이 오지 않았다 */
  | { kind: 'unknown'; message: string }

const APPLY_REFUSED = '만들지 못했어요. 아무것도 바뀌지 않았어요. 잠시 뒤 다시 시도해 주세요.'

/** 요청 상태가 정하는 화면. READY가 아닌 상태와 모르는 값만 다룬다. */
const screenOfStatus = (status: string | null | undefined): ProposalScreen => {
  if (status === 'QUEUED' || status === 'RUNNING' || status === 'FAILED') return { kind: 'to-inbox' }
  if (status === 'EXPIRED') return { kind: 'expired' }
  return { kind: 'processed' }
}

export const screenOfDetail = (detail: SplitDetail): ProposalScreen => {
  if (detail.request.status === 'READY') {
    return detail.proposal != null && detail.check != null
      ? { kind: 'ready', detail }
      : { kind: 'processed' }
  }
  return screenOfStatus(detail.request.status)
}

/** 화면을 바꾸는 거부(요청 없음·준비되지 않음)면 그 화면, 아니면 null. */
const screenRejection = (error: unknown): ProposalScreen | null => {
  const split = splitErrorOf(error)
  if (split?.code === 'SPLIT_REQUEST_NOT_FOUND') return { kind: 'missing' }
  if (split?.code === 'SPLIT_REQUEST_NOT_READY') {
    const current = split.split.currentStatus
    return current === 'READY' ? { kind: 'reload' } : screenOfStatus(current)
  }
  return null
}

export const screenOfError = (error: unknown): ProposalScreen =>
  screenRejection(error) ?? {
    kind: 'error',
    message: getRequestFailureMessage(error, '제안을 불러오지 못했어요.'),
  }

const statusOf = (error: unknown) =>
  error && typeof error === 'object' ? (error as { status?: unknown }).status : undefined

/**
 * 서버가 만들기를 거부했다고 알 수 있는 답. errorMessage의 isServerResponse와 달리 `responseStatus`(세션 갱신이
 * 멈춘 status 0)를 보지 않는다: 그 갈래는 만들기를 보냈는지 가릴 수 없어 '확인하지 못했다'로 둔다.
 */
const isServerAnswer = (error: unknown) => {
  const status = statusOf(error)
  return typeof status === 'number' && status >= 400
}

const UNCONFIRMED = '만들었는지 확인하지 못했어요.'

const isAnsweredOk = (error: unknown) => {
  const { answeredStatus } = error as { answeredStatus?: unknown }
  return typeof answeredStatus === 'number' && answeredStatus >= 200 && answeredStatus < 300
}

export const applyRejectionOf = (error: unknown): ApplyRejection => {
  const screen = screenRejection(error)
  if (screen) return { kind: 'screen', screen }
  const split = splitErrorOf(error)
  if (split?.code === 'SPLIT_NOT_ELIGIBLE' && split.split.reasons?.includes('ADMIN_ONLY')) {
    return { kind: 'admin-only' }
  }
  if (split?.code === 'SPLIT_INVALID_PIECES') {
    const check = splitCheckOf(error)
    if (check) return { kind: 'problems', check }
  }
  // 성공 응답을 받은 뒤 계정이 바뀐 것을 알아챈 401(httpClient의 assertCurrentActor, answeredStatus 2xx)은
  // 서버가 이미 만들었을 수 있다. 서버가 401로 답했거나 보내기 전에 막힌 401은 다른 거부와 같다.
  if (statusOf(error) === 401 && isAnsweredOk(error))
    return { kind: 'unknown', message: `${UNCONFIRMED} ${readFailureMessage(error) ?? '다시 시도해 주세요.'}` }
  if (isServerAnswer(error)) return { kind: 'toast', message: APPLY_REFUSED }
  return { kind: 'unknown', message: getRequestFailureMessage(error, UNCONFIRMED) }
}

export const checkFailureOf = (
  error: unknown,
): { kind: 'screen'; screen: ProposalScreen } | { kind: 'toast'; message: string } => {
  const screen = screenRejection(error)
  if (screen) return { kind: 'screen', screen }
  return { kind: 'toast', message: getRequestFailureMessage(error, '조각을 확인하지 못했어요.') }
}
