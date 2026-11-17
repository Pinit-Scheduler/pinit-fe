import { formatMinutesLabel } from '@shared/utils/isoDuration'
import type {
  SplitCheck,
  SplitCheckPiece,
  SplitOrderChoice,
  SplitPiece,
  SplitProposalView,
} from '../api/splitProposals'

/** 제안 화면 문구(ui-design §5.5~§5.7·§6). 값은 모두 서버 검사 결과에서 온다. */
export const LOADING = '제안을 불러오는 중이에요.'
export const MISSING = '더 이상 볼 수 없는 제안이에요.'
export const PROCESSED = '이미 처리된 요청이에요.'
export const TO_INBOX = '보관함으로'
export const EXPIRED_TITLE = '보관 기간이 끝난 제안이에요'
export const EXPIRED_REOPEN = '원본 열어 다시 쪼개기'
export const OVER_NOTE = '4시간 이상이에요. 그대로 만들 수 있지만 더 나누면 계획에 넣기 쉬워요.'
export const EDITED_TOAST = '조각을 고쳤어요.'
export const CYCLE = '순환'
export const PREVIOUS_HELP = {
  label: '이전 조각',
  title: '이전 조각이란?',
  body: '이 조각을 시작하기 전에 끝내야 하는 조각이에요. 고른 조각을 모두 끝내야 이 조각을 시작할 수 있어요.',
}

type FormatDay = (value: string) => string

export const expiredBody = (title: string | null): string =>
  `제안은 7일 동안만 보관해요. 아무것도 만들어지지 않았고, ${
    title == null ? '원본은' : `원본 "${title}"은`
  } 그대로 있으며 다시 고칠 수 있어요.`

/** 원본 마감이 없으면(null) 마감 칸을 뺀다. */
export const originLine = (proposal: SplitProposalView, formatDay: FormatDay): string =>
  [
    `원본 ${formatMinutesLabel(proposal.originalMinutes)}`,
    ...(proposal.originalDueDate == null ? [] : [`${formatDay(proposal.originalDueDate)} 마감`]),
    `${formatDay(proposal.expiresAt)}까지 보관`,
  ].join(' · ')

export const compareLine = (
  proposal: SplitProposalView,
  check: SplitCheck,
): { before: string; after: string } => ({
  before: `원본 ${formatMinutesLabel(proposal.originalMinutes)}`,
  after: formatMinutesLabel(check.totalMinutes),
})

export const applySummary = (check: SplitCheck): { main: string; warn: string } => ({
  main: `${check.selectedCount}개 · ${formatMinutesLabel(check.totalMinutes)}`,
  warn:
    check.problemCount > 0
      ? `고칠 곳 ${check.problemCount}개`
      : check.overCount > 0
        ? `4시간 이상 ${check.overCount}개`
        : '',
})

export const emptyText = (emptyReason: SplitCheck['emptyReason']): string =>
  emptyReason === 'ALL_EXCLUDED_BY_AI'
    ? '이미 끝낸 것 같아요. 아래 근거를 보고, 필요한 조각만 다시 넣어 주세요.'
    : '만들 조각이 없어요. 아래에서 조각을 다시 넣어 주세요.'

export const droppedTitle = (count: number): string => `뺀 조각 ${count}개`

export const droppedNote = (piece: SplitPiece, info: SplitCheckPiece | undefined): string => {
  const exclusion = piece.exclusion
  if (exclusion != null) {
    return exclusion.reason === 'ALREADY_DONE'
      ? `이미 끝낸 것 같아요 · ${exclusion.evidenceTitle}`
      : `겹치는 작업이 있어요 · ${exclusion.evidenceTitle}`
  }
  return `내가 뺌 · ${formatMinutesLabel(info?.shownMinutes ?? piece.minutes)}`
}

export const pieceNotes = (piece: SplitPiece, info: SplitCheckPiece | undefined): string[] => [
  ...(piece.exclusion?.reason === 'ALREADY_DONE'
    ? [`"${piece.exclusion.evidenceTitle}"에서 이미 끝냈을 수 있어요.`]
    : []),
  ...(info?.warnings ?? [])
    .filter((warning) => warning.kind === 'OVERLAPS_OPEN_TASK')
    .map((warning) => `"${warning.evidenceTitle}" 작업과 겹칠 수 있어요.`),
]

export const orderChoiceNote = (choice: SplitOrderChoice): string => {
  if (choice.blocked) return '순환이 생겨요'
  if (choice.link === 'VIA_EXCLUDED') return '뺀 조각을 거쳐 이어져 있어요'
  return ''
}

export const removedToast = (title: string): string => `"${title}" 조각을 뺐어요.`
export const restoredToast = (title: string): string => `"${title}" 조각을 다시 넣었어요.`

export const madeToast = (created: number, notInherited: number): string =>
  `조각 ${created}개를 만들었어요.${
    notInherited > 0 ? ` 반복 작업과의 선후관계 ${notInherited}개는 잇지 못했어요.` : ''
  }`

export const adminOnlyNotice = (
  admins: string[],
  attempted: boolean,
): { strong: string; body: string } => ({
  strong: attempted ? '만들지 못했어요. 이제 관리자만 할 수 있어요' : '이제 관리자만 만들 수 있어요',
  body: `쪼개면 원본이 휴지통으로 가는데, 이 스페이스에서 삭제는 관리자만 할 수 있어요. 그사이 내 권한이 바뀌었어요. ${
    admins.length ? `관리자 ${admins.join('·')}님에게` : '관리자에게'
  } 부탁하거나 제안을 버려 주세요. 버리면 원본 잠금이 풀려요.`,
})
