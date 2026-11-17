import { buildApiUrl } from '@shared/api/config'
import { httpClient } from '@shared/api/httpClient'

/**
 * 알림함 API(ADR-0035 §14.2·§14.3). 서버(Gate X6)가 아직 없어 모양은 가정이다.
 * 실제 서버와 맞출 때 이 모듈의 타입과 호출만 고친다.
 */
export type NoticeKind = 'SPLIT_READY' | 'SPLIT_FAILED'

export type Notice = {
  noticeId: string
  /** 모르는 종류도 올 수 있다 */
  kind: NoticeKind | string
  requestId: number
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
