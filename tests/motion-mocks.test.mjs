import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

// 개발용 목업(VITE_USE_MOCK_API=true)이 작업·일정·스페이스 화면이 읽고 쓰는 /v2 워크스페이스 경로를 모두 답하는지 본다.
const require = createRequire(import.meta.url),
  root = fileURLToPath(new URL('../', import.meta.url))
const loadModules = () => {
  const cache = new Map()
  const load = (filename) => {
    if (!filename.endsWith('.ts')) filename += '.ts'
    if (cache.has(filename)) return cache.get(filename).exports
    const source = readFileSync(filename, 'utf8'),
      module = { exports: {} }
    cache.set(filename, module)
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    })
    const localRequire = (name) => {
      if (name.startsWith('.'))
        return load(path.resolve(path.dirname(filename), name))
      const alias = name
        .replace(/^@shared\//, 'src/shared/')
        .replace(/^@features\//, 'src/features/')
      if (alias !== name) return load(path.resolve(root, alias))
      return require(name)
    }
    vm.runInNewContext(
      outputText,
      {
        module,
        exports: module.exports,
        require: localRequire,
        Request,
        Response,
        Headers,
        URL,
        URLSearchParams,
        AbortController,
        ReadableStream,
        TextEncoder,
        TextDecoder,
        atob,
        btoa,
        structuredClone,
        console,
        setTimeout,
        clearTimeout,
      },
      { filename },
    )
    return module.exports
  }
  return (name) => load(path.resolve(root, name))
}

const token = (sub) =>
  `${btoa(JSON.stringify({ alg: 'none' }))}.${btoa(
    JSON.stringify({ sub, exp: Math.floor(Date.now() / 1000) + 3600 }),
  )}.mock`

const setup = () => {
  const load = loadModules()
  const { handleMockRequest } = load('src/mocks/handlers.ts')
  const workspace = load('src/mocks/workspace.ts')
  const call = (route, method = 'GET', body, init = {}) =>
    handleMockRequest(
      new Request(`http://localhost:8080${route}`, {
        method,
        headers: {
          Authorization: `Bearer ${token(1)}`,
          'Content-Type': 'application/json',
          ...(init.headers ?? {}),
        },
        ...(init.signal ? { signal: init.signal } : {}),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    )
  const api = async (route, method, body) => {
    const response = await call(route, method, body)
    assert.ok(response, `${method ?? 'GET'} ${route} has a mock handler`)
    const text = await response.text()
    return { status: response.status, body: text ? JSON.parse(text) : null }
  }
  return { api, call, workspace }
}

const weekRange = () => {
  const now = new Date()
  const start = new Date(now)
  start.setDate(now.getDate() - ((now.getDay() + 6) % 7))
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(start.getDate() + 7)
  return { start: start.toISOString(), end: end.toISOString() }
}
const mondayKey = () => {
  const now = new Date(Date.now() + 9 * 3600000)
  const day = (now.getUTCDay() + 6) % 7
  return new Date(now.getTime() - day * 86400000).toISOString().slice(0, 10)
}

test('mock mode answers every read the main screens make', async () => {
  const { api } = setup()
  const index = await api('/v2/spaces?includeDeleted=true')
  assert.equal(index.status, 200)
  assert.equal(index.body.defaultSpaceId, -1)
  assert.deepEqual(index.body.currentMember, { memberId: 1, nickname: '데모 유저' })
  const names = index.body.spaces.map((space) => space.name)
  assert.deepEqual(names, ['개인', '제품팀', '독서 모임'])
  for (const space of index.body.spaces) {
    assert.equal(typeof space.version, 'number')
    assert.equal(typeof space.allowedActions, 'object')
    const snapshot = await api(`/v2/spaces/${space.id}/snapshot?includeDeleted=true`)
    assert.equal(snapshot.status, 200)
    assert.equal(snapshot.body.space.id, space.id)
    assert.ok(Array.isArray(snapshot.body.projects))
    assert.ok(snapshot.body.members.some((member) => member.memberId === 1))
  }
  const personal = index.body.spaces[0]
  assert.equal(personal.allowedActions.invite, false)
  assert.equal(personal.unavailableReasons.invite, 'PERSONAL_SPACE')
  const reading = index.body.spaces[2]
  assert.equal(reading.allowedActions.delete, false)
  assert.equal(reading.unavailableReasons.delete, 'ADMIN_ONLY')

  const { start, end } = weekRange()
  const reads = [
    '/v2/workspace/tasks?page=0&size=10&readyOnly=true&mine=true',
    `/v2/workspace/tasks?date=${mondayKey()}&mine=true&page=0&size=100`,
    '/v2/workspace/tasks?page=0&size=20',
    '/v2/workspace/tasks?status=OPEN&page=0&size=100',
    '/v2/workspace/tasks?status=COMPLETED&page=0&size=100',
    '/v2/workspace/tasks?spaceId=2&status=OPEN&unassigned=true&sort=DEADLINE_ASC&page=0&size=50',
    `/v2/workspace/schedules?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&mine=true`,
    `/v2/workspace/schedules?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&spaceId=2`,
    '/v2/workspace/recurrences?status=ACTIVE',
    '/v2/projects/snapshot',
    '/v2/spaces/summaries',
    '/v2/spaces/2/summary',
    `/v2/spaces/2/weekly-record?start=${mondayKey()}`,
    '/v2/spaces/2/task-draft',
    '/v2/spaces/2/schedule-draft',
    '/v2/statistics/period?unit=WEEK',
    '/v2/statistics/trend?unit=WEEK',
    '/v2/trash',
  ]
  for (const route of reads) {
    const { status } = await api(route)
    assert.equal(status, 200, route)
  }
  const all = await api('/v2/workspace/tasks?status=ALL&spaceId=2&page=0&size=100')
  assert.ok(all.body.content.length >= 8)
  for (const view of all.body.content) {
    assert.equal(view.spaceId, 2)
    assert.equal(typeof view.version, 'number')
    assert.equal(typeof view.task.title, 'string')
    assert.equal(typeof view.allowedActions.complete, 'boolean')
  }
  const unassigned = await api('/v2/workspace/tasks?spaceId=2&status=OPEN&unassigned=true&page=0&size=50')
  assert.ok(unassigned.body.content.length > 0)
  assert.ok(unassigned.body.content.every((view) => view.assigneeId === null))
  const summary = await api('/v2/spaces/2/summary')
  assert.equal(summary.body.unassigned.openCount, unassigned.body.content.length)
  for (const project of summary.body.projects) {
    const { total, completed, running, unassigned: none, open } = project.counts
    assert.equal(completed + running + none + open, total)
  }
  const draft = await api('/v2/spaces/2/task-draft')
  assert.equal(draft.body.defaultAssignee.memberId, 1)
})

test('task complete, reopen and edits check expectedVersion and return allowedActions', async () => {
  const { api } = setup()
  const list = await api('/v2/workspace/tasks?status=OPEN&spaceId=2&page=0&size=100')
  const target = list.body.content.find((view) => view.task.title === '온보딩 첫 화면 문구 다듬기')
  assert.ok(target)
  assert.equal(target.allowedActions.complete, true)
  assert.equal(target.allowedActions.reopen, false)

  const completed = await api(`/v2/workspace/tasks/${target.task.id}/state`, 'POST', {
    expectedVersion: target.version,
    action: 'COMPLETE',
  })
  assert.equal(completed.status, 200)
  assert.equal(completed.body.task.completed, true)
  assert.equal(completed.body.version, target.version + 1)
  assert.equal(completed.body.allowedActions.reopen, true)
  assert.equal(completed.body.unavailableReasons.schedule, 'TASK_COMPLETED')

  const stale = await api(`/v2/workspace/tasks/${target.task.id}/state`, 'POST', {
    expectedVersion: target.version,
    action: 'REOPEN',
  })
  assert.equal(stale.status, 409)
  assert.equal(stale.body.code, 'VERSION_CONFLICT')
  assert.equal(stale.body.latestVersion, target.version + 1)

  const reopened = await api(`/v2/workspace/tasks/${target.task.id}/state`, 'POST', {
    expectedVersion: completed.body.version,
    action: 'REOPEN',
  })
  assert.equal(reopened.body.task.completed, false)

  const renamed = await api(`/v2/workspace/tasks/${target.task.id}`, 'PATCH', {
    expectedVersion: reopened.body.version,
    task: { title: '온보딩 첫 화면 문구 확정' },
    assignee: { memberId: null },
  })
  assert.equal(renamed.status, 200)
  assert.equal(renamed.body.task.title, '온보딩 첫 화면 문구 확정')
  assert.equal(renamed.body.assigneeId, null)
  const outsider = await api(`/v2/workspace/tasks/${target.task.id}`, 'PATCH', {
    expectedVersion: renamed.body.version,
    assignee: { memberId: 99 },
  })
  assert.equal(outsider.status, 400)
})

test('create, delete and restore keep versions and trash rows in step', async () => {
  const { api } = setup()
  const created = await api('/v2/workspace/tasks', 'POST', {
    task: {
      title: '스테이징 배포 확인',
      description: '',
      dueDate: { date: '2030-01-02', zoneId: 'Asia/Seoul', offset: '+09:00' },
      importance: 6,
      difficulty: 2,
    },
    location: { spaceId: 2, projectId: 21 },
    assignee: { memberId: null },
  })
  assert.equal(created.status, 201)
  assert.equal(created.body.spaceId, 2)
  assert.equal(created.body.projectId, 21)
  assert.equal(created.body.assigneeId, null)
  const id = created.body.task.id

  const scheduled = await api(`/v2/workspace/tasks/${id}/schedule`, 'POST', {
    expectedVersion: created.body.version,
    schedule: {
      date: { dateTime: '2030-01-02T10:00:00', zoneId: 'Asia/Seoul' },
      scheduleType: 'DEEP_WORK',
    },
  })
  assert.equal(scheduled.status, 201)
  assert.equal(scheduled.body.schedule.taskId, id)
  assert.equal(scheduled.body.spaceId, 2)
  const again = await api(`/v2/workspace/tasks/${id}`)
  assert.equal(again.body.allowedActions.schedule, false)
  assert.equal(again.body.unavailableReasons.schedule, 'ALREADY_SCHEDULED')

  assert.equal(
    (await api(`/v2/workspace/tasks/${id}?expectedVersion=${again.body.version}&deleteSchedules=true`, 'DELETE')).status,
    204,
  )
  assert.equal((await api(`/v2/workspace/tasks/${id}`)).status, 404)
  const trash = await api('/v2/trash')
  const row = trash.body.tasks.find((item) => item.taskId === id)
  assert.ok(row)
  assert.equal(row.version, again.body.version + 1)
  const restored = await api(`/v2/workspace/tasks/${id}/restore`, 'POST', {
    expectedVersion: row.version,
  })
  assert.equal(restored.status, 200)
  assert.deepEqual(restored.body.restoreResult.restoredScheduleIds, [scheduled.body.schedule.id])
  assert.equal(restored.body.spaceId, 2)
})

test('schedule state actions follow the server rules', async () => {
  const { api } = setup()
  const created = await api('/v2/workspace/schedules', 'POST', {
    schedule: {
      title: '코드 리뷰',
      description: '',
      date: { dateTime: '2030-01-03T14:00:00', zoneId: 'Asia/Seoul' },
      scheduleType: 'QUICK_TASK',
      plannedDuration: 'PT45M',
    },
    location: { spaceId: 2, projectId: null },
  })
  assert.equal(created.status, 201)
  const id = created.body.schedule.id
  assert.equal(created.body.allowedActions.start, true)
  assert.equal(created.body.allowedActions.cancel, false)
  // 데모 데이터의 진행 중 일정(1)을 먼저 멈춘다.
  const running = await api('/v2/workspace/schedules/1')
  if (running.body.schedule.state === 'IN_PROGRESS')
    await api('/v2/workspace/schedules/1/state', 'POST', {
      expectedVersion: running.body.version,
      action: 'SUSPEND',
    })
  const started = await api(`/v2/workspace/schedules/${id}/state`, 'POST', {
    expectedVersion: created.body.version,
    action: 'START',
  })
  assert.equal(started.status, 200)
  assert.equal(started.body.schedule.state, 'IN_PROGRESS')
  assert.equal(started.body.allowedActions.delete, false)
  assert.equal(started.body.unavailableReasons.delete, 'SCHEDULE_RUNNING')
  assert.equal(
    (await api(`/v2/workspace/schedules/${id}?expectedVersion=${started.body.version}`, 'DELETE')).status,
    409,
  )
  const done = await api(`/v2/workspace/schedules/${id}/state`, 'POST', {
    expectedVersion: started.body.version,
    action: 'COMPLETE',
  })
  assert.equal(done.body.schedule.state, 'COMPLETED')
  assert.equal(done.body.schedule.duration, 'PT45M')
  assert.equal(done.body.allowedActions.delete, true)
})

test('the workspace event stream sends changed frames that the realtime parser reads', async () => {
  const { api, call, workspace } = setup()
  const controller = new AbortController()
  const response = await call('/v2/workspace/events', 'GET', undefined, {
    signal: controller.signal,
    headers: { Accept: 'text/event-stream' },
  })
  assert.equal(response.status, 200)
  assert.match(response.headers.get('Content-Type'), /text\/event-stream/)
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  const readUntil = async (pattern) => {
    while (!pattern.test(text)) {
      const chunk = await reader.read()
      if (chunk.done) break
      text += decoder.decode(chunk.value, { stream: true })
    }
    return text
  }
  assert.match(await readUntil(/event: ready/), /event: ready/)

  const created = workspace.mockWorkspaceRemote.createTask('고객 문의 답변 템플릿 정리')
  const frame = (await readUntil(/event: changed[\s\S]*?\n\n/)).match(
    /id: (\d+)\nevent: changed\ndata: (.+)\n\n/,
  )
  assert.ok(frame)
  const event = JSON.parse(frame[2])
  assert.deepEqual(event, {
    spaceId: 2,
    resourceType: 'TASK',
    resourceId: created.task.id,
    version: 1,
    action: 'CREATED',
  })
  const visible = await api(`/v2/workspace/tasks/${created.task.id}`)
  assert.equal(visible.body.task.title, '고객 문의 답변 템플릿 정리')

  controller.abort()
  const tail = await reader.read()
  assert.equal(tail.done, true)
})
