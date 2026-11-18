import type { ConfirmAsk } from '@shared/components/common/confirm'
import type { SplitLock, SplitLockStage } from '../api/taskSplitInfo'
import type { SplitFailureReason, SplitQuota, SplitRequestItem } from '../api/splitRequests'

export const SUBMITTED = '쪼개기를 맡겼어요. 준비되면 알려 드릴게요.'
export const QUOTA_EXHAUSTED = '오늘 쪼개기 횟수를 다 썼어요. 자정에 다시 채워져요.'
export const RECOMMEND_NOTE =
  '예상 시간이 4시간 이상이에요. 4시간보다 작은 조각으로 쪼개면 하루 계획에 넣기 쉬워요.'
export const RECOMMEND_CHIP = '4시간 이상 · 쪼개기'
export const CANCELLED_TOAST = '쪼개기 요청을 취소했어요.'
export const DISCARDED_TOAST = '제안을 버렸어요.'

export const agoLabel = (iso: string, now: number): string => {
  const at = Date.parse(iso)
  if (Number.isNaN(at)) return ''
  const minutes = Math.max(1, Math.round((now - at) / 60000))
  if (minutes < 60) return `${minutes}분 전`
  if (minutes < 1440) return `${Math.round(minutes / 60)}시간 전`
  return `${Math.round(minutes / 1440)}일 전`
}

export const quotaLine = (quota: SplitQuota): string =>
  `오늘 ${quota.limit}번 중 ${quota.remaining}번 남음`

const spendsOne = (quota: SplitQuota): string =>
  `오늘 ${quota.limit}번 중 1번을 써요. 맡기고 나면 ${quota.remaining - 1}번 남아요.`

export const requestConfirm = (quota: SplitQuota): ConfirmAsk => ({
  title: '쪼개기를 맡길까요?',
  body: spendsOne(quota),
  confirmLabel: '쪼개기 맡기기',
  cancelLabel: '나중에',
})

export const CANCEL_CONFIRM: ConfirmAsk = {
  title: '쪼개기 요청을 취소할까요?',
  body: '취소해도 횟수는 돌아오지 않아요.',
  confirmLabel: '요청 취소',
  cancelLabel: '그대로 두기',
}

export const discardConfirm = (violationRemaining: boolean): ConfirmAsk => ({
  title: '제안을 버릴까요?',
  body: violationRemaining
    ? '횟수는 이미 돌려 드렸어요. 이 제안을 버릴까요?'
    : '이미 쓴 횟수는 돌아오지 않아요. 원본 작업은 그대로 남아요.',
  confirmLabel: '제안 버리기',
  cancelLabel: '그대로 두기',
})

export const lockNotice = (lock: SplitLock): { strong: string; rest: string } => {
  const processing = lock.stage === 'PROCESSING'
  if (lock.mine) {
    return processing
      ? { strong: '쪼개는 중이에요', rest: '준비되면 알려 드릴게요.' }
      : { strong: '쪼개기 제안이 준비됐어요', rest: '제안을 보고 조각을 만들어 보세요.' }
  }
  const name = lock.requesterNickname || '다른 참여자'
  return {
    strong: processing ? `${name}님이 쪼개는 중이에요.` : `${name}님이 쪼개기 제안을 받았어요.`,
    rest: '',
  }
}

export const lockChipLabel = (stage: SplitLockStage): string =>
  stage === 'PROCESSING' ? '쪼개는 중' : '쪼개기 제안 준비됨'

export const failureText = (reason: SplitFailureReason | null): string => {
  switch (reason) {
    case 'PROVIDER_UNAVAILABLE':
      return 'AI 제공자가 응답하지 않았어요.'
    case 'PROPOSAL_UNUSABLE':
      return '받은 제안을 읽을 수 없었어요.'
    case 'PROCESSING_TIMEOUT':
      return '처리 시간이 너무 오래 걸렸어요.'
    default:
      return '쪼개기를 끝내지 못했어요.'
  }
}

export const inboxStateLabel = (status: SplitRequestItem['status']): string => {
  switch (status) {
    case 'QUEUED':
    case 'RUNNING':
      return '쪼개는 중'
    case 'READY':
      return '준비됨'
    case 'FAILED':
      return '실패'
    default:
      return ''
  }
}

export const inboxNote = (
  item: SplitRequestItem,
  now: number,
  formatDay: (iso: string) => string,
): string => {
  switch (item.status) {
    case 'QUEUED':
    case 'RUNNING': {
      const ago = agoLabel(item.requestedAt, now)
      return ago ? `${ago} 요청` : ''
    }
    case 'READY': {
      const parts: string[] = []
      if (item.pieceCount != null) parts.push(`조각 ${item.pieceCount}개`)
      if (item.excludedCount != null && item.excludedCount > 0)
        parts.push(`뺀 조각 ${item.excludedCount}개`)
      if (item.expiresAt != null) parts.push(`${formatDay(item.expiresAt)}까지 보관`)
      return parts.join(' · ')
    }
    case 'FAILED':
      return `${failureText(item.failureReason)} 횟수는 돌려 드렸어요.`
    default:
      return ''
  }
}

export type Disclosure = { title: string; lead: string; sends: string; withholds: string; result: string }

export const disclosureFor = (
  version: string,
  provider: string,
  quota: SplitQuota,
): Disclosure | null => {
  if (version !== '1') return null
  return {
    title: '쪼개기에 AI를 써요',
    lead: `작업을 나누려면 아래 내용을 외부 AI 제공자(${provider})에게 보내야 해요. 처음 한 번만 물어봐요.`,
    sends:
      '이 작업의 제목·설명·마감·예상 시간·난이도와 마감이 지났는지, 스페이스 목적, 같은 프로젝트에서 최근 90일 동안 내가 끝낸 작업과 아직 하고 있는 작업의 제목과 설명(최근 것부터 100건씩), 내 난이도별 시간 보정 값',
    withholds: '다른 참여자가 맡은 작업, 담당자가 없는 작업, 닉네임, 프로젝트 목표, 핀잇 안의 작업 번호',
    result: `제안은 보관함에 7일 동안 있어요. ${spendsOne(quota)}`,
  }
}
