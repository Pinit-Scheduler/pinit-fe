import { useEffect, useRef } from 'react'
import { readNotices, type NoticeKind } from '../api/notices'
import { useNoticeUnread } from './useNoticeUnread'

export type NoticeReadFilter = { kind: NoticeKind; requestId?: number }

/**
 * filter가 있는 동안: 처음 한 번 읽음으로 바꾸고, 그 뒤 안 읽은 수가 늘 때마다 한 번 더 바꾼다. 실패는 알리지 않는다.
 * 서버는 제안이나 보관함을 보여 줄 때 알림을 읽음으로 하지 않는다(ADR-0035 §14.2). 알림은 제안이 준비된 조금 뒤에
 * 생길 수 있어, 종이 다시 읽은 수가 늘면 한 번 더 부른다. 종이 수를 다시 읽는 때는 `useNoticeRefresh`가 정한다.
 */
export const useReadNoticesWhileOpen = (filter: NoticeReadFilter | null) => {
  const { unread, setUnread } = useNoticeUnread()
  const kind = filter?.kind
  const requestId = filter?.requestId
  /** 지금 읽음으로 바꾸는 대상. 바뀌면 처음 연 것으로 본다. */
  const openedRef = useRef<string | null>(null)
  /** 직전에 본 안 읽은 수. 이보다 커져야 다시 부른다. */
  const seenRef = useRef(0)
  /** 가장 늦게 보낸 호출. 그보다 먼저 보낸 호출의 응답은 버린다. */
  const callRef = useRef(0)

  useEffect(() => {
    if (kind == null) {
      openedRef.current = null
      return
    }
    const target = `${kind}:${requestId ?? ''}`
    const opened = openedRef.current !== target
    const grew = unread > seenRef.current
    openedRef.current = target
    seenRef.current = unread
    if (!opened && !grew) return
    const call = ++callRef.current
    readNotices(requestId == null ? { kind } : { kind, requestId })
      .then((result) => {
        if (call !== callRef.current || result?.unreadCount == null) return
        // 자기 호출로 바뀐 수는 본 값으로만 삼는다. 이것으로 다시 부르지 않는다.
        seenRef.current = result.unreadCount
        setUnread(result.unreadCount)
      })
      .catch(() => {
        // 종은 앱을 막지 않는다. 다음에 수가 늘면 그때 다시 부른다.
      })
  }, [kind, requestId, unread, setUnread])
}
