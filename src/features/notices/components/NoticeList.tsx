import WorkspaceIcon from '@shared/components/common/WorkspaceIcon'
import { agoLabel } from '@features/task-split/utils/splitLabels'
import type { Notice } from '../api/notices'
import { NOTICE_EMPTY, noticeViewOf, type NoticeView } from '../utils/noticeView'

type NoticeListProps = {
  items: Notice[]
  unread: number
  now: number
  /** 읽는 중이거나 읽지 못했을 때 목록 대신 보이는 말. */
  message?: string | null
  onOpen: (notice: Notice, view: NoticeView) => void
  onReadAll: () => void
  onOpenInbox: () => void
  onClose: () => void
}

/**
 * 알림함 패널의 내용. 알림은 무슨 일이 있었는지만 알리고, 누르면 그 일이 있는 화면으로 보낸다.
 * 취소하거나 버리는 일은 쪼개기 보관함의 몫이라 여기에 버튼을 두지 않는다.
 */
const NoticeList = ({
  items,
  unread,
  now,
  message,
  onOpen,
  onReadAll,
  onOpenInbox,
  onClose,
}: NoticeListProps) => {
  const shown = items.flatMap((notice) => {
    const view = noticeViewOf(notice)
    return view == null ? [] : [{ notice, view }]
  })
  return (
    <>
      <header className="split-panel__head">
        <h2>알림</h2>
        <span />
        {unread > 0 && (
          <button type="button" className="split-panel__link" onClick={onReadAll}>
            모두 읽음
          </button>
        )}
        <button type="button" aria-label="닫기" onClick={onClose}>
          <WorkspaceIcon name="close" />
        </button>
      </header>
      {message != null ? (
        <p className="split-panel__empty" role="status">
          {message}
        </p>
      ) : shown.length === 0 ? (
        <p className="split-panel__empty">{NOTICE_EMPTY}</p>
      ) : (
        <ul className="notice-list">
          {shown.map(({ notice, view }) => (
            <li key={notice.noticeId}>
              <button
                type="button"
                className="notice"
                data-unread={notice.readAt == null || undefined}
                onClick={() => onOpen(notice, view)}
              >
                <span className="notice__icon" data-kind={view.icon}>
                  <WorkspaceIcon name={view.icon} />
                </span>
                <span className="notice__body">
                  <strong>{view.title}</strong>
                  <span>{notice.originalTitle ?? '작업'}</span>
                  <small>{agoLabel(notice.createdAt, now)}</small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="split-panel__foot" onClick={onOpenInbox}>
        쪼개기 보관함 열기
      </button>
    </>
  )
}

export default NoticeList
