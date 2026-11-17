import type { SplitLockStage } from './taskSplitInfo'

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
