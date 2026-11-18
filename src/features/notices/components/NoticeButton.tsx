import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import Modal from '@shared/components/common/Modal'
import WorkspaceIcon from '@shared/components/common/WorkspaceIcon'
import { getRequestFailureMessage } from '@shared/api/errorMessage'
import { useToast } from '@contexts/ToastContext'
import { SPLIT_INBOX_PATH } from '@features/task-split/utils/splitPaths'
import { fetchNotices, readNotice, readNotices, type Notice } from '../api/notices'
import { useNoticeRefresh, useNoticeUnread } from '../hooks/useNoticeUnread'
import { bellLabel, type NoticeView } from '../utils/noticeView'
import NoticeList from './NoticeList'
import '../notices.css'

type Loaded =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'ready'; items: Notice[]; now: number }

/**
 * 상단 바의 알림 종과 알림함. 알림은 무슨 일이 있었는지만 알리고, 누르면 그 일이 있는 화면으로 보낸다.
 * 요청을 취소하거나 버리는 일은 쪼개기 보관함의 몫이다. 안 읽은 수를 한 번이라도 읽기 전에는 종을 그리지 않는다
 * (알림함이 없는 서버). 그동안에도 다시 읽기는 이어 간다.
 */
const NoticeButton = () => {
  const { unread, known, setUnread, refetch } = useNoticeUnread()
  useNoticeRefresh(refetch)
  const navigate = useNavigate()
  const { addToast } = useToast()
  const [open, setOpen] = useState(false)
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    fetchNotices(controller.signal)
      .then((list) => {
        if (controller.signal.aborted) return
        setLoaded({ state: 'ready', items: list?.items ?? [], now: Date.now() })
        if (list?.unreadCount != null) setUnread(list.unreadCount)
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setLoaded({
          state: 'error',
          message: getRequestFailureMessage(error, '알림을 불러오지 못했어요.'),
        })
      })
    return () => controller.abort()
  }, [open, setUnread])

  const go = (to: string) => {
    setOpen(false)
    navigate(to)
  }

  const openNotice = (notice: Notice, view: NoticeView) => {
    readNotice(notice.noticeId)
      .catch(() => {})
      .finally(refetch)
    go(view.target)
  }

  const readAll = async () => {
    try {
      const result = await readNotices()
      if (result?.unreadCount != null) setUnread(result.unreadCount)
      const at = new Date().toISOString()
      setLoaded((current) =>
        current.state === 'ready'
          ? {
              ...current,
              items: current.items.map((item) =>
                item.readAt == null ? { ...item, readAt: at } : item,
              ),
            }
          : current,
      )
    } catch (error) {
      addToast(getRequestFailureMessage(error, '알림을 읽음으로 하지 못했어요.'), 'error')
    }
  }

  if (!known) return null
  return (
    <>
      <button
        type="button"
        className="top-bar__icon-button split-topbar"
        aria-label={bellLabel(unread)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="알림"
        onClick={() => {
          if (!open) setLoaded({ state: 'loading' })
          setOpen(!open)
        }}
      >
        <WorkspaceIcon name="bell" />
        {unread > 0 && <span className="split-badge">{unread}</span>}
      </button>
      {open &&
        createPortal(
          <Modal
            backdropClassName="split-panel__backdrop"
            className="split-panel"
            ariaLabel="알림"
            sheet
            onClose={() => setOpen(false)}
          >
            <NoticeList
              items={loaded.state === 'ready' ? loaded.items : []}
              unread={unread}
              now={loaded.state === 'ready' ? loaded.now : 0}
              message={
                loaded.state === 'loading'
                  ? '알림을 불러오는 중이에요.'
                  : loaded.state === 'error'
                    ? loaded.message
                    : null
              }
              onOpen={openNotice}
              onReadAll={readAll}
              onOpenInbox={() => go(SPLIT_INBOX_PATH)}
              onClose={() => setOpen(false)}
            />
          </Modal>,
          document.querySelector('.workspace-theme') ?? document.body,
        )}
    </>
  )
}

export default NoticeButton
