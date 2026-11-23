// 개발용 모의 API. 백엔드 없이 앱의 네이티브 화면(로그인·오늘·일정·작업·상태 변경)을 돌려 볼 때 쓴다.
// 실제 서버가 아니다. 응답 모양은 pinit-monolith의 /v0 인증, /v2/workspace 계약을 따르고, 데이터는 메모리에만 있다.
//
//   npm run mock-api                # http://localhost:8787
//   EXPO_PUBLIC_API_BASE_URL=http://localhost:8787 npm run web
//
// 계정: demo / demo1234. 다시 시작하면 처음 상태로 돌아간다.

import { createServer } from 'node:http'

const PORT = Number(process.env.PORT || 8787)
const ZONE = 'Asia/Seoul'
const ACCESS_TTL_SECONDS = 300
const REFRESH_COOKIE = 'refresh_token'
const MEMBER = { memberId: 1, nickname: '데모 유저' }
const SPACES = [
  { id: 1, name: '개인' },
  { id: 2, name: '이직 준비' },
]

const pad = (value) => String(value).padStart(2, '0')
// 모의 서버는 서울 시간(UTC+9, 서머타임 없음)만 다룬다.
const seoulNow = () => new Date(Date.now() + 9 * 3600_000)
const dateKey = (date) => `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
const today = () => dateKey(seoulNow())
const addDays = (key, days) => {
  const [year, month, day] = key.split('-').map(Number)
  return dateKey(new Date(Date.UTC(year, month - 1, day + days)))
}
const instantOf = (dateTime) => Date.parse(`${dateTime}+09:00`)

const base64url = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
const accessToken = () =>
  `${base64url({ alg: 'none' })}.${base64url({ sub: String(MEMBER.memberId), exp: Math.floor(Date.now() / 1000) + ACCESS_TTL_SECONDS })}.mock`
const tokenValid = (header) => {
  const token = /^Bearer (.+)$/.exec(header ?? '')?.[1]
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())
    return payload.exp * 1000 > Date.now()
  } catch {
    return false
  }
}

let nextId = 100
const refreshTokens = new Set()
const schedules = []
const tasks = []

const addSchedule = (day, time, title, scheduleType, minutes, extra = {}) =>
  schedules.push({
    id: nextId++,
    title,
    description: '',
    date: { dateTime: `${day}T${time}:00`, zoneId: ZONE },
    scheduleType,
    state: 'NOT_STARTED',
    taskId: null,
    plannedDuration: `PT${minutes}M`,
    recurrence: null,
    spaceId: 1,
    version: 1,
    ...extra,
  })
const addTask = (title, dueOffset, importance, difficulty, extra = {}) =>
  tasks.push({
    id: nextId++,
    title,
    description: '',
    dueDate: { date: addDays(today(), dueOffset), zoneId: ZONE, offset: '+09:00' },
    importance,
    difficulty,
    effectiveExpectedDuration: `PT${difficulty * 15}M`,
    completed: false,
    inboundDependencyCount: 0,
    recurrence: null,
    spaceId: 1,
    version: 1,
    ...extra,
  })

const seed = () => {
  const day = today()
  addSchedule(day, '09:00', '아침 계획 세우기', 'QUICK_TASK', 15, { state: 'COMPLETED' })
  addSchedule(day, '10:00', 'Deep Work 블록', 'DEEP_WORK', 90, { state: 'IN_PROGRESS' })
  addSchedule(day, '13:30', '이력서 고치기', 'DEEP_WORK', 60, { spaceId: 2 })
  addSchedule(day, '16:00', '영수증 정리', 'ADMIN_TASK', 30, { recurrence: { seriesId: 1 } })
  addSchedule(addDays(day, 1), '11:00', '주간 회고', 'QUICK_TASK', 30)
  addSchedule(addDays(day, 2), '15:00', '포트폴리오 초안 검토', 'DEEP_WORK', 60, { spaceId: 2 })
  addTask('메일함 정리', 0, 3, 2)
  addTask('온보딩 개편 설계', 0, 6, 5)
  addTask('포트폴리오에 사례 하나 추가', 2, 6, 5, { spaceId: 2, inboundDependencyCount: 1 })
  addTask('분기 회고 쓰기', 4, 7, 3)
  addTask('읽을거리 정리', 6, 2, 1, { recurrence: { seriesId: 2 } })
  for (let index = 1; index <= 24; index += 1) addTask(`백로그 정리 ${index}`, 7 + index, (index % 9) + 1, [1, 2, 3, 5, 8, 13, 21][index % 7])
  addTask('지난주 보고서', -3, 5, 3, { completed: true })
}
seed()

const scheduleActions = (state) => ({
  start: state === 'NOT_STARTED' || state === 'SUSPENDED',
  suspend: state === 'IN_PROGRESS',
  complete: state === 'NOT_STARTED' || state === 'IN_PROGRESS',
  cancel: state !== 'NOT_STARTED',
})
const scheduleView = ({ spaceId, version, ...schedule }) => ({
  schedule,
  spaceId,
  projectId: null,
  assigneeId: MEMBER.memberId,
  assigneeNickname: MEMBER.nickname,
  version,
  allowedActions: scheduleActions(schedule.state),
})
const taskView = ({ spaceId, version, ...task }) => ({
  task,
  spaceId,
  projectId: null,
  assigneeId: MEMBER.memberId,
  assigneeNickname: MEMBER.nickname,
  version,
  allowedActions: { complete: !task.completed, reopen: task.completed },
})

const conflict = { code: 'VERSION_CONFLICT', message: '다른 참여자가 먼저 수정했어요.' }

const changeSchedule = (schedule, action) => {
  if (!scheduleActions(schedule.state)[{ START: 'start', SUSPEND: 'suspend', COMPLETE: 'complete', CANCEL: 'cancel' }[action]])
    return { status: 400, body: { message: '지금 상태에서는 할 수 없는 동작이에요.' } }
  if (action === 'START') {
    // 서버는 진행중·일시정지인 다른 일정이 있으면 시작을 거절한다(409 STATE_CONFLICT).
    if (schedules.some((other) => other !== schedule && ['IN_PROGRESS', 'SUSPENDED'].includes(other.state)))
      return { status: 409, body: { code: 'STATE_CONFLICT', message: '이미 진행 중인 다른 일정이 있어요. 먼저 그 일정을 끝내 주세요.' } }
  }
  schedule.state = { START: 'IN_PROGRESS', SUSPEND: 'SUSPENDED', COMPLETE: 'COMPLETED', CANCEL: 'NOT_STARTED' }[action]
  schedule.version += 1
  return { status: 200, body: scheduleView(schedule) }
}

const listTasks = (query) => {
  const status = query.get('status') ?? 'CURRENT'
  let list = tasks.filter((task) => {
    if (query.get('date')) return task.dueDate.date === query.get('date')
    if (query.get('readyOnly') === 'true') return !task.completed && task.inboundDependencyCount === 0
    if (status === 'COMPLETED') return task.completed
    // CURRENT: 미완료 전체 + 오늘 이후 마감인 완료 작업
    return !task.completed || task.dueDate.date >= today()
  })
  list = [...list].sort((a, b) => a.dueDate.date.localeCompare(b.dueDate.date) || a.id - b.id)
  const page = Number(query.get('page') ?? 0)
  const size = Number(query.get('size') ?? 20)
  const content = list.slice(page * size, (page + 1) * size)
  return { content: content.map(taskView), number: page, size, last: (page + 1) * size >= list.length }
}

const readJson = async (request) => {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  try {
    return JSON.parse(Buffer.concat(chunks).toString() || '{}')
  } catch {
    return {}
  }
}
const cookieOf = (request) =>
  (request.headers.cookie ?? '')
    .split(';')
    .map((part) => part.trim().split('='))
    .find(([name]) => name === REFRESH_COOKIE)?.[1]
const setCookie = (value, maxAge) => `${REFRESH_COOKIE}=${value}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}`

const route = async (request, url) => {
  const { method } = request
  const path = url.pathname.replace(/\/+$/, '')
  const body = method === 'POST' ? await readJson(request) : {}

  if (method === 'POST' && path === '/v0/login') {
    if (body.username !== 'demo' || body.password !== 'demo1234')
      return { status: 401, body: { message: '아이디 또는 비밀번호가 잘못되었습니다.' } }
    const refresh = `mock-refresh-${nextId++}`
    refreshTokens.add(refresh)
    return { status: 200, body: { token: accessToken(), emailRequired: false }, cookie: setCookie(refresh, 14 * 86400) }
  }
  if (method === 'POST' && path === '/v0/refresh') {
    const refresh = cookieOf(request)
    if (!refresh || !refreshTokens.has(refresh)) return { status: 401 }
    return { status: 200, body: { token: accessToken() }, cookie: setCookie(refresh, 14 * 86400) }
  }
  if (method === 'POST' && path === '/v0/logout') {
    refreshTokens.delete(cookieOf(request))
    return { status: 200, cookie: setCookie('', 0) }
  }

  if (!tokenValid(request.headers.authorization)) return { status: 401, body: { message: '로그인이 필요합니다.' } }

  if (method === 'GET' && path === '/v2/members/now')
    return { status: 200, body: schedules.find((schedule) => ['IN_PROGRESS', 'SUSPENDED'].includes(schedule.state))?.id ?? null }
  if (method === 'GET' && path === '/v2/members/settings') return { status: 200, body: { zoneId: ZONE } }
  if (method === 'GET' && path === '/v2/spaces')
    return { status: 200, body: { defaultSpaceId: 1, currentMember: MEMBER, spaces: SPACES } }

  if (method === 'GET' && path === '/v2/workspace/schedules') {
    const start = Date.parse(url.searchParams.get('start'))
    const end = Date.parse(url.searchParams.get('end'))
    return {
      status: 200,
      body: schedules
        .filter((schedule) => {
          const at = instantOf(schedule.date.dateTime)
          return at >= start && at < end
        })
        .map(scheduleView),
    }
  }
  const scheduleMatch = /^\/v2\/workspace\/schedules\/(\d+)(\/state)?$/.exec(path)
  if (scheduleMatch) {
    const schedule = schedules.find((candidate) => candidate.id === Number(scheduleMatch[1]))
    if (!schedule) return { status: 404, body: { message: '일정을 찾을 수 없어요.' } }
    if (method === 'GET' && !scheduleMatch[2]) return { status: 200, body: scheduleView(schedule) }
    if (method === 'POST' && scheduleMatch[2]) {
      if (body.expectedVersion !== schedule.version) return { status: 409, body: conflict }
      return changeSchedule(schedule, body.action)
    }
  }

  if (method === 'GET' && path === '/v2/workspace/tasks') return { status: 200, body: listTasks(url.searchParams) }
  const taskMatch = /^\/v2\/workspace\/tasks\/(\d+)(\/state)?$/.exec(path)
  if (taskMatch) {
    const task = tasks.find((candidate) => candidate.id === Number(taskMatch[1]))
    if (!task) return { status: 404, body: { message: '작업을 찾을 수 없어요.' } }
    if (method === 'GET' && !taskMatch[2]) return { status: 200, body: taskView(task) }
    if (method === 'POST' && taskMatch[2]) {
      if (body.expectedVersion !== task.version) return { status: 409, body: conflict }
      task.completed = body.action === 'COMPLETE'
      task.version += 1
      return { status: 200, body: taskView(task) }
    }
  }
  return { status: 404, body: { message: `모의 API에 없는 경로예요: ${method} ${path}` } }
}

createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`)
  // 브라우저 미리보기(다른 포트)에서 쿠키를 주고받을 수 있게 요청한 출처를 그대로 허용한다.
  const cors = {
    'Access-Control-Allow-Origin': request.headers.origin ?? '*',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    Vary: 'Origin',
  }
  if (request.method === 'OPTIONS') {
    response.writeHead(204, cors).end()
    return
  }
  const result = await route(request, url)
  const headers = { ...cors, ...(result.cookie ? { 'Set-Cookie': result.cookie } : {}) }
  if (result.body === undefined) response.writeHead(result.status, headers).end()
  else response.writeHead(result.status, { ...headers, 'Content-Type': 'application/json' }).end(JSON.stringify(result.body))
  console.log(`${result.status} ${request.method} ${url.pathname}${url.search}`)
}).listen(PORT, () => console.log(`Pinit 모의 API: http://localhost:${PORT} (demo / demo1234)`))
