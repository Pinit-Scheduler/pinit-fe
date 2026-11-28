import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setup } from './support/mocks.mjs'

// 개발용 목업의 오늘 남은 일정 재배치가 서버 계약(pinit-monolith 11a5837a `DayReplanningService`, ADR-0037)을
// 따르는지 본다. 문구는 서버 `PlanningErrorMessages`의 재배치 문구와 같아야 한다.
const ZONE = 'Asia/Seoul'
const DELAY_RANGE = '늦어진 시간은 0~240분으로 입력해 주세요.'
const SNAPSHOT_CHANGED = '미리보기 뒤에 일정이나 계획 조건이 바뀌었어요. 변경 미리보기를 다시 받아 주세요.'
const PREVIEW_EXPIRED = '미리보기가 만료됐어요. 변경 미리보기를 다시 받아 주세요.'
const SELECTION_RANGE = '옮길 일정을 1~100개 골라 주세요. 같은 일정은 한 번만 고를 수 있어요.'
const NOT_IN_PREVIEW = '고른 일정 중 이번 미리보기에서 옮길 수 없는 일정이 있어요. 변경 미리보기를 다시 받아 주세요.'
const STATE_CHANGED = '고른 일정의 상태나 시작 가능 시간이 바뀌었어요. 변경 미리보기를 다시 받아 주세요.'
const OVERLAP = '고른 변경이 그대로 두는 일정이나 생활 시간과 겹쳐요. 관련 변경을 함께 고르거나 변경 미리보기를 다시 받아 주세요.'
const DEPENDENCY_ORDER = '이대로 옮기면 선행 작업이 후속 일정보다 늦게 끝나요. 관련 변경을 함께 골라 주세요.'
const TODAY_ONLY = '오늘 일정만 다시 짤 수 있어요. 오늘 날짜로 다시 시도해 주세요.'
const ZONE_MISMATCH = '회원 설정의 시간대와 지금 시간대가 달라요. 회원 설정의 시간대로 다시 시도해 주세요.'
const INVALID_REQUEST = '입력한 내용을 다시 확인해 주세요.'

// 심어 둔 데이터는 불러온 때의 서울 날짜를 쓴다. 시계는 그날 08:00에 고정한다.
const today = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const at = (hhmm, date = today) => Date.parse(`${date}T${hhmm}:00+09:00`)
const iso = (hhmm, date) => new Date(at(hhmm, date)).toISOString().replace('.000Z', 'Z')
const yesterday = new Date(at('12:00') - 86400000).toISOString().slice(0, 10)

const context = () => {
  const ctx = setup()
  const db = ctx.load('src/mocks/db.ts')
  const replanning = ctx.load('src/mocks/replanning.ts')
  let now = at('08:00')
  replanning.setMockReplanClock(() => now)
  const schedule = (title) => db.mockSchedules.find((item) => item.title === title)
  const task = (title) => db.mockTasks.find((item) => item.title === title)
  const moveTo = (title, hhmm, date = today) => {
    schedule(title).date = { dateTime: `${date}T${hhmm}:00`, zoneId: ZONE }
  }
  const add = (title, taskId, hhmm, minutes) => {
    const id = db.nextScheduleId()
    db.mockSchedules.push({
      id, ownerId: 1, title, description: '', date: { dateTime: `${today}T${hhmm}:00`, zoneId: ZONE },
      scheduleType: 'DEEP_WORK', state: 'NOT_STARTED', taskId, duration: 'PT0S', plannedDuration: `PT${minutes}M`,
    })
    return id
  }
  const preview = (extra = {}, as) =>
    ctx.api('/v2/plans/replan', 'POST', { date: today, zoneId: ZONE, delayMinutes: 30, ...extra }, { as })
  const apply = (previewBody, selectedScheduleIds, extra = {}) =>
    ctx.api('/v2/plans/replan/apply', 'POST', {
      spaceId: previewBody.spaceId, projectId: previewBody.projectId, date: previewBody.date, zoneId: previewBody.zoneId,
      delayMinutes: previewBody.delayMinutes, plannedAt: previewBody.plannedAt, snapshotToken: previewBody.snapshotToken,
      selectedScheduleIds, ...extra,
    })
  const reasons = (body) => Object.fromEntries(body.protectedSchedules.map((item) => [item.title, item.reason]))
  const moved = (body) => Object.fromEntries(body.changes.map((item) => [item.title, [item.afterStart, item.afterEnd]]))
  return { ...ctx, db, schedule, task, moveTo, add, preview, apply, reasons, moved, tick: (ms) => (now += ms), setNow: (ms) => (now = ms) }
}

test('a preview without a scope covers my whole day: my non-completed schedules block, 10-minute gaps, 5-minute starts', async () => {
  const { preview, reasons, moved, schedule } = context()
  const response = await preview()
  assert.equal(response.status, 200)
  const body = response.body
  assert.equal(body.spaceId, null)
  assert.equal(body.projectId, null)
  assert.equal(body.delayMinutes, 30)
  assert.equal(body.plannedAt, iso('08:00'))
  assert.equal(body.windowStart, iso('08:30'))
  assert.equal(body.windowEnd, iso('23:00'))
  assert.match(body.snapshotToken, /^[0-9a-f]{64}$/)
  // 마감 → 중요도 → 난이도 순으로 놓고, 지킬 일정·이미 놓은 블록과 10분을 띄운다.
  assert.deepEqual(moved(body), {
    '릴리즈 노트 초안 쓰기': [iso('11:00'), iso('12:00')],
    '온보딩 문구 초안': [iso('14:00'), iso('14:40')],
    // 14:30에서 시작하려다 온보딩 블록(14:40까지), QA 싱크(15:00~15:30), 노트 정리(16:30~17:00)를 차례로 피한다.
    '알림 점검': [iso('17:10'), iso('17:55')],
    '저녁 걷기': [iso('20:00'), iso('20:30')],
  })
  assert.deepEqual(body.changes.map((item) => item.afterStart), [...body.changes.map((item) => item.afterStart)].sort())
  const notes = body.changes.find((item) => item.title === '릴리즈 노트 초안 쓰기')
  assert.equal(notes.beforeStart, iso('10:30'))
  assert.equal(notes.beforeEnd, iso('11:30'))
  assert.equal(notes.expectedVersion, 1)
  assert.equal(notes.taskId, schedule('릴리즈 노트 초안 쓰기').taskId)
  assert.equal(notes.calibrationApplied, false)
  // 진행 중 일정은 지금부터 남은 시간(최소 15분)을 차지한다. 내일 시작하는 일정은 오늘과 겹치지 않아 목록에 없다.
  assert.deepEqual(reasons(body), {
    'Deep Work 블록': 'IN_PROGRESS',
    '릴리즈 노트 정리': 'INDEPENDENT_APPOINTMENT',
    'QA 싱크': 'INDEPENDENT_APPOINTMENT',
  })
  const running = body.protectedSchedules.find((item) => item.title === 'Deep Work 블록')
  assert.deepEqual([running.start, running.end], [iso('08:00'), iso('08:15')])
  assert.deepEqual(body.unplaced, [])
  // 남의 일정(회원 4의 접근성 점검, 11:00~12:30)은 싣지도 않고 자리도 차지하지 않는다.
  const theirs = schedule('결제 화면 접근성 점검').id
  assert.ok(![...body.changes, ...body.protectedSchedules, ...body.unplaced].some((item) => item.scheduleId === theirs))
})

test('a space narrows what may move: my schedules on tasks outside it are OUTSIDE_SPACE and still take their time', async () => {
  const { preview, reasons, moved, moveTo } = context()
  moveTo('저녁 걷기', '11:00') // 개인 스페이스 작업의 일정을 노트 블록이 갈 자리에 둔다.
  const team = (await preview({ spaceId: 2, projectId: null })).body
  assert.equal(team.spaceId, 2)
  assert.equal(team.projectId, null)
  assert.deepEqual(moved(team), {
    // 11:00에서 시작하려다 걷기(11:00~11:30)를 피한다.
    '릴리즈 노트 초안 쓰기': [iso('11:40'), iso('12:40')],
    // 14:00에서 시작하려다 스페이스 밖이라 지키는 알림 점검(14:00~14:45), QA 싱크(15:00~15:30)를 피한다.
    '온보딩 문구 초안': [iso('15:40'), iso('16:20')],
  })
  // OUTSIDE_SPACE는 진행 중보다 먼저 본다.
  assert.deepEqual(reasons(team), {
    'Deep Work 블록': 'OUTSIDE_SPACE',
    '알림 점검': 'OUTSIDE_SPACE',
    '릴리즈 노트 정리': 'INDEPENDENT_APPOINTMENT',
    'QA 싱크': 'INDEPENDENT_APPOINTMENT',
    '저녁 걷기': 'OUTSIDE_SPACE',
  })

  const project = (await preview({ spaceId: 2, projectId: 21 })).body
  assert.equal(project.projectId, 21)
  assert.deepEqual(Object.keys(moved(project)), ['릴리즈 노트 초안 쓰기'])
  assert.equal(reasons(project)['온보딩 문구 초안'], 'OUTSIDE_PROJECT')
  assert.equal(reasons(project)['저녁 걷기'], 'OUTSIDE_SPACE')

  // 화면이 개인 스페이스를 고르면 팀 작업의 일정이 OUTSIDE_SPACE다.
  const personal = (await preview({ spaceId: -1, projectId: null })).body
  assert.equal(personal.spaceId, -1)
  assert.equal(reasons(personal)['릴리즈 노트 초안 쓰기'], 'OUTSIDE_SPACE')
  assert.equal(reasons(personal)['온보딩 문구 초안'], 'OUTSIDE_SPACE')
  assert.deepEqual(Object.keys(moved(personal)).sort(), ['알림 점검', '저녁 걷기'])

  // 프로젝트만 보내면 개인 스페이스의 프로젝트로 확인하고, 스페이스로는 거르지 않는다.
  const health = (await preview({ projectId: 12 })).body
  assert.equal(health.spaceId, null)
  assert.equal(health.projectId, 12)
  assert.deepEqual(Object.keys(moved(health)), ['저녁 걷기'])
  assert.equal(reasons(health)['릴리즈 노트 초안 쓰기'], 'OUTSIDE_PROJECT')
})

test('protection reasons follow the server order and completed schedules stay listed without blocking', async () => {
  const { preview, reasons, moved, schedule, task, moveTo, load } = context()
  const state = load('src/mocks/workspaceState.ts')
  const notes = task('릴리즈 노트 초안 쓰기')
  // 링크는 남았지만 작업의 담당자가 내가 아니다. 스페이스 밖이면 OUTSIDE_SPACE가 먼저다.
  state.placementOf('task', notes.id).assigneeId = 3
  assert.equal(reasons((await preview()).body)['릴리즈 노트 초안 쓰기'], 'NOT_ASSIGNED_TO_YOU')
  assert.equal(reasons((await preview({ spaceId: -1 })).body)['릴리즈 노트 초안 쓰기'], 'OUTSIDE_SPACE')
  state.placementOf('task', notes.id).assigneeId = 1

  schedule('저녁 걷기').recurrence = { seriesId: 99, occurrenceDate: today }
  schedule('알림 점검').state = 'SUSPENDED'
  task('온보딩 첫 화면 문구 다듬기').completed = true
  // 어제 23:40에 시작해 오늘로 넘어오는 일정은 OUTSIDE_TODAY로 목록에 남는다.
  const late = schedule('회고 준비')
  moveTo('회고 준비', '23:40', yesterday)
  late.state = 'NOT_STARTED'
  late.plannedDuration = 'PT40M'
  // 완료한 일정은 노트 블록이 갈 11:00에 있어도 자리를 차지하지 않는다(ADR-0034).
  const done = schedule('Deep Work 블록')
  moveTo('Deep Work 블록', '11:00')
  done.state = 'COMPLETED'

  const body = (await preview()).body
  assert.deepEqual(reasons(body), {
    'Deep Work 블록': 'COMPLETED',
    '알림 점검': 'SUSPENDED',
    '회고 준비': 'OUTSIDE_TODAY',
    '릴리즈 노트 정리': 'INDEPENDENT_APPOINTMENT',
    'QA 싱크': 'INDEPENDENT_APPOINTMENT',
    '온보딩 문구 초안': 'TASK_UNAVAILABLE',
    '저녁 걷기': 'RECURRING_SCHEDULE',
  })
  assert.deepEqual(moved(body), { '릴리즈 노트 초안 쓰기': [iso('11:00'), iso('12:00')] })
  const overnight = body.protectedSchedules.find((item) => item.title === '회고 준비')
  assert.deepEqual([overnight.start, overnight.end], [iso('23:40', yesterday), iso('00:20')])

  // 연결 작업을 읽을 수 없게 되면(스페이스 삭제) 자리는 내 개인 스페이스, 사유는 TASK_UNAVAILABLE이다.
  state.findSpace(2).deletedAt = new Date().toISOString()
  assert.equal(reasons((await preview()).body)['릴리즈 노트 초안 쓰기'], 'TASK_UNAVAILABLE')
  assert.equal(reasons((await preview({ spaceId: 3 })).body)['릴리즈 노트 초안 쓰기'], 'OUTSIDE_SPACE')
})

test('blocks that cannot move are unplaced with the server reasons and keep their original time', async () => {
  const { preview, schedule, task } = context()
  // 선행 작업(UI 리서치)의 일정이 일시정지라 끝나는 때를 모르면 후속(알림 점검)을 놓지 않는다.
  schedule('Deep Work 블록').state = 'SUSPENDED'
  // 마감이 이미 지난 작업.
  const copy = task('온보딩 첫 화면 문구 다듬기')
  copy.dueDate = { ...copy.dueDate, date: yesterday }
  const body = (await preview({ delayMinutes: 240 })).body
  const unplaced = Object.fromEntries(body.unplaced.map((item) => [item.title, item.reason]))
  assert.deepEqual(unplaced, {
    '알림 점검': 'PREDECESSOR_NOT_PLACED',
    '온보딩 문구 초안': 'DEADLINE_PASSED',
    // 19:30 + 4시간은 23:00 시간창 끝을 넘는다.
    '저녁 걷기': 'NO_FITTING_SLOT',
  })
  const walk = body.unplaced.find((item) => item.title === '저녁 걷기')
  assert.equal(walk.taskId, schedule('저녁 걷기').taskId)
  assert.deepEqual(body.changes.map((item) => item.title), ['릴리즈 노트 초안 쓰기'])
  // 늦어진 시간 0분이면 원래 자리가 이미 맞는 블록은 변경 목록에 없다.
  const none = (await preview({ delayMinutes: 0 })).body
  assert.ok(!none.changes.some((item) => item.title === '릴리즈 노트 초안 쓰기'))
})

test('routines and time calibration shape the proposal', async () => {
  const { api, preview, moved } = context()
  const lunch = await api('/v2/routines', 'PUT', {
    routines: [{
      kind: 'LUNCH', label: null, startTime: '11:00', duration: 'PT1H', remindAtStart: false,
      days: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'],
    }],
  })
  assert.equal(lunch.status, 200)
  assert.deepEqual(moved((await preview()).body)['릴리즈 노트 초안 쓰기'], [iso('12:10'), iso('13:10')])

  assert.equal((await api('/v2/time-calibration', 'PUT', { enabled: true })).status, 200)
  const calibrated = (await preview()).body
  // 예상 1시간 × 난이도 3 계수 1.3 = 78분 → 5분 단위로 올려 80분.
  assert.deepEqual(moved(calibrated)['릴리즈 노트 초안 쓰기'], [iso('12:10'), iso('13:30')])
  assert.ok(calibrated.changes.every((item) => item.calibrationApplied === true))
})

test('a preview rejects bad input like the server: 400 for delay, date, zone, and 404 for a space I cannot use', async () => {
  const { preview, api } = context()
  for (const delayMinutes of [-1, 241]) {
    const response = await preview({ delayMinutes })
    assert.equal(response.status, 400)
    assert.equal(response.body.error, 'Bad Request')
    assert.equal(response.body.message, DELAY_RANGE)
    assert.deepEqual(response.body.errors, [{ field: 'delayMinutes', rejectedValue: delayMinutes, reason: DELAY_RANGE }])
  }
  for (const delayMinutes of [0, 240]) assert.equal((await preview({ delayMinutes })).status, 200)
  const missing = await api('/v2/plans/replan', 'POST', { zoneId: ZONE, delayMinutes: 30 })
  assert.equal(missing.status, 400)
  assert.equal(missing.body.message, INVALID_REQUEST)
  assert.equal(missing.body.errors[0].field, 'date')
  const tomorrow = new Date(at('12:00') + 86400000).toISOString().slice(0, 10)
  assert.equal((await preview({ date: tomorrow })).body.message, TODAY_ONLY)
  // 08:00 KST는 UTC로 전날 23:00이다. 요청 시간대의 오늘이면 회원 시간대와 비교한다.
  const zone = await preview({ date: yesterday, zoneId: 'UTC' })
  assert.equal(zone.status, 400)
  assert.equal(zone.body.message, ZONE_MISMATCH)
  assert.equal((await preview({ zoneId: 'Mars/Base' })).status, 400)
  assert.equal((await preview({ spaceId: 0 })).body.message, INVALID_REQUEST)

  for (const scope of [{ spaceId: 999 }, { spaceId: -4 }, { spaceId: 2, projectId: 31 }, { projectId: 21 }]) {
    const response = await preview(scope)
    assert.equal(response.status, 404, JSON.stringify(scope))
    assert.equal(response.body.code, 'SPACE_UNAVAILABLE')
  }
  // 다른 회원은 자기 일정만 본다.
  const theirs = (await preview({}, 4)).body
  assert.deepEqual(theirs.protectedSchedules.map((item) => [item.title, item.reason]), [['결제 화면 접근성 점검', 'SUSPENDED']])
  assert.deepEqual(theirs.changes, [])
})

test('applying moves only the selected schedules, bumps their versions and records them on my own stream', async () => {
  const { preview, apply, api, state, schedule } = context()
  const body = (await preview({ spaceId: 2, projectId: null })).body
  const notes = schedule('릴리즈 노트 초안 쓰기').id
  const copy = schedule('온보딩 문구 초안').id
  const before = (await api(`/v2/workspace/schedules/${notes}`)).body.version
  const cursor = state.latestChangeId()
  const applied = await apply(body, [copy, notes])
  assert.equal(applied.status, 200)
  assert.deepEqual(applied.body, { appliedScheduleIds: [notes, copy].sort((a, b) => a - b) })
  const view = (await api(`/v2/workspace/schedules/${notes}`)).body
  assert.deepEqual(view.schedule.date, { dateTime: `${today}T11:00:00`, zoneId: ZONE })
  assert.equal(view.schedule.plannedDuration, 'PT1H')
  assert.equal(view.version, before + 1)
  const events = state.changesAfter(1, null, cursor)
  assert.deepEqual(
    JSON.parse(JSON.stringify(events.map((event) => [event.resourceType, event.resourceId, event.action, event.spaceId]))),
    [notes, copy].sort((a, b) => a - b).map((id) => ['SCHEDULE', id, 'UPDATED', -1]),
  )
  // 같은 미리보기로 다시 적용하면 버전이 바뀌어 409다.
  const again = await apply(body, [notes])
  assert.equal(again.status, 409)
  assert.equal(again.body.error, 'REPLAN_CONFLICT')
  assert.equal(again.body.message, SNAPSHOT_CHANGED)
})

test('a stale preview is refused with 409 and nothing moves', async () => {
  const { preview, apply, api, schedule } = context()
  const body = (await preview()).body
  const notes = schedule('릴리즈 노트 초안 쓰기').id
  const current = (await api(`/v2/workspace/schedules/${notes}`)).body
  const edited = await api(`/v2/workspace/schedules/${notes}`, 'PATCH', {
    expectedVersion: current.version,
    schedule: { title: '노트 초안' },
  })
  assert.equal(edited.status, 200)
  const refused = await apply(body, [notes])
  assert.equal(refused.status, 409)
  assert.equal(refused.body.error, 'REPLAN_CONFLICT')
  assert.equal(refused.body.message, SNAPSHOT_CHANGED)
  assert.equal(schedule('노트 초안').date.dateTime, `${today}T10:30:00`)
  // 다시 받은 미리보기는 새 버전으로 적용된다.
  const fresh = (await preview()).body
  assert.equal(fresh.changes.find((item) => item.scheduleId === notes).expectedVersion, current.version + 1)
  assert.equal((await apply(fresh, [notes])).status, 200)
})

test('apply checks expiry, the selection, start times, overlaps and dependency order before changing anything', async () => {
  const ctx = context()
  const { preview, apply, schedule, task, add, moveTo, tick, setNow } = ctx
  const notes = schedule('릴리즈 노트 초안 쓰기').id
  let body = (await preview()).body

  const empty = await apply(body, [])
  assert.equal(empty.status, 400)
  assert.equal(empty.body.message, SELECTION_RANGE)
  assert.equal((await apply(body, [notes, notes])).body.message, SELECTION_RANGE)
  assert.equal((await apply(body, Array.from({ length: 101 }, (_, index) => index + 1))).body.message, SELECTION_RANGE)
  const protectedOne = await apply(body, [schedule('QA 싱크').id])
  assert.equal(protectedOne.status, 409)
  assert.equal(protectedOne.body.message, NOT_IN_PREVIEW)
  assert.equal((await apply(body, [notes], { snapshotToken: '0'.repeat(64) })).body.message, SNAPSHOT_CHANGED)
  assert.equal((await apply(body, [notes], { plannedAt: iso('08:05') })).body.message, PREVIEW_EXPIRED)
  tick(15 * 60000)
  const expired = await apply(body, [notes])
  assert.equal(expired.status, 409)
  assert.equal(expired.body.message, PREVIEW_EXPIRED)

  // 고르지 않은 걷기(원래 11:40~12:10)가 노트의 새 자리(11:00~12:00)와 10분 안에 있다.
  setNow(at('08:00'))
  moveTo('저녁 걷기', '11:40')
  body = (await preview()).body
  assert.equal((await apply(body, [notes])).body.message, OVERLAP)

  // 선행(이력서)만 옮기면 후속(포트폴리오)의 원래 시작보다 늦게 끝난다. 둘을 함께 고르면 된다.
  moveTo('저녁 걷기', '19:30')
  const resume = add('이력서 블록', task('이력서 경력 기술 업데이트').id, '08:10', 30)
  const portfolio = add('포트폴리오 블록', task('포트폴리오에 사례 하나 추가').id, '08:50', 30)
  body = (await preview({ delayMinutes: 240 })).body
  const order = await apply(body, [resume])
  assert.equal(order.status, 409)
  assert.equal(order.body.message, DEPENDENCY_ORDER)
  assert.equal(schedule('이력서 블록').date.dateTime, `${today}T08:10:00`)
  assert.equal((await apply(body, [resume, portfolio])).status, 200)

  // 미리보기의 새 시작이 적용할 때 이미 지났다.
  const fresh = context()
  fresh.schedule('Deep Work 블록').state = 'COMPLETED'
  fresh.moveTo('릴리즈 노트 초안 쓰기', '10:00')
  fresh.setNow(at('10:05'))
  const late = (await fresh.preview({ delayMinutes: 0 })).body
  const id = fresh.schedule('릴리즈 노트 초안 쓰기').id
  assert.deepEqual(fresh.moved(late)['릴리즈 노트 초안 쓰기'], [iso('10:05'), iso('11:05')])
  fresh.tick(5 * 60000)
  const passed = await fresh.apply(late, [id])
  assert.equal(passed.status, 409)
  assert.equal(passed.body.message, STATE_CHANGED)
})
