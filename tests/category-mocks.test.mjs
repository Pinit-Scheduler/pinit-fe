import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

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
const token = (owner) =>
  `${btoa('{}')}.${btoa(JSON.stringify({ sub: owner, exp: Math.floor(Date.now() / 1000) + 3600 }))}.mock`
const request = (route, method = 'GET', body, owner = 1) =>
  new Request(`http://mock.test/v2/categories${route}`, {
    method,
    headers: {
      Authorization: `Bearer ${token(owner)}`,
      'Content-Type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
const task = (id, ownerId = 1, extra = {}) => ({
  id,
  ownerId,
  title: `Task ${id}`,
  description: 'Fixture',
  dueDate: { date: '2026-11-03', zoneId: 'Asia/Seoul' },
  importance: 7,
  difficulty: 3,
  completed: false,
  tags: [{ id: 99, name: '기존 태그' }],
  ...extra,
})
const schedule = (id, ownerId = 1, extra = {}) => ({
  id,
  ownerId,
  title: `Schedule ${id}`,
  description: '',
  date: { dateTime: '2026-11-03T10:00:00', zoneId: 'Asia/Seoul' },
  state: 'NOT_STARTED',
  scheduleType: 'DEEP_WORK',
  duration: 'PT0S',
  ...extra,
})
const setup = () => {
  const tasks = [task(1), task(2, 2)],
    schedules = [schedule(1), schedule(2, 2)]
  const { createCategoryMockRepository } = loadModules()(
    'src/mocks/categories.ts',
  )
  const repo = createCategoryMockRepository(tasks, schedules)
  const call = async (route = '', method = 'GET', body, owner = 1) => {
    const req = request(route, method, body, owner)
    return repo.handle(new URL(req.url).pathname, method, req)
  }
  return { tasks, schedules, repo, call }
}

test('new sidecar starts with six categories and None assignments without converting legacy tags', async () => {
  const { tasks, call } = setup(),
    before = JSON.stringify(tasks)
  const response = await call(),
    result = await response.json()
  assert.equal(result.categories.length, 6)
  assert.equal(
    result.categories.every((category) => category.builtIn && category.id < 0),
    true,
  )
  assert.deepEqual(result.taskAssignments, {})
  assert.deepEqual(result.scheduleAssignments, {})
  assert.equal(JSON.stringify(tasks), before)
})
test('custom category CRUD validates names, preserves defaults and cleans only owner assignments', async () => {
  const { call } = setup()
  assert.equal((await call('', 'POST', { name: '   ' })).status, 400)
  assert.equal((await call('', 'POST', { name: '학습' })).status, 409)
  const created = await (await call('', 'POST', { name: '  취미  ' })).json()
  assert.equal(created.name, '취미')
  assert.ok(created.id > 0)
  assert.equal(
    (await call(`/${created.id}`, 'PATCH', { name: '생활·행정' })).status,
    409,
  )
  assert.equal((await call('/-1', 'DELETE')).status, 409)
  await call('/tasks/1', 'PUT', { categoryId: created.id })
  await call(`/${created.id}`, 'PATCH', { name: '독서' })
  assert.equal(
    (await (await call()).json()).categories.find(
      (category) => category.id === created.id,
    ).name,
    '독서',
  )
  await call(`/${created.id}`, 'DELETE')
  assert.deepEqual((await (await call()).json()).taskAssignments, {})
})
test('None is explicit, reversible and never rewrites tags or task data', async () => {
  const { call, tasks } = setup(),
    before = JSON.stringify(tasks)
  await call('/tasks/1', 'PUT', { categoryId: -3 })
  assert.equal((await (await call()).json()).taskAssignments['1'], -3)
  await call('/tasks/1', 'PUT', { categoryId: null })
  assert.deepEqual((await (await call()).json()).taskAssignments, {})
  assert.equal(JSON.stringify(tasks), before)
})
test('category names and assignments cannot cross owners; invalid targets and unauthenticated requests fail', async () => {
  const { call, repo } = setup()
  const first = await (await call('', 'POST', { name: '나의 분류' })).json()
  await call('/tasks/1', 'PUT', { categoryId: first.id })
  assert.equal(
    (await call('/tasks/1', 'PUT', { categoryId: -1 }, 2)).status,
    404,
  )
  assert.equal(
    (await call('/tasks/2', 'PUT', { categoryId: first.id }, 2)).status,
    400,
  )
  assert.equal((await call(`/${first.id}`, 'DELETE', undefined, 2)).status, 404)
  const other = await (await call('', 'GET', undefined, 2)).json()
  assert.equal(other.categories.length, 6)
  assert.deepEqual(other.taskAssignments, {})
  const req = new Request('http://mock.test/v2/categories')
  assert.equal((await repo.handle('/v2/categories', 'GET', req)).status, 401)
})
test('task category is copied once to a newly assigned schedule', async () => {
  const { call, schedules, repo } = setup()
  await call('/tasks/1', 'PUT', { categoryId: -3 })
  schedules.push(schedule(10, 1, { taskId: 1 }))
  repo.inheritTaskSchedule(1, 10)
  await call('/tasks/1', 'PUT', { categoryId: -2 })
  assert.equal((await (await call()).json()).scheduleAssignments['10'], -3)
  schedules.push(schedule(11, 2, { taskId: 1 }))
  repo.inheritTaskSchedule(1, 11)
  assert.equal(
    (await (await call('', 'GET', undefined, 2)).json()).scheduleAssignments[
      '11'
    ],
    undefined,
  )
})
test('series TEMPLATE affects only future generation; FOLLOWING preserves earlier occurrences', async () => {
  const { call, tasks, schedules, repo } = setup()
  repo.registerSeries(10, 1)
  tasks.push(
    task(10, 1, { recurrence: { seriesId: 10, occurrenceDate: '2026-11-01' } }),
    task(11, 1, { recurrence: { seriesId: 10, occurrenceDate: '2026-11-05' } }),
  )
  assert.equal(
    (
      await call('/recurrences/10', 'PUT', {
        categoryId: -2,
        scope: 'TEMPLATE',
      })
    ).status,
    204,
  )
  assert.deepEqual((await (await call()).json()).taskAssignments, {})
  schedules.push(
    schedule(12, 1, {
      recurrence: { seriesId: 10, occurrenceDate: '2026-11-06' },
    }),
  )
  repo.inheritOccurrence('schedule', 12, 1, 10, '2026-11-06')
  assert.equal((await (await call()).json()).scheduleAssignments['12'], -2)
  assert.equal(
    (
      await call('/recurrences/10', 'PUT', {
        categoryId: -3,
        scope: 'FOLLOWING',
      })
    ).status,
    400,
  )
  await call('/recurrences/10', 'PUT', {
    categoryId: -3,
    scope: 'FOLLOWING',
    fromDate: '2026-11-04',
  })
  const result = await (await call()).json()
  assert.equal(result.taskAssignments['10'], undefined)
  assert.equal(result.taskAssignments['11'], -3)
  assert.equal(result.scheduleAssignments['12'], -3)
  repo.registerSeries(20, 1, 10)
  tasks.push(
    task(20, 1, { recurrence: { seriesId: 20, occurrenceDate: '2026-11-10' } }),
  )
  repo.inheritOccurrence('task', 20, 1, 20, '2026-11-10')
  assert.equal((await (await call()).json()).taskAssignments['20'], -3)
})
test('deleting custom category clears current and future series assignments', async () => {
  const { call, tasks, repo } = setup()
  repo.registerSeries(10, 1)
  const category = await (await call('', 'POST', { name: '분류' })).json()
  await call('/recurrences/10', 'PUT', {
    categoryId: category.id,
    scope: 'ALL',
  })
  await call(`/${category.id}`, 'DELETE')
  tasks.push(
    task(30, 1, { recurrence: { seriesId: 10, occurrenceDate: '2026-11-10' } }),
  )
  repo.inheritOccurrence('task', 30, 1, 10, '2026-11-10')
  const result = await (await call()).json()
  assert.deepEqual(result.seriesAssignments, {})
  assert.deepEqual(result.taskAssignments, {})
})
test('mock router inherits category through task-to-schedule creation and recurrence regeneration', async () => {
  assert.ok(existsSync(path.join(root, 'src/mocks/handlers.ts')))
  const load = loadModules(),
    { handleMockRequest } = load('src/mocks/handlers.ts'),
    db = load('src/mocks/db.ts')
  const api = (route, method = 'GET', body) =>
    handleMockRequest(
      new Request(`http://mock.test${route}`, {
        method,
        headers: {
          Authorization: `Bearer ${token(1)}`,
          'Content-Type': 'application/json',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    )
  await api('/v2/categories/tasks/1', 'PUT', { categoryId: -3 })
  const before = new Set(db.mockSchedules.map((item) => item.id))
  assert.equal(
    (
      await api('/v2/tasks/1/schedules', 'POST', {
        date: { dateTime: '2030-01-01T10:00:00', zoneId: 'Asia/Seoul' },
        scheduleType: 'DEEP_WORK',
      })
    ).status,
    201,
  )
  const created = db.mockSchedules.find((item) => !before.has(item.id))
  assert.equal(
    (await (await api('/v2/categories')).json()).scheduleAssignments[
      created.id
    ],
    -3,
  )
  await api('/v2/categories/tasks/6', 'PUT', { categoryId: -1 })
  const future = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10)
  const plannedResponse = await api('/v2/plans/apply', 'POST', {
    date: future,
    zoneId: 'Asia/Seoul',
    blocks: [
      {
        taskId: 6,
        startTime: `${future}T18:00:00`,
        scheduleType: 'ADMIN_TASK',
      },
    ],
  })
  assert.equal(plannedResponse.status, 201)
  const planned = (await plannedResponse.json()).schedules[0]
  assert.equal(
    (await (await api('/v2/categories')).json()).scheduleAssignments[
      planned.id
    ],
    -1,
  )
  const date = new Date().toISOString().slice(0, 10)
  const series = await (
    await api('/v2/recurrences', 'POST', {
      mode: 'FLEXIBLE',
      title: 'Category repeat',
      description: 'Fixture',
      flexible: { importance: 5, difficulty: 2 },
      rule: { freq: 'DAILY', interval: 1, startDate: date, count: 3 },
      zoneId: 'Asia/Seoul',
    })
  ).json()
  await api(`/v2/categories/recurrences/${series.id}`, 'PUT', {
    categoryId: -2,
    scope: 'ALL',
  })
  await api(`/v2/recurrences/${series.id}`, 'PATCH', {
    scope: 'ALL',
    changes: { title: 'Changed' },
  })
  const current = await (await api('/v2/categories')).json(),
    occurrences = db.mockTasks.filter(
      (item) => item.recurrence?.seriesId === series.id,
    )
  assert.ok(occurrences.length > 0)
  assert.ok(
    occurrences.every((item) => current.taskAssignments[item.id] === -2),
  )
})

test('mock router supports dependency edits and paused-active schedule lifecycle consistently', async () => {
  const load = loadModules(),
    { handleMockRequest } = load('src/mocks/handlers.ts'),
    db = load('src/mocks/db.ts')
  const api = (route, method = 'GET', body) =>
    handleMockRequest(
      new Request(`http://mock.test/v2${route}`, {
        method,
        headers: {
          Authorization: `Bearer ${token(1)}`,
          'Content-Type': 'application/json',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    )
  assert.deepEqual((await (await api('/tasks/2')).json()).previousTaskIds, [1])
  const created = await (
    await api('/tasks', 'POST', {
      title: 'Dependency task',
      description: 'Fixture',
      dueDate: { date: '2030-01-01', zoneId: 'Asia/Seoul' },
      importance: 5,
      difficulty: 2,
      addDependencies: [{ fromId: 1, toId: 0 }],
    })
  ).json()
  assert.deepEqual(created.previousTaskIds, [1])
  assert.equal(created.inboundDependencyCount, 1)
  assert.equal(
    (
      await api(`/tasks/${created.id}`, 'PATCH', {
        removeDependencies: [{ fromId: 1, toId: created.id }],
        addDependencies: [{ fromId: created.id, toId: 2 }],
      })
    ).status,
    200,
  )
  assert.equal((await (await api('/tasks/2')).json()).inboundDependencyCount, 2)
  assert.equal(
    (
      await api('/tasks/1', 'PATCH', {
        addDependencies: [{ fromId: 2, toId: 1 }],
      })
    ).status,
    409,
  )
  await api('/schedules/1/suspend', 'POST')
  assert.equal(db.activeScheduleId, 1)
  assert.equal((await api('/schedules/2/start', 'POST')).status, 409)
  await api('/schedules/1/complete', 'POST')
  assert.equal(db.activeScheduleId, null)
  assert.equal((await (await api('/tasks/2')).json()).inboundDependencyCount, 1)
  await api(`/tasks/${created.id}/complete`, 'POST')
  assert.equal((await (await api('/tasks/2')).json()).inboundDependencyCount, 0)
  assert.equal((await api('/schedules/2/start', 'POST')).status, 204)
  await api('/schedules/2/suspend', 'POST')
  assert.equal(db.activeScheduleId, 2)
})
