import { buildApiUrl } from '@shared/api/config'
import { httpClient } from '@shared/api/httpClient'

/**
 * 알림함 API(ADR-0035 §14.2·§14.3). 서버 모양은 pinit-monolith `SplitNoticeController`·`SplitNoticeDtos`와 같다.
 * 목록은 최근 100건이고 `unreadCount`는 안 읽은 알림 전부다.
 */
export type NoticeKind = 'SPLIT_READY' | 'SPLIT_FAILED'

export type Notice = {
  noticeId: string
  /** 모르는 종류도 올 수 있다 */
  kind: NoticeKind | string
  requestId: number
  /** 서버는 늘 싣는다(1~255자). */
  originalTitle: string
  createdAt: string
  readAt: string | null
}

export type NoticeList = { unreadCount: number; items: Notice[] }

const NOTICES = '/notifications/notices'

export const fetchNotices = (signal?: AbortSignal) =>
  httpClient<NoticeList>(buildApiUrl(NOTICES, 'v2'), { signal })

export const fetchUnreadNoticeCount = (signal?: AbortSignal) =>
  httpClient<{ unreadCount: number }>(buildApiUrl(`${NOTICES}/unread-count`, 'v2'), { signal })

/** 응답 본문이 없다(204). 이미 읽은 알림이어도 같다. */
export const readNotice = (noticeId: string) =>
  httpClient<void>(buildApiUrl(`${NOTICES}/${noticeId}/read`, 'v2'), { method: 'POST' })

/** 조건에 맞는 안 읽은 알림을 모두 읽음으로 한다. 조건이 없으면 전부. */
export const readNotices = (filter: { kind?: NoticeKind; requestId?: number } = {}) =>
  httpClient<{ unreadCount: number }>(buildApiUrl(`${NOTICES}/read`, 'v2'), {
    method: 'POST',
    json: filter,
  })
