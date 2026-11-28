import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setup } from './support/mocks.mjs'

// 개발용 목업이 일정을 개인 단위로 바꾼 서버 계약(ADR-0037, pinit-monolith 16f8068d)을 따르는지 본다.
// 문구는 서버 `ScheduleErrorMessages`의 PERSONAL_LOCATION_ONLY·PERSONAL_ASSIGNEE_ONLY와 같아야 한다.
const LOCATION_ONLY =
  '일정은 내 일정으로만 둘 수 있어요. 스페이스나 프로젝트에 두려면 작업으로 만들어 주세요.'
const ASSIGNEE_ONLY =
  '일정은 만든 사람만 맡을 수 있어요. 다른 사람에게 맡기려면 작업으로 만들어 담당자를 정해 주세요.'

const scheduleBody = (title = '집중 블록') => ({
  title,
  description: '',
  date: { dateTime: '2030-02-01T10:00:00', zoneId: 'Asia/Seoul' },
  scheduleType: 'DEEP_WORK',
  plannedDuration: 'PT30M',
})

const context = () => {
  const ctx = setup()
  const db = ctx.load('src/mocks/db.ts')
  const taskNamed = (title) => db.mockTasks.find((task) => task.title === title)
  const scheduleOfTask = (taskId) => db.mockSchedules.find((schedule) => schedule.taskId === taskId)
  const scheduleById = (id) => db.mockSchedules.find((schedule) => schedule.id === id)
  return { ...ctx, db, taskNamed, scheduleOfTask, scheduleById }
}

test('creating a schedule rejects a non-personal location or a foreign assignee with 400', async () => {
  const { api } = context()
  const reject = async (extra, message) => {
    const response = await api('/v2/workspace/schedules', 'POST', { schedule: scheduleBody(), ...extra })
    assert.equal(response.status, 400, JSON.stringify(extra))
    assert.equal(response.body.code, 'INVALID_REQUEST')
    assert.equal(response.body.message, message)
  }
  await reject({ location: { spaceId: 2, projectId: null } }, LOCATION_ONLY)
  await reject({ location: { spaceId: 2, projectId: 21 } }, LOCATION_ONLY)
  await reject({ location: { spaceId: -1, projectId: 11 } }, LOCATION_ONLY)
  await reject({ location: { spaceId: -3, projectId: null } }, LOCATION_ONLY)
  await reject({ location: { projectId: null } }, LOCATION_ONLY)
  await reject({ assignee: { memberId: 4 } }, ASSIGNEE_ONLY)
  await reject({ assignee: { memberId: null } }, ASSIGNEE_ONLY)
  // 위치를 먼저 본다.
  await reject({ location: { spaceId: 2, projectId: null }, assignee: { memberId: 4 } }, LOCATION_ONLY)

  const accepted = await api('/v2/workspace/schedules', 'POST', {
    schedule: scheduleBody(),
    location: { spaceId: -1, projectId: null },
    assignee: { memberId: 1 },
  })
  assert.equal(accepted.status, 201)
  const omitted = await api('/v2/workspace/schedules', 'POST', { schedule: scheduleBody() })
  assert.equal(omitted.status, 201)
  for (const view of [accepted.body, omitted.body]) {
    assert.equal(view.spaceId, -1)
    assert.equal(view.projectId, null)
    assert.equal(view.assigneeId, 1)
    assert.equal(view.schedule.ownerId, 1)
    assert.equal(view.allowedActions.assign, false)
    assert.equal(view.allowedActions.move, false)
    assert.equal(view.allowedActions.edit, true)
    assert.equal(view.unavailableReasons.assign, undefined)
  }
})

test('creating a schedule ignores taskId like the server DTO and makes a standalone schedule', async () => {
  const { api, taskNamed, scheduleOfTask } = context()
  const qa = taskNamed('QA 시나리오 정리')
  assert.equal(scheduleOfTask(qa.id), undefined)
  const response = await api('/v2/workspace/schedules', 'POST', {
    schedule: { ...scheduleBody(), taskId: qa.id },
  })
  assert.equal(response.status, 201)
  assert.equal(response.body.schedule.taskId ?? null, null)
  assert.equal(response.body.spaceId, -1)
  assert.equal(response.body.projectId, null)
  assert.equal(scheduleOfTask(qa.id), undefined)
})

test('editing someone else’s schedule checks the location before the 404, like the server', async () => {
  const { api, taskNamed, scheduleOfTask } = context()
  const theirs = scheduleOfTask(taskNamed('결제 화면 접근성 점검').id)
  assert.equal(theirs.ownerId, 4)
  const badLocation = await api(`/v2/workspace/schedules/${theirs.id}`, 'PATCH', {
    expectedVersion: 1,
    location: { spaceId: 2, projectId: null },
  })
  assert.equal(badLocation.status, 400)
  assert.equal(badLocation.body.message, LOCATION_ONLY)
  const badAssignee = await api(`/v2/workspace/schedules/${theirs.id}`, 'PATCH', {
    expectedVersion: 1,
    assignee: { memberId: 4 },
  })
  assert.equal(badAssignee.status, 400)
  assert.equal(badAssignee.body.message, ASSIGNEE_ONLY)
  const personal = await api(`/v2/workspace/schedules/${theirs.id}`, 'PATCH', {
    expectedVersion: 1,
    location: { spaceId: -1, projectId: null },
  })
  assert.equal(personal.status, 404)
  assert.equal((await api('/v2/workspace/schedules/999999', 'PATCH', { expectedVersion: 1, assignee: { memberId: 3 } })).status, 400)
})

test('editing a schedule rejects a non-personal location before the version check and never moves anything', async () => {
  const { api, taskNamed, scheduleOfTask } = context()
  const notes = taskNamed('릴리즈 노트 초안 쓰기')
  const id = scheduleOfTask(notes.id).id
  const before = await api(`/v2/workspace/schedules/${id}`)
  assert.equal(before.body.spaceId, 2)
  assert.equal(before.body.projectId, 21)

  const team = await api(`/v2/workspace/schedules/${id}`, 'PATCH', {
    expectedVersion: before.body.version - 1,
    location: { spaceId: 2, projectId: 21 },
  })
  assert.equal(team.status, 400)
  assert.equal(team.body.message, LOCATION_ONLY)
  const foreign = await api(`/v2/workspace/schedules/${id}`, 'PATCH', {
    expectedVersion: before.body.version,
    assignee: { memberId: 3 },
  })
  assert.equal(foreign.status, 400)
  assert.equal(foreign.body.message, ASSIGNEE_ONLY)
  assert.equal((await api(`/v2/workspace/schedules/${id}`)).body.version, before.body.version)

  // 받아들이는 값은 아무것도 바꾸지 않는다. 연결 작업도 그대로 있다.
  const saved = await api(`/v2/workspace/schedules/${id}`, 'PATCH', {
    expectedVersion: before.body.version,
    schedule: { title: '노트 초안' },
    location: { spaceId: -1, projectId: null },
    assignee: { memberId: 1 },
  })
  assert.equal(saved.status, 200)
  assert.equal(saved.body.schedule.title, '노트 초안')
  assert.equal(saved.body.schedule.taskId, notes.id)
  assert.equal(saved.body.spaceId, 2)
  assert.equal(saved.body.projectId, 21)
  assert.equal(saved.body.version, before.body.version + 1)
  assert.equal(saved.body.moveResult, undefined)
})

test('schedule reads return only the caller’s own schedules, whatever the space role', async () => {
  const { api, taskNamed, scheduleOfTask } = context()
  const theirs = scheduleOfTask(taskNamed('결제 화면 접근성 점검').id)
  assert.equal(theirs.ownerId, 4)
  // 회원 3은 제품팀 관리자다. 그래도 남의 일정은 없는 것과 같다.
  for (const actor of [1, 3]) {
    const list = await api('/v2/workspace/schedules', 'GET', undefined, { as: actor })
    assert.equal(list.status, 200)
    assert.ok(list.body.every((view) => view.schedule.ownerId === actor), `actor ${actor}`)
    assert.equal((await api(`/v2/workspace/schedules/${theirs.id}`, 'GET', undefined, { as: actor })).status, 404)
    const patched = await api(`/v2/workspace/schedules/${theirs.id}`, 'PATCH', { expectedVersion: 1, schedule: { title: 'x' } }, { as: actor })
    assert.equal(patched.status, 404)
    assert.equal((await api(`/v2/workspace/schedules/${theirs.id}?expectedVersion=1`, 'DELETE', undefined, { as: actor })).status, 404)
  }
  const own = await api('/v2/workspace/schedules', 'GET', undefined, { as: 4 })
  assert.ok(own.body.some((view) => view.schedule.id === theirs.id))
  // mine은 받되 결과를 바꾸지 않는다.
  const mine = await api('/v2/workspace/schedules?mine=true', 'GET', undefined, { as: 4 })
  const notMine = await api('/v2/workspace/schedules?mine=false', 'GET', undefined, { as: 4 })
  assert.deepEqual(mine.body.map((view) => view.schedule.id), notMine.body.map((view) => view.schedule.id))
})

test('a schedule shows its linked task’s place when the reader can read the task, and the reader’s personal space otherwise', async () => {
  const { api, taskNamed, scheduleOfTask, load } = context()
  const chapter = taskNamed('3장까지 읽고 메모')
  const id = scheduleOfTask(chapter.id).id
  const linked = await api(`/v2/workspace/schedules/${id}`)
  assert.deepEqual([linked.body.spaceId, linked.body.projectId], [3, 31])
  const inSpace = await api('/v2/workspace/schedules?spaceId=3&projectId=31')
  assert.ok(inSpace.body.some((view) => view.schedule.id === id))
  assert.ok(!(await api('/v2/workspace/schedules?spaceId=-1')).body.some((view) => view.schedule.id === id))
  const standalone = (await api('/v2/workspace/schedules?spaceId=-1')).body.find((view) => view.schedule.taskId === null)
  assert.ok(standalone, 'a standalone schedule sits in my personal space')
  assert.equal(standalone.projectId, null)

  // 작업을 읽을 수 없게 되면(스페이스 삭제) 연결은 남아도 자리는 내 개인 스페이스다.
  const state = load('src/mocks/workspaceState.ts')
  state.findSpace(3).deletedAt = new Date().toISOString()
  const hidden = await api(`/v2/workspace/schedules/${id}`)
  assert.equal(hidden.status, 200)
  assert.equal(hidden.body.schedule.taskId, chapter.id)
  assert.deepEqual([hidden.body.spaceId, hidden.body.projectId], [-1, null])
})

test('scheduling a task someone else holds takes it over and cuts their link on their own stream', async () => {
  const { api, taskNamed, scheduleOfTask, scheduleById, state } = context()
  const task = taskNamed('결제 화면 접근성 점검')
  const theirs = scheduleOfTask(task.id)
  assert.equal(theirs.ownerId, 4)
  const view = await api(`/v2/workspace/tasks/${task.id}`)
  // 남의 일정이 연결돼 있으면 schedule은 켜져 있다. ALREADY_SCHEDULED는 내 일정일 때만이다.
  assert.equal(view.body.allowedActions.schedule, true)
  const theirVersion = (await api(`/v2/workspace/schedules/${theirs.id}`, 'GET', undefined, { as: 4 })).body.version
  const cursor = state.latestChangeId()

  const scheduled = await api(`/v2/workspace/tasks/${task.id}/schedule`, 'POST', {
    expectedVersion: view.body.version,
    schedule: { date: { dateTime: '2030-02-02T10:00:00', zoneId: 'Asia/Seoul' }, scheduleType: 'DEEP_WORK' },
  })
  assert.equal(scheduled.status, 201)
  assert.equal(scheduled.body.schedule.ownerId, 1)
  assert.equal(scheduled.body.schedule.taskId, task.id)
  assert.equal((await api(`/v2/workspace/tasks/${task.id}`)).body.assigneeId, 1)
  assert.equal((await api(`/v2/workspace/tasks/${task.id}`)).body.unavailableReasons.schedule, 'ALREADY_SCHEDULED')

  // 끊긴 일정은 상태·시간을 그대로 둔 채 회원 4의 독립 일정으로 남는다.
  const cut = await api(`/v2/workspace/schedules/${theirs.id}`, 'GET', undefined, { as: 4 })
  assert.equal(cut.body.schedule.taskId, null)
  assert.equal(cut.body.schedule.state, 'SUSPENDED')
  assert.equal(cut.body.spaceId, -4)
  assert.equal(cut.body.version, theirVersion + 1)
  assert.equal(scheduleById(theirs.id).duration, 'PT40M')
  const forOwner = state.changesAfter(4, null, cursor)
  assert.ok(forOwner.some((event) => event.resourceType === 'SCHEDULE' && event.resourceId === theirs.id && event.action === 'UPDATED' && event.spaceId === -4))
  assert.ok(!state.changesAfter(1, null, cursor).some((event) => event.resourceType === 'SCHEDULE' && event.resourceId === theirs.id))
})

test('reassigning a task cuts the link, and task or project moves never move schedules', async () => {
  const { api, taskNamed, scheduleOfTask, scheduleById } = context()
  const notes = taskNamed('릴리즈 노트 초안 쓰기')
  const notesSchedule = scheduleOfTask(notes.id)
  const before = (await api(`/v2/workspace/schedules/${notesSchedule.id}`)).body

  // 작업 이동: 일정은 옮기지 않는다. 버전도 그대로이고 자리만 작업을 따라 다시 계산된다.
  let task = (await api(`/v2/workspace/tasks/${notes.id}`)).body
  const moved = await api(`/v2/workspace/tasks/${notes.id}`, 'PATCH', {
    expectedVersion: task.version,
    location: { spaceId: 2, projectId: 22 },
  })
  assert.equal(moved.status, 200)
  assert.deepEqual(moved.body.moveResult.movedScheduleIds, [])
  const afterMove = (await api(`/v2/workspace/schedules/${notesSchedule.id}`)).body
  assert.equal(afterMove.version, before.version)
  assert.equal(afterMove.schedule.taskId, notes.id)
  assert.equal(afterMove.projectId, 22)

  // 프로젝트 이동도 작업만 옮긴다. 담당이 풀리지 않으면 연결은 그대로다.
  const copy = taskNamed('온보딩 첫 화면 문구 다듬기')
  const copySchedule = scheduleOfTask(copy.id)
  const copyVersion = (await api(`/v2/workspace/schedules/${copySchedule.id}`)).body.version
  const project = (await api('/v2/projects?spaceId=2')).body.find((item) => item.id === 22)
  const projectMoved = await api('/v2/projects/22/move', 'POST', { spaceId: 3, expectedVersion: project.version })
  assert.equal(projectMoved.status, 200)
  assert.deepEqual(projectMoved.body.moveResult.movedScheduleIds, [])
  assert.ok(projectMoved.body.moveResult.movedTaskIds.includes(copy.id))
  const copyAfter = (await api(`/v2/workspace/schedules/${copySchedule.id}`)).body
  assert.equal(copyAfter.version, copyVersion)
  assert.equal(copyAfter.schedule.taskId, copy.id)
  assert.equal(copyAfter.spaceId, 3)

  // 재배정: 담당자가 일정의 주인이 아니게 되면 연결을 끊는다(작업은 프로젝트와 함께 독서 모임으로 옮겨졌다).
  task = (await api(`/v2/workspace/tasks/${notes.id}`)).body
  const reassigned = await api(`/v2/workspace/tasks/${notes.id}`, 'PATCH', {
    expectedVersion: task.version,
    assignee: { memberId: 4 },
  })
  assert.equal(reassigned.status, 200)
  const cut = (await api(`/v2/workspace/schedules/${notesSchedule.id}`)).body
  assert.equal(cut.schedule.taskId, null)
  assert.equal(cut.version, before.version + 1)
  assert.deepEqual([cut.spaceId, cut.projectId], [-1, null])
  assert.equal(scheduleById(notesSchedule.id).ownerId, 1)
})

test('leaving a space cuts my links to its tasks and keeps my schedules', async () => {
  const { api, taskNamed, scheduleOfTask } = context()
  const chapter = taskNamed('3장까지 읽고 메모')
  const schedule = scheduleOfTask(chapter.id)
  const left = await api('/v2/spaces/3/leave', 'POST')
  assert.equal(left.status, 204)
  const view = await api(`/v2/workspace/schedules/${schedule.id}`)
  assert.equal(view.status, 200)
  assert.equal(view.body.schedule.taskId, null)
  assert.equal(view.body.spaceId, -1)
})

test('FIXED recurrences are personal and FLEXIBLE ones keep their location and assignee', async () => {
  const { api } = context()
  const fixed = (extra = {}) => ({
    recurrence: {
      mode: 'FIXED',
      title: '아침 회고',
      description: '',
      fixed: { startTime: '08:00', scheduleType: 'QUICK_TASK', plannedDuration: 'PT15M' },
      rule: { freq: 'DAILY', interval: 1, startDate: '2030-03-01', days: [] },
      zoneId: 'Asia/Seoul',
    },
    ...extra,
  })
  const team = await api('/v2/workspace/recurrences', 'POST', fixed({ location: { spaceId: 2, projectId: null } }))
  assert.equal(team.status, 400)
  assert.equal(team.body.message, LOCATION_ONLY)
  const foreign = await api('/v2/workspace/recurrences', 'POST', fixed({ assignee: { memberId: 3 } }))
  assert.equal(foreign.status, 400)
  assert.equal(foreign.body.message, ASSIGNEE_ONLY)

  const created = await api('/v2/workspace/recurrences', 'POST', fixed())
  assert.equal(created.status, 201)
  assert.deepEqual([created.body.spaceId, created.body.projectId, created.body.assigneeId], [-1, null, 1])
  assert.equal(created.body.allowedActions.assign, false)
  assert.equal(created.body.allowedActions.move, false)
  const id = created.body.recurrence.id
  const listed = async (query) =>
    (await api(`/v2/workspace/recurrences?status=ACTIVE${query}`)).body.some((view) => view.recurrence.id === id)
  assert.equal(await listed(''), true)
  assert.equal(await listed('&spaceId=-1'), true)
  assert.equal(await listed('&spaceId=2'), false)
  assert.equal(await listed('&spaceId=-1&projectId=11'), false)
  assert.equal((await api(`/v2/workspace/recurrences/${id}`, 'GET', undefined, { as: 3 })).status, 404)

  const moved = await api(`/v2/workspace/recurrences/${id}`, 'PATCH', {
    expectedVersion: created.body.version,
    location: { spaceId: 2, projectId: 21 },
  })
  assert.equal(moved.status, 400)
  assert.equal(moved.body.message, LOCATION_ONLY)

  const flexible = await api('/v2/workspace/recurrences', 'POST', {
    recurrence: {
      mode: 'FLEXIBLE',
      title: '주간 지표 정리',
      description: '',
      flexible: { importance: 5, difficulty: 2, expectedDuration: 'PT30M' },
      rule: { freq: 'WEEKLY', interval: 1, startDate: '2030-03-04', days: ['MONDAY'] },
      zoneId: 'Asia/Seoul',
    },
    location: { spaceId: 2, projectId: 21 },
    assignee: { memberId: 4 },
  })
  assert.equal(flexible.status, 201)
  assert.deepEqual([flexible.body.spaceId, flexible.body.projectId, flexible.body.assigneeId], [2, 21, 4])
  assert.equal(flexible.body.allowedActions.move, true)
})

test('a schedule deleted with its task is restored or purged by its owner alone, and nothing relinks', async () => {
  const { api, taskNamed, scheduleOfTask } = context()
  const walk = taskNamed('저녁 30분 걷기')
  const schedule = scheduleOfTask(walk.id)
  const scheduleVersion = (await api(`/v2/workspace/schedules/${schedule.id}`)).body.version
  const task = (await api(`/v2/workspace/tasks/${walk.id}`)).body
  assert.equal(
    (await api(`/v2/workspace/tasks/${walk.id}?expectedVersion=${task.version}&deleteSchedules=true`, 'DELETE')).status,
    204,
  )
  const trash = (await api('/v2/trash')).body
  const row = trash.tasks.find((item) => item.taskId === walk.id)
  assert.deepEqual(row.schedules.map((item) => item.scheduleId), [schedule.id])
  assert.ok(!trash.schedules.some((item) => item.scheduleId === schedule.id))

  // 작업이 아직 휴지통에 있어도 일정 하나를 혼자 복원한다(예전의 409 TRASHED_WITH_TASK는 없다).
  const restored = await api(`/v2/workspace/schedules/${schedule.id}/restore`, 'POST', { expectedVersion: scheduleVersion + 1 })
  assert.equal(restored.status, 200)
  assert.deepEqual(restored.body.restoreResult, { scheduleId: schedule.id, linkedTaskId: null })
  assert.equal(restored.body.schedule.taskId, null)
  assert.ok(!(await api('/v2/trash')).body.tasks.find((item) => item.taskId === walk.id).schedules.length)

  // 작업을 복원해도 이미 돌아온 일정을 다시 잇지 않는다.
  const taskRow = (await api('/v2/trash')).body.tasks.find((item) => item.taskId === walk.id)
  const taskRestored = await api(`/v2/workspace/tasks/${walk.id}/restore`, 'POST', { expectedVersion: taskRow.version })
  assert.equal(taskRestored.status, 200)
  assert.deepEqual(taskRestored.body.restoreResult.restoredScheduleIds, [])
  assert.deepEqual(taskRestored.body.restoreResult.relinkedScheduleIds, [])
  assert.equal((await api(`/v2/workspace/schedules/${schedule.id}`)).body.schedule.taskId, null)
  assert.equal(taskRestored.body.allowedActions.schedule, true)
})

test('restoring a task brings back the schedules deleted with it as standalone schedules', async () => {
  const { api, taskNamed, scheduleOfTask } = context()
  const walk = taskNamed('저녁 30분 걷기')
  const schedule = scheduleOfTask(walk.id)
  const task = (await api(`/v2/workspace/tasks/${walk.id}`)).body
  await api(`/v2/workspace/tasks/${walk.id}?expectedVersion=${task.version}&deleteSchedules=true`, 'DELETE')
  const row = (await api('/v2/trash')).body.tasks.find((item) => item.taskId === walk.id)
  const restored = await api(`/v2/workspace/tasks/${walk.id}/restore`, 'POST', { expectedVersion: row.version })
  assert.deepEqual(restored.body.restoreResult.restoredScheduleIds, [schedule.id])
  const back = await api(`/v2/workspace/schedules/${schedule.id}`)
  assert.equal(back.status, 200)
  assert.equal(back.body.schedule.taskId, null)
  assert.deepEqual([back.body.spaceId, back.body.projectId], [-1, null])
})

test('deleting a task applies deleteSchedules only to the deleter’s own schedules and lets the owner purge alone', async () => {
  const { api, taskNamed, scheduleOfTask } = context()
  // 회원 3(제품팀 관리자)이 회원 4가 올린 작업을 지운다. 회원 4의 일정은 휴지통에 가지 않고 연결만 끊긴다.
  const a11y = taskNamed('결제 화면 접근성 점검')
  const theirs = scheduleOfTask(a11y.id)
  const task = (await api(`/v2/workspace/tasks/${a11y.id}`, 'GET', undefined, { as: 3 })).body
  assert.equal(
    (await api(`/v2/workspace/tasks/${a11y.id}?expectedVersion=${task.version}&deleteSchedules=true`, 'DELETE', undefined, { as: 3 })).status,
    204,
  )
  const kept = await api(`/v2/workspace/schedules/${theirs.id}`, 'GET', undefined, { as: 4 })
  assert.equal(kept.status, 200)
  assert.equal(kept.body.schedule.taskId, null)
  assert.ok(!(await api('/v2/trash', 'GET', undefined, { as: 3 })).body.tasks.find((item) => item.taskId === a11y.id).schedules.length)

  // 내 일정은 함께 휴지통으로 가고, 작업을 그대로 둔 채 내가 혼자 영구 삭제한다. 휴지통에는 내 일정만 보인다.
  const notes = taskNamed('릴리즈 노트 초안 쓰기')
  const mine = scheduleOfTask(notes.id)
  const version = (await api(`/v2/workspace/schedules/${mine.id}`)).body.version
  const notesTask = (await api(`/v2/workspace/tasks/${notes.id}`)).body
  await api(`/v2/workspace/tasks/${notes.id}?expectedVersion=${notesTask.version}&deleteSchedules=true`, 'DELETE')
  const others = (await api('/v2/trash', 'GET', undefined, { as: 3 })).body
  assert.ok(!others.tasks.find((item) => item.taskId === notes.id).schedules.length)
  assert.equal((await api(`/v2/workspace/schedules/${mine.id}/purge?expectedVersion=${version + 1}`, 'DELETE', undefined, { as: 3 })).status, 404)
  assert.equal((await api(`/v2/workspace/schedules/${mine.id}/purge?expectedVersion=${version + 1}`, 'DELETE')).status, 204)
  const after = (await api('/v2/trash')).body
  assert.ok(after.tasks.find((item) => item.taskId === notes.id))
  assert.ok(!after.tasks.find((item) => item.taskId === notes.id).schedules.length)
})

test('team weekly record counts only schedules linked to the space’s tasks, by their owner', async () => {
  const { api } = context()
  const monday = (() => {
    const now = new Date(Date.now() + 9 * 3600000)
    const day = (now.getUTCDay() + 6) % 7
    return new Date(now.getTime() - day * 86400000).toISOString().slice(0, 10)
  })()
  const record = await api(`/v2/spaces/2/weekly-record?start=${monday}`)
  assert.equal(record.status, 200)
  // 팀 스페이스에 저장돼 있던 독립 일정(주간 계획 회의, 회원 3)은 작업에 닿지 않아 세지 않는다.
  assert.ok(!record.body.byRunner.some((row) => row.memberId === 3))
  for (const row of record.body.byProject) assert.notEqual(row.projectId, undefined)
})

test('approving a day plan takes over a task held through someone else’s schedule and ignores their schedules as obstacles', async () => {
  const { api, taskNamed, scheduleById, scheduleOfTask } = context()
  const a11y = taskNamed('결제 화면 접근성 점검')
  const theirs = scheduleOfTask(a11y.id)
  const applied = await api('/v2/plans/apply', 'POST', {
    date: '2030-02-04',
    zoneId: 'Asia/Seoul',
    blocks: [{ taskId: a11y.id, startTime: '2030-02-04T09:00:00' }],
  })
  assert.equal(applied.status, 201)
  const [created] = applied.body.schedules
  assert.equal(created.ownerId, 1)
  assert.equal(created.taskId, a11y.id)
  assert.equal(scheduleById(theirs.id).taskId, undefined)
  assert.equal((await api(`/v2/workspace/tasks/${a11y.id}`)).body.assigneeId, 1)
  // 내 일정이 연결돼 있으면 다시 승인할 수 없다.
  const again = await api('/v2/plans/apply', 'POST', {
    date: '2030-02-05',
    zoneId: 'Asia/Seoul',
    blocks: [{ taskId: a11y.id, startTime: '2030-02-05T09:00:00' }],
  })
  assert.equal(again.status, 409)
  assert.equal(again.body.rejections[0].reason, 'TASK_ALREADY_SCHEDULED')
})
