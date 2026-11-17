import type { SplitCheck } from './splitProposals'
import type { SplitLockStage } from './taskSplitInfo'

/** `SPLIT_UNDO_NOT_AVAILABLE`의 `undoReason`. 만들기 되돌리기(S10)와 버리기 되돌리기(S11)가 쓰는 값이 다르다. */
export type SplitUndoApplyReason =
  | 'STATE'
  | 'EXPIRED'
  | 'ORIGINAL_MISSING'
  | 'ORIGINAL_CHANGED'
  | 'PERMISSION'
  | 'PIECES_CHANGED'
export type SplitUndoDiscardReason =
  | 'STATE'
  | 'EXPIRED'
  | 'ORIGINAL_NOT_ELIGIBLE'
  | 'ORIGINAL_CHANGED'
  | 'OTHER_REQUEST_EXISTS'

/** 오류 응답의 `split` 본문(ADR-0035 §9). 해당 없는 필드는 없거나 null이다. */
export type SplitErrorDetails = {
  requestId?: number | null
  requesterNickname?: string | null
  lockStage?: SplitLockStage | null
  currentStatus?: string | null
  currentDisclosureVersion?: string | null
  reasons?: string[] | null
  quotaLimit?: number | null
  quotaResetsAt?: string | null
  /** `SplitUndoApplyReason` 또는 `SplitUndoDiscardReason`. 모르는 값이 올 수 있어 문자열로 둔다. */
  undoReason?: string | null
  check?: unknown
}

const LOCKED_BY_SPLIT = 'TASK_LOCKED_BY_SPLIT'

const codeOf = (error: unknown) => {
  if (!error || typeof error !== 'object') return null
  const { name, status, data } = error as { name?: unknown; status?: unknown; data?: unknown }
  // ApiError는 httpClient가 만들고 테스트가 모듈을 다른 vm 컨텍스트에서 불러오므로 instanceof 대신 name으로 가린다.
  if (name !== 'ApiError' || typeof status !== 'number') return null
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const { code, split } = data as { code?: unknown; split?: unknown }
  if (typeof code !== 'string') return null
  return { code, status, split }
}

/** 쪼개기 오류(code가 `SPLIT_`로 시작하거나 `TASK_LOCKED_BY_SPLIT`)면 code·상태·split 본문, 아니면 null. split이 없으면 빈 객체. */
export const splitErrorOf = (
  error: unknown,
): { code: string; status: number; split: SplitErrorDetails } | null => {
  const parsed = codeOf(error)
  if (!parsed) return null
  const { code, status, split } = parsed
  if (!code.startsWith('SPLIT_') && code !== LOCKED_BY_SPLIT) return null
  const details =
    split && typeof split === 'object' && !Array.isArray(split)
      ? (split as SplitErrorDetails)
      : {}
  return { code, status, split: details }
}

export const isLockedBySplit = (error: unknown): boolean =>
  codeOf(error)?.code === LOCKED_BY_SPLIT

/** 거부에 실린 `split.check`. `pieces` 배열을 가진 객체일 때만 돌려준다. */
export const splitCheckOf = (error: unknown): SplitCheck | null => {
  const check = splitErrorOf(error)?.split.check
  if (!check || typeof check !== 'object') return null
  return Array.isArray((check as { pieces?: unknown }).pieces) ? (check as SplitCheck) : null
}
