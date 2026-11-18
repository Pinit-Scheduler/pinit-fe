import { unavailableText } from '@features/spaces/unavailable'
import type { SplitLock, TaskSplitInfo } from '../api/taskSplitInfo'

export type SplitEntry =
  | { kind: 'none' }
  | { kind: 'lock'; lock: SplitLock }
  | { kind: 'offer'; recommended: boolean; enabled: boolean; blockedReasons: string[] }

const HIDING_REASONS = ['TASK_COMPLETED', 'RECURRING_TASK']

/** 작업 하나에 무엇을 보일지. available은 summary.available이고 요약을 못 읽었으면 false다. */
export const splitEntryOf = (
  split: TaskSplitInfo | null | undefined,
  available: boolean,
): SplitEntry => {
  if (!split) return { kind: 'none' }
  if (split.lock) return { kind: 'lock', lock: split.lock }
  if (!available) return { kind: 'none' }
  const reasons = split.cannotRequestReasons ?? []
  if (reasons.some((reason) => HIDING_REASONS.includes(reason))) return { kind: 'none' }
  return {
    kind: 'offer',
    recommended: split.recommended,
    enabled: split.canRequest,
    blockedReasons: reasons,
  }
}

export const showsRecommendChip = (entry: SplitEntry): boolean =>
  entry.kind === 'offer' && entry.recommended && entry.enabled

export const blockedText = (reason: string, admins: string[]): string => {
  switch (reason) {
    case 'HAS_LINKED_SCHEDULE':
      return '일정에 넣은 작업은 쪼갤 수 없어요. 일정을 지우거나 연결을 푼 뒤 쪼개 주세요.'
    case 'ADMIN_ONLY':
      return unavailableText('ADMIN_ONLY', admins)
    default:
      return '지금은 쪼갤 수 없어요.'
  }
}

/**
 * 작업 카드 오류 줄의 버튼. 'retry'는 같은 요청을 다시 보내고, 'refresh'는 작업만 다시 읽는다.
 * 잠긴 원본에 같은 요청을 다시 보내면 같은 이유로 거부되므로, 잠긴 동안에는 다시 보내기를 두지 않는다.
 */
export const cardRetryOf = (entry: SplitEntry, refreshOnly: boolean): 'retry' | 'refresh' | null => {
  if (refreshOnly) return 'refresh'
  return entry.kind === 'lock' ? null : 'retry'
}
