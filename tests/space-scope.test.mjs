import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { requireFrom } from './support/errors.mjs'

function load(path, dependencies = {}) {
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
    require: requireFrom(dependencies),
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
test('the overdue banner asks the server for the audience it is given, under its own key', async () => {
  const requests = []
  const queries = []
  const useOverdueSchedulesSummary = load('features/schedules/hooks/useOverdueSchedulesSummary.ts', {
    dayjs: { default: () => ({ isBefore: () => false }) },
    '../api/schedules': {
      fetchWeeklySchedules: async (start, options) => {
        requests.push(options)
        return []
      },
    },
    '@shared/utils/datetime': {
      getTodayWithOffset: () => new Date(0),
      toApiDateTimeWithZone: () => '2026-11-10T00:00:00',
      toDateFromApi: () => new Date(0),
      toDateKey: () => '2026-11-10',
    },
    '@contexts/TimePreferencesContext': { useTimePreferences: () => ({ offsetMinutes: 540 }) },
    '@shared/hooks/useRevalidatingQuery': {
      useRevalidatingQuery: (key, fetcher) => {
        queries.push({ key, fetcher })
        return { data: undefined }
      },
    },
    '@features/spaces/store': { useSpaces: () => ({ selectedSpaceId: 22, selectedProjectId: null }) },
  }).default
  for (const mine of [true, false, undefined]) useOverdueSchedulesSummary({ mine })
  for (const { fetcher } of queries) await fetcher(new AbortController().signal)
  assert.deepEqual(requests.map((options) => options.mine), [true, false, undefined])
  assert.equal(new Set(queries.map((query) => query.key)).size, 3, 'switching the audience never shows the other count')
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
  assert.deepEqual(from('/app/today', 7, { defaultSpaceId: null }), {}, 'no personal space')

  // Screens that are not a selected-space list, or no screen behind: the form's fallback.
  for (const path of ['/app/spaces', '/app/statistics', '/app/settings', '/app/deadline-risk'])
    assert.deepEqual(from(path, 7), {}, path)
  assert.deepEqual(plain(createAffiliationFor(null, '', workspace(7))), {})
})
test('a create form keeps the affiliation it opened with while the screen behind it changes', () => {
  const slots = []
  let index = 0
  const location = { state: { background: { pathname: '/app/tasks' } }, search: '' }
  let workspace = {
    defaultSpaceId: -4,
    selectedSpaceId: 22,
    selectedProjectId: 7,
    projects: [{ id: 7, spaceId: 22, completed: false }],
  }
  const { useCreateAffiliation } = load('features/spaces/useCreateAffiliation.ts', {
    react: {
      useState: (initial) => {
        const i = index++
        if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial
        return [slots[i], () => {}]
      },
    },
    'react-router-dom': { useLocation: () => location },
    '@shared/routing/routeSurfaceState': { safeBackground: (state) => state?.background ?? null },
    './scope': load('features/spaces/scope.ts'),
    './store': { useSpaces: () => workspace },
  })
  const render = () => {
    index = 0
    return JSON.parse(JSON.stringify(useCreateAffiliation()))
  }
  assert.deepEqual(render(), { spaceId: 22, categoryId: 7 })
  workspace = { ...workspace, selectedSpaceId: 31, selectedProjectId: null }
  assert.deepEqual(render(), { spaceId: 22, categoryId: 7 }, 'a later selection change does not rewrite the form')
})
