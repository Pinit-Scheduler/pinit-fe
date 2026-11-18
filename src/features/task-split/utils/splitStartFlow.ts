import { getRequestFailureMessage } from '@shared/api/errorMessage'
import type { ConfirmAsk } from '@shared/components/common/confirm'
import type { SplitSummary } from '../api/splitRequests'
import { splitErrorOf } from '../api/splitErrors'
import type { SplitStartTarget } from '../splitStartStore'
import { QUOTA_EXHAUSTED, requestConfirm } from './splitLabels'
import { SPLIT_INBOX_PATH, splitProposalPath } from './splitPaths'

export type StartDecision =
  | { kind: 'ignore' } // 요약을 못 읽었거나 접수가 꺼졌다. 입구가 숨겨진 상태다
  | { kind: 'goto'; to: string } // 본인이 이미 맡긴 작업이다
  | { kind: 'blocked'; message: string } // 오늘 횟수를 다 썼다
  | { kind: 'consent' } // 동의 창
  | { kind: 'confirm'; ask: ConfirmAsk } // 맡기기 확인 창

/** 쪼개기 입구를 눌렀을 때 할 일. proposalScreen은 제안 화면이 있는지다(PROPOSAL_SCREEN_READY). */
export const startDecision = (
  task: SplitStartTarget,
  summary: SplitSummary | null,
  proposalScreen: boolean,
): StartDecision => {
  const lock = task.split?.lock
  if (lock?.mine) {
    const ready = lock.requestStatus === 'READY' && proposalScreen && lock.requestId != null
    return { kind: 'goto', to: ready ? splitProposalPath(lock.requestId as number) : SPLIT_INBOX_PATH }
  }
  if (lock) return { kind: 'ignore' }
  if (!summary || !summary.available) return { kind: 'ignore' }
  if (summary.quota.remaining <= 0) return { kind: 'blocked', message: QUOTA_EXHAUSTED }
  if (!summary.consent.consented) return { kind: 'consent' }
  return { kind: 'confirm', ask: requestConfirm(summary.quota) }
}

/**
 * 입구를 눌렀을 때 할 일을 정하되, 횟수를 다 썼다고 보이면 요약을 다시 읽어 한 번 더 정한다. 들고 있던 요약은
 * 회원의 자정을 넘겨 낡았을 수 있다. 다시 읽지 못하면 들고 있던 요약대로 정한다. `fresh`는 다시 읽은 요약이다.
 */
export const decideStart = async (
  task: SplitStartTarget,
  summary: SplitSummary | null,
  proposalScreen: boolean,
  readSummary: () => Promise<SplitSummary>,
): Promise<{ decision: StartDecision; fresh: SplitSummary | null }> => {
  const decision = startDecision(task, summary, proposalScreen)
  if (decision.kind !== 'blocked') return { decision, fresh: null }
  try {
    const fresh = await readSummary()
    return { decision: startDecision(task, fresh, proposalScreen), fresh }
  } catch {
    return { decision, fresh: null }
  }
}

export type SubmitFailure =
  | { kind: 'already-mine' }
  | { kind: 'consent' }
  | { kind: 'failed'; message: string }

/** 접수 실패의 갈래. 이중 제출의 두 번째가 내 요청으로 거부되면 성공처럼 다룬다(ADR-0035 §7). */
export const submitFailureOf = (error: unknown): SubmitFailure => {
  const split = splitErrorOf(error)
  if (split?.code === 'SPLIT_ALREADY_IN_PROGRESS' && typeof split.split.requestId === 'number')
    return { kind: 'already-mine' }
  if (split?.code === 'SPLIT_CONSENT_REQUIRED') return { kind: 'consent' }
  return { kind: 'failed', message: getRequestFailureMessage(error, '쪼개기를 맡기지 못했어요.') }
}
