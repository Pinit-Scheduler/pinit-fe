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
  assert.equal(routeScope('/app/task-map'), 'selected')
  assert.equal(routeScope('/app/plan'), 'selected')
  assert.equal(routeScope('/app/settings/recurrences'), 'selected')
  assert.equal(routeScope('/app/tasks/'), 'selected')
  assert.equal(routeScope('/app/deadline-risk'), 'personal')
  assert.equal(routeScope('/app/today'), 'all')
  assert.equal(routeScope('/app/statistics'), 'all')
  assert.equal(routeScope('/app/settings/trash'), 'all')
  assert.equal(routeScope('/app/spaces'), 'all')
  assert.equal(routeScope('/app/mind-map'), 'all')
  // 일정은 스페이스를 고르지 않는 내 화면이다(오늘·마인드맵·통계와 같은 묶음).
  assert.equal(routeScope('/app/schedules'), 'all')
  assert.equal(routeScope('/app/schedules/'), 'all')
  assert.equal(routeScope('/app/tasks/12'), 'all')
  assert.equal(routeScope('/app/tasks/new'), 'all')
  assert.equal(routeScope('/app/schedules/5/edit'), 'all')
})
test('choosing a project stays on scoped lists and leaves detail screens', () => {
  const { projectSelectionTarget } = load('features/spaces/scope.ts')
  assert.equal(projectSelectionTarget('/app/schedules'), '/app/tasks')
  assert.equal(projectSelectionTarget('/app/task-map'), null)
  assert.equal(projectSelectionTarget('/app/tasks'), null)
  assert.equal(projectSelectionTarget('/app/plan'), null)
  assert.equal(projectSelectionTarget('/app/settings/recurrences'), null)
  assert.equal(projectSelectionTarget('/app/tasks/'), null)
  assert.equal(projectSelectionTarget('/app/today'), '/app/tasks')
  assert.equal(projectSelectionTarget('/app/statistics'), '/app/tasks')
  assert.equal(projectSelectionTarget('/app/mind-map'), '/app/tasks')
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
test('my schedules are the ones I hold, plus unassigned ones where nobody else is', () => {
  const { ownSchedules } = load('features/spaces/scope.ts')
  const member = (memberId) => ({ memberId })
  const spaces = [
    { id: -7, personal: true, members: [member(7)] },
    { id: 22, personal: false, members: [member(7)] },
    { id: 31, personal: false, members: [member(7), member(9)] },
  ]
  const day = [
    { id: 1, spaceId: -7, assigneeId: 7 },
    { id: 2, spaceId: -7, assigneeId: null },
    { id: 3, spaceId: 22, assigneeId: null },
    { id: 4, spaceId: 31, assigneeId: 7 },
    { id: 5, spaceId: 31, assigneeId: 9 },
    { id: 6, spaceId: 31, assigneeId: null },
    { id: 7, assigneeId: 7 },
    { id: 8, assigneeId: null },
  ]
  const ids = (list) => Array.from(list, (item) => item.id)
  assert.deepEqual(
    ids(ownSchedules(day, 7, spaces)),
    [1, 2, 3, 4, 7, 8],
    'a team schedule held by someone else or by nobody is not mine',
  )
  // The other member of the shared space gets only that space from the server.
  const theirDay = day.filter((item) => item.spaceId === 31)
  assert.deepEqual(ids(ownSchedules(theirDay, 9, [spaces[2]])), [5], 'they see only what they hold there')
  // A space in the trash, or one that has not loaded yet, never turns an unassigned schedule into a team one by guess.
  assert.deepEqual(ids(ownSchedules([{ id: 9, spaceId: 99, assigneeId: null }], 7, spaces)), [9])
  assert.deepEqual(ids(ownSchedules(day, 7, [])), [1, 2, 3, 4, 6, 7, 8], 'before spaces load only assignments decide')
  assert.deepEqual(ids(ownSchedules(day, 0, spaces)), [], 'until I am known nothing is shown as mine')
})
test('the schedule screen reads every space once and counts only my schedules', async () => {
  const requests = []
  const queries = []
  const selection = {
    selectedSpaceId: 22,
    selectedProjectId: 7,
    memberId: 7,
    spaces: [
      { id: -7, personal: true, members: [{ memberId: 7 }] },
      { id: 31, personal: false, members: [{ memberId: 7 }, { memberId: 9 }] },
    ],
  }
  const rows = [
    { id: 1, spaceId: -7, assigneeId: 7, state: 'NOT_STARTED', date: { dateTime: '2026-11-08T09:00:00' } },
    { id: 2, spaceId: 31, assigneeId: 9, state: 'NOT_STARTED', date: { dateTime: '2026-11-08T10:00:00' } },
    { id: 3, spaceId: 31, assigneeId: null, state: 'NOT_STARTED', date: { dateTime: '2026-11-08T11:00:00' } },
    // 이 날에는 다른 사람의 일정만 있다. 내 일정만 세면 점이 없어야 한다.
    { id: 4, spaceId: 31, assigneeId: 9, state: 'NOT_STARTED', date: { dateTime: '2026-11-09T09:00:00' } },
  ]
  const dayjs = (value) => ({
    value,
    hour: () => dayjs(value),
    format: () => value.slice(0, 7),
    isBefore: (other) => value < other,
  })
  const results = new Map()
  const shared = {
    '../api/schedules': {
      fetchSchedules: async (time, options) => (requests.push(['day', options]), rows),
      fetchWeeklySchedules: async (time, options) => (requests.push(['week', options]), rows),
    },
    '@shared/utils/datetime': {
      getTodayWithOffset: () => dayjs('2026-11-10'),
      getWeekDays: () => ['2026-11-08', '2026-11-09'],
      toApiDateTimeWithZone: () => ({ dateTime: '2026-11-10T12:00:00', zoneId: 'Asia/Seoul' }),
      toDateFromApi: (date) => date.dateTime,
      toDateKey: (value) => (typeof value === 'string' ? value : (value.dateTime ?? value.value)).slice(0, 10),
    },
    '../utils/monthGrid': {
      ...load('features/schedules/utils/monthGrid.ts'),
      monthWeekStarts: () => [dayjs('2026-11-02')],
    },
    '@contexts/TimePreferencesContext': { useTimePreferences: () => ({ offsetMinutes: 540 }) },
    '@shared/hooks/useRevalidatingQuery': {
      useRevalidatingQuery: (key, fetcher) => {
        queries.push({ key, fetcher })
        return { data: results.get(key), error: null }
      },
    },
    '@features/spaces/store': { useSpaces: () => selection },
    '@features/spaces/scope': load('features/spaces/scope.ts'),
    dayjs: { default: (value) => dayjs(value) },
    react: { useMemo: (factory) => factory() },
  }
  const hook = (name) => load(`features/schedules/hooks/${name}.ts`, shared).default
  const render = (options) => ({
    day: hook('useScheduleList')(dayjs('2026-11-10'), { allSpaces: options.allSpaces }),
    week: hook('useWeeklySchedulePresence')({ weekStart: dayjs('2026-11-08'), ...options }),
    month: hook('useMonthlySchedules')(dayjs('2026-11-10'), true, options),
    overdue: hook('useOverdueSchedulesSummary')(options),
  })
  render({ allSpaces: true, own: true })
  const everySpace = queries.splice(0)
  selection.selectedSpaceId = 31
  selection.selectedProjectId = null
  render({ allSpaces: true, own: true })
  assert.deepEqual(
    queries.map((query) => query.key),
    everySpace.map((query) => query.key),
    'another selected space or project is the same key, so the rows on screen are kept',
  )
  queries.length = 0
  render({ allSpaces: false, own: false })
  for (const [index, query] of queries.entries())
    assert.notEqual(query.key, everySpace[index].key, 'the selected-space list keeps its own key')
  const selected = queries.splice(0)
  for (const { key, fetcher } of [...everySpace, ...selected]) results.set(key, await fetcher(new AbortController().signal))
  assert.deepEqual(
    JSON.parse(JSON.stringify(requests)),
    [
      ['day', { allSpaces: true }],
      ['week', { allSpaces: true }],
      ['week', { allSpaces: true }],
      ['week', { allSpaces: true }],
      ['day', { allSpaces: false }],
      ['week', { allSpaces: false }],
      ['week', { allSpaces: false }],
      ['week', { allSpaces: false }],
    ],
    'no request asks the server for mine: one personal rule is applied to what comes back',
  )
  // 받은 네 건 가운데 내 일정은 하나다. 점·달력 숫자·지난 일정 안내가 모두 그 하나만 센다.
  const mine = render({ allSpaces: true, own: true })
  assert.deepEqual(JSON.parse(JSON.stringify(mine.week.presenceMap)), {
    '2026-11-08': { hasSchedule: true, hasOverdue: true },
    '2026-11-09': { hasSchedule: false, hasOverdue: false },
  })
  assert.equal(mine.month.summaryByDate['2026-11-08'].total, 1)
  assert.equal(mine.month.summaryByDate['2026-11-09'], undefined)
  assert.deepEqual(JSON.parse(JSON.stringify(mine.overdue.summary)), { hasOverdue: true, count: 1, earliestDate: '2026-11-08' })
  const everyone = render({ allSpaces: false, own: false })
  assert.equal(everyone.week.presenceMap['2026-11-09'].hasSchedule, true)
  assert.equal(everyone.month.summaryByDate['2026-11-08'].total, 3)
  assert.equal(everyone.overdue.summary.count, 4)
  // 스페이스가 나중에 도착해도, 받아 둔 같은 응답을 그릴 때 다시 거른다(거르려고 다시 받지는 않는다).
  selection.spaces = []
  assert.equal(render({ allSpaces: true, own: true }).overdue.summary.count, 2, 'before spaces load the unassigned one still counts')
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
  for (const path of ['/app/spaces', '/app/schedules', '/app/statistics', '/app/settings', '/app/deadline-risk'])
    assert.deepEqual(from(path, 7), {}, path)
  assert.deepEqual(plain(createAffiliationFor(null, '', workspace(7))), {})
})
test('a new schedule always starts in my space, whatever screen is behind the form', () => {
  const { createAffiliationFor } = load('features/spaces/scope.ts')
  const plain = (value) => JSON.parse(JSON.stringify(value))
  const projects = [
    { id: 7, spaceId: 22, completed: false },
    { id: 5, spaceId: -4, completed: false },
    { id: 6, spaceId: -4, completed: true },
  ]
  const workspace = (overrides = {}) => ({ defaultSpaceId: -4, selectedSpaceId: 22, selectedProjectId: 7, projects, ...overrides })
  const schedule = (pathname, search, overrides) =>
    plain(createAffiliationFor(pathname === null ? null : { pathname }, search, workspace(overrides), 'schedule'))
  // A team space and its project are selected on every one of these screens: none of it reaches a schedule.
  for (const path of ['/app/tasks', '/app/schedules', '/app/task-map', '/app/plan', '/app/settings/recurrences', '/app/today', '/app/statistics'])
    assert.deepEqual(schedule(path, ''), { spaceId: -4 }, path)
  assert.deepEqual(schedule(null, ''), { spaceId: -4 }, 'no screen behind the form')
  assert.deepEqual(schedule(null, '?from=today'), { spaceId: -4 })
  // My own space is selected with one of its projects: that project is still a fair start.
  assert.deepEqual(schedule('/app/tasks', '', { selectedSpaceId: -4, selectedProjectId: 5 }), { spaceId: -4, categoryId: 5 })
  assert.deepEqual(schedule('/app/tasks', '', { selectedSpaceId: -4, selectedProjectId: 6 }), { spaceId: -4 }, 'completed project')
  // Until my space is known nothing is named; the form and the save wait for it instead of using the selection.
  assert.deepEqual(schedule('/app/tasks', '', { defaultSpaceId: 0 }), {})
  assert.deepEqual(schedule('/app/tasks', '', { defaultSpaceId: null }), {})
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
  // 일정 폼은 같은 화면 위에서 열어도 나의 스페이스다: 훅이 종류를 규칙에 넘긴다.
  slots.length = 0
  index = 0
  workspace = { ...workspace, selectedSpaceId: 22, selectedProjectId: 7 }
  assert.deepEqual(JSON.parse(JSON.stringify(useCreateAffiliation('schedule'))), { spaceId: -4 })
})
