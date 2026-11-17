import { SPLIT_INBOX_PATH, splitProposalPath } from '@features/task-split/utils/splitPaths'
import type { Notice } from '../api/notices'

export type NoticeView = { title: string; icon: 'split' | 'warning'; target: string }

/** 알림 종류 표. 새 종류는 여기에 줄을 더한다. 알림은 알리고 그 일이 있는 화면으로 보내기만 한다. */
const VIEWS: Record<string, (notice: Notice) => NoticeView> = {
  SPLIT_READY: (notice) => ({
    title: '쪼개기 제안이 준비됐어요',
    icon: 'split',
    target: splitProposalPath(notice.requestId),
  }),
  SPLIT_FAILED: () => ({
    title: '쪼개기를 끝내지 못했어요',
    icon: 'warning',
    target: SPLIT_INBOX_PATH,
  }),
}

/** 모르는 종류는 null이다(목록에서 뺀다). */
export const noticeViewOf = (notice: Notice): NoticeView | null => {
  const view = Object.prototype.hasOwnProperty.call(VIEWS, notice.kind) ? VIEWS[notice.kind] : null
  return view == null ? null : view(notice)
}

export const bellLabel = (unread: number): string =>
  unread > 0 ? `알림, 새 알림 ${unread}개` : '알림'

export const NOTICE_EMPTY = '새 알림이 없어요.'
