import { mockCategoryOwnerId } from './categories'
import {
  mockSplitFixtures,
  mockSplitRequests,
  onMockSplitFinished,
} from './taskSplit'

/** 알림함 mock(ADR-0035 §14). 모양과 문구는 서버 pinit-monolith `SplitNoticeController`·`SplitNoticeControllerAdvice`와 같다. */
type MockNotice = {
  noticeId: string
  memberId: number
  kind: 'SPLIT_READY' | 'SPLIT_FAILED'
  requestId: number
  originalTitle: string
  createdAt: string
  readAt: string | null
}

const DEMO = 1
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export const mockNotices: MockNotice[] = []

/** `delayMs`가 0보다 크면 알림이 그만큼 늦게 생긴다. 브라우저의 `mockServer.ts`가 1500으로 둔다. */
export const mockNoticeSettings = { delayMs: 0 }

let noticeSeq = 0
const nextNoticeId = () =>
  `3f2b6c1e-0000-4000-8000-${String(++noticeSeq).padStart(12, '0')}`

const ago = (ms: number) => new Date(Date.now() - ms).toISOString()

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

const insert = (
  memberId: number,
  kind: MockNotice['kind'],
  requestId: number,
  originalTitle: string,
  createdAt: string,
  readAt: string | null = null,
) => {
  // 요청 하나에 알림은 하나다.
  if (mockNotices.some((notice) => notice.requestId === requestId)) return
  mockNotices.push({
    noticeId: nextNoticeId(),
    memberId,
    kind,
    requestId,
    originalTitle,
    createdAt,
    readAt,
  })
}

export const addMockNotice = (
  memberId: number,
  kind: MockNotice['kind'],
  requestId: number,
  originalTitle: string,
): void => {
  const add = () =>
    insert(memberId, kind, requestId, originalTitle, new Date().toISOString())
  if (mockNoticeSettings.delayMs > 0) setTimeout(add, mockNoticeSettings.delayMs)
  else add()
}

onMockSplitFinished((request) => {
  addMockNotice(
    request.memberId,
    request.status === 'FAILED' ? 'SPLIT_FAILED' : 'SPLIT_READY',
    request.requestId,
    request.originalTitle,
  )
})

const seed = (
  key: 'ready' | 'failed' | 'applied',
  kind: MockNotice['kind'],
  agoMs: number,
  read: boolean,
) => {
  const requestId = mockSplitFixtures[key].requestId
  const request = mockSplitRequests.find((item) => item.requestId === requestId)
  if (requestId == null || !request) return
  insert(
    DEMO,
    kind,
    requestId,
    request.originalTitle,
    ago(agoMs),
    read ? ago(agoMs - 10 * MINUTE) : null,
  )
}
seed('ready', 'SPLIT_READY', 35 * MINUTE, false)
seed('failed', 'SPLIT_FAILED', 23 * HOUR, false)
seed('applied', 'SPLIT_READY', 2 * DAY, true)

const mineOf = (actor: number) =>
  mockNotices
    .filter((notice) => notice.memberId === actor)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
const unreadOf = (actor: number) =>
  mockNotices.filter((notice) => notice.memberId === actor && notice.readAt == null).length

const viewOf = (notice: MockNotice) => ({
  noticeId: notice.noticeId,
  kind: notice.kind,
  requestId: notice.requestId,
  originalTitle: notice.originalTitle,
  createdAt: notice.createdAt,
  readAt: notice.readAt,
})

const NOTICE_NOT_FOUND = '알림을 찾을 수 없어요.'
const UNREADABLE_BODY = '요청을 처리하지 못했어요. 화면을 새로고침한 뒤 다시 시도해 주세요.'
const TITLES: Record<number, string> = { 400: 'Bad Request', 404: 'Not Found' }

/** 서버 `SplitNoticeControllerAdvice`: `ProblemDetail`(type은 about:blank라 빠진다)에 `message`, 없는 알림이면 `code`. */
const problem = (status: number, message: string, instance: string, code?: string) =>
  json(
    {
      detail: message,
      instance,
      status,
      title: TITLES[status],
      message,
      ...(code ? { code } : {}),
    },
    status,
  )

/**
 * 묶어 읽기(N4)의 본문. 서버는 `@RequestBody(required = false)`라 본문이 없거나 `null`이면 `{}`와 같고, 모르는 속성은
 * 무시한다. JSON으로 읽을 수 없거나 객체가 아니거나 칸의 형이 틀리면 400, 본문이 있는데 JSON이 아니면 415(본문 없음)다.
 */
const readFilter = async (
  request: Request,
): Promise<{ kind?: string | null; requestId?: number | null } | Response> => {
  const raw = await request.text()
  if (!raw) return {}
  const type = request.headers.get('Content-Type') ?? ''
  if (!/^application\/(?:[\w.+-]+\+)?json\b/i.test(type)) return new Response(null, { status: 415 })
  const unreadable = () => problem(400, UNREADABLE_BODY, new URL(request.url).pathname)
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return unreadable()
  }
  if (parsed === null) return {}
  if (typeof parsed !== 'object' || Array.isArray(parsed)) return unreadable()
  const { kind, requestId } = parsed as { kind?: unknown; requestId?: unknown }
  // Jackson은 문자열 칸에 숫자·불리언을, 숫자 칸에 숫자 모양의 문자열을 받아 준다.
  if (kind != null && typeof kind === 'object') return unreadable()
  const id = typeof requestId === 'string' && /^-?\d+$/.test(requestId.trim()) ? Number(requestId) : requestId
  if (id != null && (typeof id !== 'number' || !Number.isFinite(id))) return unreadable()
  return {
    kind: kind == null ? null : String(kind),
    requestId: id == null ? null : Math.trunc(id as number),
  }
}

const NOTICE_PATH = /^\/v2\/notifications\/notices(\/|$)/
const PREFERENCES_PATH = '/v2/notifications/preferences'

/**
 * 알림 설정 mock. 쪼개기 항목(`taskSplitEnabled`, ADR-0035 §14.4)은 서버 `NotificationPreferenceRequest`와 같이
 * PUT은 본문 전체 교체지만 `taskSplitEnabled`가 null이거나 없으면 저장된 값을 둔다(그 항목을 모르는 화면의 저장).
 */
let preferences = {
  scheduleStartEnabled: true,
  scheduleReminderMinutes: null as number | null,
  taskDeadlineEnabled: false,
  taskDeadlineTime: '09:00',
  zoneId: 'Asia/Seoul',
  taskSplitEnabled: true,
}

export const handleNotices = async (
  path: string,
  method: string,
  request: Request,
): Promise<Response | null> => {
  if (!NOTICE_PATH.test(path) && path !== PREFERENCES_PATH) return null
  const actor = mockCategoryOwnerId(request)
  if (!actor) return json({ message: '로그인이 필요합니다.' }, 401)

  if (path === PREFERENCES_PATH && method === 'GET') return json(preferences)
  if (path === PREFERENCES_PATH && method === 'PUT') {
    const body = (await request.json().catch(() => ({}))) as Partial<typeof preferences>
    preferences = {
      scheduleStartEnabled: body.scheduleStartEnabled ?? preferences.scheduleStartEnabled,
      scheduleReminderMinutes: body.scheduleReminderMinutes ?? null,
      taskDeadlineEnabled: body.taskDeadlineEnabled ?? preferences.taskDeadlineEnabled,
      taskDeadlineTime: body.taskDeadlineTime ?? preferences.taskDeadlineTime,
      zoneId: body.zoneId ?? preferences.zoneId,
      taskSplitEnabled: body.taskSplitEnabled ?? preferences.taskSplitEnabled,
    }
    return json(preferences)
  }

  if (path === '/v2/notifications/notices' && method === 'GET')
    return json({
      unreadCount: unreadOf(actor),
      items: mineOf(actor).slice(0, 100).map(viewOf),
    })
  if (path === '/v2/notifications/notices/unread-count' && method === 'GET')
    return json({ unreadCount: unreadOf(actor) })
  if (path === '/v2/notifications/notices/read' && method === 'POST') {
    const filter = await readFilter(request)
    if (filter instanceof Response) return filter
    const now = new Date().toISOString()
    for (const notice of mockNotices) {
      if (notice.memberId !== actor || notice.readAt != null) continue
      if (filter.kind != null && notice.kind !== filter.kind) continue
      if (filter.requestId != null && notice.requestId !== filter.requestId) continue
      notice.readAt = now
    }
    return json({ unreadCount: unreadOf(actor) })
  }
  const one = path.match(/^\/v2\/notifications\/notices\/([^/]+)\/read$/)
  if (one && method === 'POST') {
    const notice = mockNotices.find(
      (item) => item.noticeId === one[1] && item.memberId === actor,
    )
    if (!notice) return problem(404, NOTICE_NOT_FOUND, path, 'NOTICE_NOT_FOUND')
    if (notice.readAt == null) notice.readAt = new Date().toISOString()
    return new Response(null, { status: 204 })
  }
  return null
}
