import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

function load(path) {
  const source = readFileSync(
    new URL('../src/' + path, import.meta.url),
    'utf8',
  )
  const output = ts.transpileModule(source, {
    fileName: path,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  const module = { exports: {} }
  vm.runInNewContext(output, {
    module,
    exports: module.exports,
    URLSearchParams,
    Number,
  })
  return module.exports
}

test('route scope follows the screen, not the selection', () => {
  const { routeScope } = load('features/spaces/scope.ts')
  assert.equal(routeScope('/app/tasks'), 'selected')
  assert.equal(routeScope('/app/schedules'), 'selected')
  assert.equal(routeScope('/app/task-map'), 'selected')
  assert.equal(routeScope('/app/plan'), 'selected')
  assert.equal(routeScope('/app/settings/recurrences'), 'selected')
  assert.equal(routeScope('/app/tasks/'), 'selected')
  assert.equal(routeScope('/app/deadline-risk'), 'personal')
  assert.equal(routeScope('/app/today'), 'all')
  assert.equal(routeScope('/app/statistics'), 'all')
  assert.equal(routeScope('/app/settings/trash'), 'all')
  assert.equal(routeScope('/app/spaces'), 'all')
  assert.equal(routeScope('/app/tasks/12'), 'all')
  assert.equal(routeScope('/app/tasks/new'), 'all')
  assert.equal(routeScope('/app/schedules/5/edit'), 'all')
})
test('choosing a project stays on scoped lists and leaves detail screens', () => {
  const { projectSelectionTarget } = load('features/spaces/scope.ts')
  assert.equal(projectSelectionTarget('/app/schedules'), null)
  assert.equal(projectSelectionTarget('/app/task-map'), null)
  assert.equal(projectSelectionTarget('/app/tasks'), null)
  assert.equal(projectSelectionTarget('/app/plan'), null)
  assert.equal(projectSelectionTarget('/app/settings/recurrences'), null)
  assert.equal(projectSelectionTarget('/app/tasks/'), null)
  assert.equal(projectSelectionTarget('/app/today'), '/app/tasks')
  assert.equal(projectSelectionTarget('/app/statistics'), '/app/tasks')
  assert.equal(projectSelectionTarget('/app/tasks/12'), '/app/tasks')
  assert.equal(projectSelectionTarget('/app/schedules/5/edit'), '/app/tasks')
})
test('today creates in the personal space only when it is known', () => {
  const { createSpaceIdFor } = load('features/spaces/scope.ts')
  assert.equal(createSpaceIdFor('?from=today', -4), -4)
  assert.equal(createSpaceIdFor('?from=today', null), undefined)
  assert.equal(createSpaceIdFor('?from=today', 0), undefined)
  assert.equal(createSpaceIdFor('?from=today', Number.NaN), undefined)
  assert.equal(createSpaceIdFor('', -4), undefined)
  assert.equal(createSpaceIdFor('?from=tasks', -4), undefined)
})
test('breadcrumb names the scope the screen uses', () => {
  const { scopeCrumb } = load('features/spaces/scope.ts')
  const space = { name: '핀잇 개선', personal: false }
  assert.equal(
    scopeCrumb('selected', space, { name: '작업 카드 개선' }),
    '핀잇 개선 › 작업 카드 개선',
  )
  assert.equal(scopeCrumb('selected', space, null), '핀잇 개선')
  assert.equal(scopeCrumb('selected', null, null), '스페이스')
  assert.equal(scopeCrumb('all', space, null), '모든 스페이스')
  assert.equal(scopeCrumb('personal', null, null), '나의 스페이스')
  assert.equal(
    scopeCrumb('personal', { name: '내 공부', personal: true }, null),
    '내 공부',
  )
})
test('schedule audience maps to the mine parameter', () => {
  const { scheduleMineParam } = load('features/spaces/scope.ts')
  assert.equal(scheduleMineParam(true, 'team'), undefined)
  assert.equal(scheduleMineParam(true, 'mine'), undefined)
  assert.equal(scheduleMineParam(false, 'mine'), true)
  assert.equal(scheduleMineParam(false, 'team'), false)
})
test('switching spaces brings the schedule view back to mine', () => {
  const { audienceFor } = load('features/spaces/scope.ts')
  assert.equal(audienceFor(31, null), 'mine')
  assert.equal(audienceFor(31, { spaceId: 31, audience: 'team' }), 'team')
  assert.equal(audienceFor(44, { spaceId: 31, audience: 'team' }), 'mine')
})
test('my schedules keep only my assignments and count the hidden ones', () => {
  const { audienceSchedules } = load('features/spaces/scope.ts')
  const day = [
    { id: 1, assigneeId: 7 },
    { id: 2, assigneeId: 9 },
    { id: 3, assigneeId: null },
    { id: 4, assigneeId: 7 },
  ]
  const ids = (result) => Array.from(result.visible, (item) => item.id)
  const mine = audienceSchedules(day, true, 'mine', 7)
  assert.deepEqual(ids(mine), [1, 4])
  assert.equal(mine.hidden, 2)
  const team = audienceSchedules(day, true, 'team', 7)
  assert.deepEqual(ids(team), [1, 2, 3, 4])
  assert.equal(team.hidden, 0)
  const solo = audienceSchedules(day, false, 'mine', 7)
  assert.deepEqual(ids(solo), [1, 2, 3, 4])
  assert.equal(solo.hidden, 0)
})
test('overdue banner asks the server for the same audience as the week dots', () => {
  const read = (path) => readFileSync(new URL('../src/' + path, import.meta.url), 'utf8')
  const hook = read('features/schedules/hooks/useOverdueSchedulesSummary.ts')
  assert.match(hook, /fetchWeeklySchedules\(.*\{ mine \}\)/)
  const page = read('features/schedules/pages/tab/SchedulesTabPage.tsx')
  assert.match(page, /useOverdueSchedulesSummary\(\{ mine \}\)/)
})
test('a new item starts in the space and project of the screen behind the form', () => {
  const { createAffiliationFor } = load('features/spaces/scope.ts')
  const plain = (value) => JSON.parse(JSON.stringify(value))
  const projects = [
    { id: 7, spaceId: 22, completed: false },
    { id: 8, spaceId: 22, completed: true },
    { id: 9, spaceId: 22, completed: false, deleted: true },
    { id: 10, spaceId: 31, completed: false },
  ]
  const workspace = (selectedProjectId, overrides = {}) => ({
    defaultSpaceId: -4,
    selectedSpaceId: 22,
    selectedProjectId,
    projects,
    ...overrides,
  })
  const at = (pathname) => ({ pathname })
  const from = (pathname, projectId, overrides) =>
    plain(createAffiliationFor(at(pathname), '', workspace(projectId, overrides)))

  // Lists that show the selected space take its project too.
  for (const path of [
    '/app/tasks',
    '/app/tasks/',
    '/app/schedules',
    '/app/task-map',
    '/app/plan',
    '/app/settings/recurrences',
  ])
    assert.deepEqual(from(path, 7), { spaceId: 22, categoryId: 7 }, path)
  assert.deepEqual(from('/app/tasks', null), {}, 'whole space: no project')
  assert.deepEqual(from('/app/tasks', 8), {}, 'completed project')
  assert.deepEqual(from('/app/tasks', 9), {}, 'deleted project')
  assert.deepEqual(from('/app/tasks', 10), {}, 'project of another space')
  assert.deepEqual(from('/app/tasks', 99), {}, 'project not loaded yet')
  assert.deepEqual(
    from('/app/tasks', 7, { selectedSpaceId: null }),
    {},
    'no space selected yet',
  )

  // Today keeps the personal space, from its buttons or the query.
  assert.deepEqual(from('/app/today', 7), { spaceId: -4 })
  assert.deepEqual(
    plain(createAffiliationFor(null, '?from=today', workspace(7))),
    { spaceId: -4 },
  )
  assert.deepEqual(
    from('/app/today', 7, { defaultSpaceId: 0 }),
    {},
    'personal space still loading: the form falls back',
  )

  // Screens that are not a selected-space list, or no screen behind: the form's fallback.
  for (const path of ['/app/spaces', '/app/statistics', '/app/settings', '/app/deadline-risk'])
    assert.deepEqual(from(path, 7), {}, path)
  assert.deepEqual(plain(createAffiliationFor(null, '', workspace(7))), {})
})
test('create pages read the screen behind them once, when they open', () => {
  for (const path of [
    'features/tasks/pages/TaskCreatePage.tsx',
    'features/schedules/pages/form/ScheduleCreatePage.tsx',
  ]) {
    const source = readFileSync(new URL('../src/' + path, import.meta.url), 'utf8')
    assert.match(
      source,
      /useState\(\(\) =>\s*createAffiliationFor\(\s*safeBackground\(location\.state\),\s*location\.search,/,
      path,
    )
  }
})
