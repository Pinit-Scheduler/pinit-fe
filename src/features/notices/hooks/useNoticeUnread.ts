import { useCallback, useEffect, useRef } from 'react'
import { useRevalidatingQuery } from '@shared/hooks/useRevalidatingQuery'
import { onDataChanged } from '@shared/utils/events'
import { fetchUnreadNoticeCount } from '../api/notices'

export const NOTICE_UNREAD_KEY = 'notices/unread-count'
/** 작업이 바뀐 뒤 알림이 늦게 생길 수 있어 이만큼 뒤에 한 번 더 읽는다. */
export const NOTICE_RECHECK_DELAY_MS = 3000
export const NOTICE_POLL_MS = 60000

/**
 * 알림함의 안 읽은 수. 읽지 못했으면 0이다. `known`은 한 번이라도 읽었는지다: 알림함이 없는 서버(옛 백엔드,
 * 기능이 꺼진 배포)에서는 끝까지 false다.
 */
export const useNoticeUnread = () => {
  const { data, refetch, setData } = useRevalidatingQuery(
    NOTICE_UNREAD_KEY,
    fetchUnreadNoticeCount,
    { invalidateOn: ['task'], refetchOnFocus: true, revalidateOnMount: false },
  )
  const setUnread = useCallback((count: number) => setData({ unreadCount: count }), [setData])
  return { unread: data?.unreadCount ?? 0, known: data !== undefined, setUnread, refetch }
}

/**
 * 안 읽은 수를 제때 다시 읽는다: 작업이 바뀐 조금 뒤, 창이 다시 보일 때, 창이 보이는 동안 일정 간격으로.
 * 종 하나만 부른다.
 */
export const useNoticeRefresh = (refetch: () => void) => {
  const refetchRef = useRef(refetch)
  useEffect(() => {
    refetchRef.current = refetch
  })
  useEffect(() => {
    let recheck: ReturnType<typeof setTimeout> | undefined
    const offChange = onDataChanged(() => {
      if (recheck !== undefined) clearTimeout(recheck)
      recheck = setTimeout(() => {
        recheck = undefined
        refetchRef.current()
      }, NOTICE_RECHECK_DELAY_MS)
    }, ['task'])
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refetchRef.current()
    }
    document.addEventListener('visibilitychange', onVisibility)
    const poll = setInterval(() => {
      if (document.visibilityState === 'visible') refetchRef.current()
    }, NOTICE_POLL_MS)
    return () => {
      offChange()
      if (recheck !== undefined) clearTimeout(recheck)
      document.removeEventListener('visibilitychange', onVisibility)
      clearInterval(poll)
    }
  }, [])
}
