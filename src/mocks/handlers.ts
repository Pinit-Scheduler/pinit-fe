import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
import duration from 'dayjs/plugin/duration'
import type { DateTimeWithZone } from '../shared/types/datetime'
import type { Task, TaskRequest } from '../features/tasks/types/task'
import type { ScheduleRequest, ScheduleResponse } from '../features/schedules/types/schedule'
import type { StatisticsResponse } from '../features/statistics/types/statistics'
import type { PushTokenRequest } from '../features/settings/api/notifications'
import type { LoginPayload, SignupPayload, SocialLoginPayload } from '../features/auth/api/auth'
import {
  activeScheduleId,
  makeToken,
  mockPushSubscriptions,
  mockSchedules,
  mockTasks,
  mockUsers,
  nextScheduleId,
  nextTaskId,
  setActiveScheduleId,
  vapidPublicKey,
} from './db'

dayjs.extend(utc)
dayjs.extend(timezone)
dayjs.extend(duration)

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

const text = (value: string, status = 200) =>
  new Response(value, {
    status,
    headers: { 'Content-Type': 'text/plain' },
  })

const noContent = (status = 204) => new Response(null, { status })

const notFound = (message = 'Not found') => json({ message }, 404)

const readJson = async <T>(request: Request): Promise<T | null> => {
  const raw = await request.text()
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

const toDayKey = (date: DateTimeWithZone) =>
  dayjs.tz(date.dateTime, date.zoneId || 'UTC').format('YYYY-MM-DD')

const parseDurationMinutes = (value?: string | null) => {
  if (!value) return 0
  if (value.startsWith('P')) {
    return Math.floor(dayjs.duration(value).asMinutes())
  }
  const parts = value.split(':')
  if (parts.length >= 2) {
    const [h, m, s = '0'] = parts
    return Math.floor(Number(h) * 60 + Number(m) + Number(s) / 60)
  }
  return 0
}

const formatIsoMinutes = (minutes: number) => {
  const safe = Math.max(0, Math.floor(minutes))
  const h = Math.floor(safe / 60)
  const m = safe % 60
  return `PT${h}H${m}M`
}

const getTargetDateFromQuery = (searchParams: URLSearchParams): DateTimeWithZone => {
  const dateTime = searchParams.get('time')
  const zoneId = searchParams.get('zoneId') || 'Asia/Seoul'
  if (dateTime) {
    return { dateTime, zoneId }
  }
  const now = dayjs().tz(zoneId).format('YYYY-MM-DDTHH:mm:ss')
  return { dateTime: now, zoneId }
}

const findTask = (id: number) => mockTasks.find((task) => task.id === id)

const toTaskResponse = (task: Task) => ({
  id: task.id,
  title: task.title,
  description: task.description,
  dueDate: task.dueDate,
  importance: task.importance,
  difficulty: task.difficulty,
  completed: task.completed ?? task.isCompleted ?? false,
  inboundDependencyCount: task.inboundDependencyCount ?? 0,
  previousTaskIds: task.previousTaskIds ?? [],
  nextTaskIds: task.nextTaskIds ?? [],
  ownerId: task.ownerId ?? 1,
  createdAt: task.createdAt ?? new Date().toISOString(),
  updatedAt: task.updatedAt ?? new Date().toISOString(),
})
const findSchedule = (id: number) => mockSchedules.find((schedule) => schedule.id === id)

const handleAuth = async (path: string, method: string, request: Request) => {
  if (method === 'POST' && path === '/v0/login') {
    const body = await readJson<LoginPayload>(request)
    const user = mockUsers.find(
      (candidate) => candidate.username === body?.username && candidate.password === body?.password,
    )
    if (!user) return json({ message: '아이디 또는 비밀번호가 잘못되었습니다.' }, 401)
    return json({ token: makeToken(user.id), refreshToken: 'mock-refresh' })
  }

  if (method === 'POST' && path === '/v0/signup') {
    const body = await readJson<SignupPayload>(request)
    if (!body?.username || !body.password || !body.nickname) {
      return json({ message: 'username, password, nickname이 필요합니다.' }, 400)
    }
    if (mockUsers.some((user) => user.username === body.username)) {
      return json({ message: '이미 존재하는 아이디입니다.' }, 409)
    }
    const nextId = mockUsers[mockUsers.length - 1]?.id + 1 || 1
    mockUsers.push({
      id: nextId,
      username: body.username,
      password: body.password,
      nickname: body.nickname,
      zoneOffset: 'UTC+09:00',
    })
    return noContent(201)
  }

  if (method === 'POST' && path === '/v0/logout') {
    return noContent(204)
  }

  if (method === 'POST' && path === '/v0/refresh') {
    return json({ token: makeToken(1), refreshToken: 'mock-refresh' })
  }

  const socialLoginMatch = path.match(/^\/v0\/login\/oauth2\/code\/([^/]+)$/)
  if (method === 'GET' && socialLoginMatch) {
    const body = await readJson<SocialLoginPayload>(request)
    if (body?.error) {
      return json({ message: body.errorDescription || '소셜 로그인 실패' }, 400)
    }
    return json({ token: makeToken(1), refreshToken: 'mock-refresh' })
  }

  return null
}

const handleNotifications = async (path: string, method: string, request: Request, searchParams: URLSearchParams) => {
  if (method === 'GET' && path === '/v0/push/vapid') {
    return text(vapidPublicKey)
  }

  if (method === 'POST' && path === '/v0/push/subscribe') {
    const body = await readJson<PushTokenRequest>(request)
    if (!body?.deviceId || !body.token) {
      return json({ message: 'deviceId와 token이 필요합니다.' }, 400)
    }
    const existing = mockPushSubscriptions.get(body.deviceId) ?? new Set<string>()
    existing.add(body.token)
    mockPushSubscriptions.set(body.deviceId, existing)
    return noContent(204)
  }

  if (method === 'POST' && path === '/v0/push/unsubscribe') {
    const body = await readJson<PushTokenRequest>(request)
    if (!body?.deviceId || !body.token) {
      return json({ message: 'deviceId와 token이 필요합니다.' }, 400)
    }
    const existing = mockPushSubscriptions.get(body.deviceId)
    existing?.delete(body.token)
    return noContent(204)
  }

  if (method === 'GET' && path === '/v0/push/subscribed') {
    const deviceId = searchParams.get('deviceId')
    const tokens = deviceId ? mockPushSubscriptions.get(deviceId) : null
    return json(tokens ? tokens.size > 0 : false)
  }

  return null
}

const handleMember = (path: string, method: string) => {
  const normalizedPath = path.replace(/^\/v[0-9]+\//, '/')

  if (method === 'GET' && normalizedPath === '/members/zone-offset') {
    const offset = mockUsers[0]?.zoneOffset ?? 'UTC+00:00'
    return text(offset)
  }

  if (method === 'GET' && normalizedPath === '/members/now') {
    return json(activeScheduleId ?? null)
  }

  return null
}

const handleTasks = async (path: string, method: string, searchParams: URLSearchParams, request: Request) => {
  const normalizedPath = path.replace(/^\/v[0-9]+\//, '/')
  const today = dayjs().format('YYYY-MM-DD')

  const isCompletedTask = (task: Task) => task.completed ?? task.isCompleted ?? false
  const isOverdue = (task: Task) => {
    const due = task.dueDate?.date
    if (!due) return false
    return due < today
  }

  const visibleTaskFilter = (task: Task, readyOnly: boolean) => {
    if (readyOnly && ((task.completed ?? task.isCompleted) === true || (task.inboundDependencyCount ?? 0) > 0)) return false
    const completed = isCompletedTask(task)
    const overdue = isOverdue(task)
    // Show: not overdue OR not completed; i.e., hide completed+overdue
    if (completed && overdue) return false
    return true
  }

  const sortAscByDeadline = (a: Task, b: Task) => {
    const aDate = a.dueDate?.date ?? '9999-12-31'
    const bDate = b.dueDate?.date ?? '9999-12-31'
    if (aDate !== bDate) return aDate.localeCompare(bDate)
    return a.id - b.id
  }

  const sortArchiveDesc = (a: Task, b: Task) => {
    const aDate = a.dueDate?.date ?? '0000-01-01'
    const bDate = b.dueDate?.date ?? '0000-01-01'
    if (aDate !== bDate) return bDate.localeCompare(aDate)
    return b.id - a.id
  }

  if (method === 'GET' && normalizedPath === '/tasks') {
    const page = Number(searchParams.get('page') ?? 0)
    const size = Number(searchParams.get('size') ?? 20)
    const readyOnly = searchParams.get('readyOnly') === 'true'
    let items = mockTasks.filter((task) => visibleTaskFilter(task, readyOnly))
    items = items.sort(sortAscByDeadline)
    const start = page * size
    const paged = items.slice(start, start + size)
    const totalPages = Math.max(1, Math.ceil(items.length / size))
    const response = {
      content: paged.map(toTaskResponse),
      number: page,
      size,
      totalElements: items.length,
      totalPages,
      numberOfElements: paged.length,
      first: page === 0,
      last: page >= totalPages - 1,
      empty: paged.length === 0,
    }
    return json(response)
  }

  if (method === 'GET' && normalizedPath === '/tasks/cursor') {
    const size = Number(searchParams.get('size') ?? 20)
    const cursorValue = searchParams.get('cursor')
    const readyOnly = searchParams.get('readyOnly') === 'true'
    const items = mockTasks.filter((task) => visibleTaskFilter(task, readyOnly)).sort(sortAscByDeadline)
    const start = cursorValue ? Number(cursorValue) || 0 : 0
    const slice = items.slice(start, start + size)
    const nextCursor = start + size < items.length ? String(start + size) : null
    const response = {
      data: slice.map(toTaskResponse),
      hasNext: nextCursor !== null,
      nextCursor,
    }
    return json(response)
  }

  if (method === 'GET' && normalizedPath === '/tasks/completed') {
    const size = Math.max(1, Math.min(100, Number(searchParams.get('size') ?? 20)))
    const cursorValue = searchParams.get('cursor')
    const archived = mockTasks.filter((task) => isCompletedTask(task) && isOverdue(task)).sort(sortArchiveDesc)
    let startIndex = 0
    if (cursorValue) {
      const [datePart, idPart] = cursorValue.split('|')
      const cursorId = Number(idPart)
      const idx = archived.findIndex((task) => task.dueDate?.date === datePart && task.id === cursorId)
      startIndex = idx >= 0 ? idx + 1 : 0
    }
    const slice = archived.slice(startIndex, startIndex + size)
    const next = archived[startIndex + size]
    const nextCursor = next ? `${next.dueDate?.date ?? ''}|${next.id}` : null
    const response = {
      data: slice.map(toTaskResponse),
      hasNext: Boolean(nextCursor),
      nextCursor,
    }
    return json(response)
  }

  const completeMatch = normalizedPath.match(/^\/tasks\/(\d+)\/complete$/)
  if (method === 'POST' && completeMatch) {
    const id = Number(completeMatch[1])
    const task = findTask(id)
    if (!task) return notFound('Task not found')
    task.isCompleted = true
    task.completed = true
    return noContent(204)
  }

  const reopenMatch = normalizedPath.match(/^\/tasks\/(\d+)\/reopen$/)
  if (method === 'POST' && reopenMatch) {
    const id = Number(reopenMatch[1])
    const task = findTask(id)
    if (!task) return notFound('Task not found')
    task.isCompleted = false
    task.completed = false
    return noContent(204)
  }

  const assignMatch = normalizedPath.match(/^\/tasks\/(\d+)\/schedules$/)
  if (method === 'POST' && assignMatch) {
    const id = Number(assignMatch[1])
    const body = await readJson<{ date: DateTimeWithZone; scheduleType: ScheduleResponse['scheduleType']; title?: string; description?: string }>(request)
    const task = findTask(id)
    if (!task) return notFound('Task not found')
    const newId = nextScheduleId()
    mockSchedules.push({
      id: newId,
      ownerId: 1,
      title: body?.title ?? task.title,
      description: body?.description ?? task.description,
      date: body?.date ?? { dateTime: dayjs().utc().format('YYYY-MM-DDTHH:mm:ss'), zoneId: 'UTC' },
      scheduleType: body?.scheduleType ?? 'DEEP_WORK',
      state: 'NOT_STARTED',
      taskId: id,
      duration: '01:00:00',
    })
    return noContent(201)
  }

  const detailMatch = normalizedPath.match(/^\/tasks\/(\d+)$/)
  if (detailMatch && method === 'GET') {
    const id = Number(detailMatch[1])
    const task = findTask(id)
    if (!task) return notFound('Task not found')
    return json(toTaskResponse(task))
  }

  if (detailMatch && method === 'PATCH') {
    const id = Number(detailMatch[1])
    const task = findTask(id)
    if (!task) return notFound('Task not found')
    const body = await readJson<Partial<TaskRequest>>(request)
    Object.assign(task, body ?? {})
    task.updatedAt = new Date().toISOString()
    return json(toTaskResponse(task))
  }

  if (detailMatch && method === 'DELETE') {
    const id = Number(detailMatch[1])
    const index = mockTasks.findIndex((task) => task.id === id)
    if (index === -1) return notFound('Task not found')
    mockTasks.splice(index, 1)
    return noContent(204)
  }

  if (method === 'POST' && normalizedPath === '/tasks') {
    const body = await readJson<TaskRequest>(request)
    if (!body?.title || !body.description || !body.dueDate) {
      return json({ message: 'title, description, dueDate가 필요합니다.' }, 400)
    }
    const newTask: Task = {
      id: nextTaskId(),
      title: body.title,
      description: body.description,
      dueDate: body.dueDate,
      importance: body.importance ?? 5,
      difficulty: body.difficulty ?? 1,
      isCompleted: false,
      completed: false,
      inboundDependencyCount: body.addDependencies?.length ?? 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    mockTasks.push(newTask)
    return json(toTaskResponse(newTask), 201)
  }

  return null
}

const handleSchedules = async (path: string, method: string, searchParams: URLSearchParams, request: Request) => {
  const normalizedPath = path.replace(/^\/v[0-9]+\//, '/')

  if (method === 'GET' && normalizedPath === '/schedules/week') {
    const target = getTargetDateFromQuery(searchParams)
    const base = dayjs.tz(target.dateTime, target.zoneId || 'UTC')
    const start = base.startOf('week')
    const end = start.add(7, 'day')
    const list = mockSchedules.filter((schedule) => {
      const date = dayjs.tz(schedule.date.dateTime, schedule.date.zoneId || 'UTC')
      return date.isSame(start, 'week') || (date.isAfter(start) && date.isBefore(end))
    })
    return json(list)
  }

  if (method === 'GET' && normalizedPath === '/schedules') {
    const target = getTargetDateFromQuery(searchParams)
    const key = toDayKey(target)
    const list = mockSchedules.filter((schedule) => toDayKey(schedule.date) === key)
    return json(list)
  }

  const startMatch = normalizedPath.match(/^\/schedules\/(\d+)\/start$/)
  if (method === 'POST' && startMatch) {
    const id = Number(startMatch[1])
    const schedule = findSchedule(id)
    if (!schedule) return notFound('Schedule not found')
    setActiveScheduleId(id, 'IN_PROGRESS')
    return noContent(204)
  }

  const suspendMatch = normalizedPath.match(/^\/schedules\/(\d+)\/suspend$/)
  if (method === 'POST' && suspendMatch) {
    const id = Number(suspendMatch[1])
    const schedule = findSchedule(id)
    if (!schedule) return notFound('Schedule not found')
    schedule.state = 'SUSPENDED'
    setActiveScheduleId(schedule.id === activeScheduleId ? null : activeScheduleId)
    return noContent(204)
  }

  const completeMatch = normalizedPath.match(/^\/schedules\/(\d+)\/complete$/)
  if (method === 'POST' && completeMatch) {
    const id = Number(completeMatch[1])
    const schedule = findSchedule(id)
    if (!schedule) return notFound('Schedule not found')
    schedule.state = 'COMPLETED'
    if (activeScheduleId === id) setActiveScheduleId(null)
    return noContent(204)
  }

  const cancelMatch = normalizedPath.match(/^\/schedules\/(\d+)\/cancel$/)
  if (method === 'POST' && cancelMatch) {
    const id = Number(cancelMatch[1])
    const schedule = findSchedule(id)
    if (!schedule) return notFound('Schedule not found')
    schedule.state = 'NOT_STARTED'
    if (activeScheduleId === id) setActiveScheduleId(null)
    return noContent(204)
  }

  const detailMatch = normalizedPath.match(/^\/schedules\/(\d+)$/)
  if (detailMatch && method === 'GET') {
    const id = Number(detailMatch[1])
    const schedule = findSchedule(id)
    if (!schedule) return notFound('Schedule not found')
    return json(schedule)
  }

  if (detailMatch && method === 'PATCH') {
    const id = Number(detailMatch[1])
    const schedule = findSchedule(id)
    if (!schedule) return notFound('Schedule not found')
    const body = await readJson<Partial<ScheduleRequest>>(request)
    Object.assign(schedule, body ?? {})
    return json(schedule)
  }

  if (detailMatch && method === 'DELETE') {
    const id = Number(detailMatch[1])
    const index = mockSchedules.findIndex((schedule) => schedule.id === id)
    if (index === -1) return notFound('Schedule not found')
    mockSchedules.splice(index, 1)
    if (activeScheduleId === id) setActiveScheduleId(null)
    return noContent(204)
  }

  if (method === 'POST' && normalizedPath === '/schedules') {
    const body = await readJson<ScheduleRequest>(request)
    if (!body?.title || !body.description || !body.date || !body.scheduleType) {
      return json({ message: 'title, description, date, scheduleType가 필요합니다.' }, 400)
    }
    const newSchedule: ScheduleResponse = {
      id: nextScheduleId(),
      ownerId: 1,
      title: body.title,
      description: body.description,
      date: body.date,
      scheduleType: body.scheduleType,
      state: 'NOT_STARTED',
      taskId: body.taskId,
      duration: '01:00:00',
    }
    mockSchedules.push(newSchedule)
    return json(newSchedule, 201)
  }

  return null
}

const handleStatistics = (path: string, method: string, searchParams: URLSearchParams) => {
  const normalizedPath = path.replace(/^\/v[0-9]+\//, '/')
  if (method !== 'GET' || normalizedPath !== '/statistics') return null
  const target = getTargetDateFromQuery(searchParams)
  const zoneId = target.zoneId || 'UTC'
  const startOfWeek = dayjs.tz(target.dateTime, zoneId).startOf('week')

  const deepMinutes = mockSchedules
    .filter((item) => item.scheduleType === 'DEEP_WORK')
    .reduce((sum, item) => sum + parseDurationMinutes(item.duration), 0)

  const adminMinutes = mockSchedules
    .filter((item) => item.scheduleType === 'ADMIN_TASK')
    .reduce((sum, item) => sum + parseDurationMinutes(item.duration), 0)

  const totalMinutes = mockSchedules.reduce((sum, item) => sum + parseDurationMinutes(item.duration), 0)

  const response: StatisticsResponse = {
    memberId: 1,
    startOfWeek: {
      dateTime: startOfWeek.format('YYYY-MM-DDTHH:mm:ss'),
      zoneId,
    },
    deepWorkElapsedTime: formatIsoMinutes(deepMinutes),
    adminWorkElapsedTime: formatIsoMinutes(adminMinutes),
    totalWorkElapsedTime: formatIsoMinutes(totalMinutes),
  }

  return json(response)
}

export const handleMockRequest = async (request: Request): Promise<Response | null> => {
  const url = new URL(request.url)
  const searchParams = url.searchParams
  const method = request.method.toUpperCase()
  const path = url.pathname.replace(/\/+$/, '') || '/'

  if (!path.startsWith('/v0/') && !path.startsWith('/v1/') && !path.startsWith('/v2/')) {
    return null
  }

  const auth = await handleAuth(path, method, request)
  if (auth) return auth

  const notification = await handleNotifications(path, method, request, searchParams)
  if (notification) return notification

  const member = handleMember(path, method)
  if (member) return member

  const tasks = await handleTasks(path, method, searchParams, request)
  if (tasks) return tasks

  const schedules = await handleSchedules(path, method, searchParams, request)
  if (schedules) return schedules

  const stats = handleStatistics(path, method, searchParams)
  if (stats) return stats

  return null
}
