import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import React from 'react'
import * as jsxRuntime from 'react/jsx-runtime'
import { renderToStaticMarkup } from 'react-dom/server'
import { apiError, requireFrom } from './support/errors.mjs'

const read = (path) => readFileSync(new URL('../src/' + path, import.meta.url), 'utf8')
const load = (path, dependencies = {}, globals = {}) => {
  const output = ts.transpileModule(read(path), {
    fileName: path,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText
  const module = { exports: {} }
  vm.runInNewContext(output, {
    module,
    exports: module.exports,
    AbortController,
    Error,
    Intl,
    Date,
    queueMicrotask,
    setTimeout,
    clearTimeout,
    require: requireFrom(dependencies),
    ...globals,
  })
  return module.exports
}
const plain = (value) => JSON.parse(JSON.stringify(value))
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
const microtasks = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve()
}
const coalesced = () => new Promise((resolve) => setTimeout(resolve, 5))
const task = (id, extra = {}) => ({
  id,
  title: `Task ${id}`,
  description: '',
  dueDate: { date: '2026-11-12', zoneId: 'Asia/Seoul' },
  importance: 7,
  difficulty: 3,
  completed: false,
  inboundDependencyCount: 0,
  previousTaskIds: [],
  nextTaskIds: [],
  ...extra,
})

// ---------------------------------------------------------------------------
// Edges: the map can tell a moved edge from a new one
// ---------------------------------------------------------------------------

const graph = load('features/task-map/graph.ts')

test('edge paths are keyed by direction and a re-sorted layout reports only the edges that moved', () => {
  const records = [
    task(1, { nextTaskIds: [2] }),
    task(2, { previousTaskIds: [1], inboundDependencyCount: 1 }),
    task(3, { importance: 9 }),
  ]
  const before = graph.graphEdgePaths(graph.buildTaskGraph(records, { today: '2026-11-10' }))
  assert.deepEqual(plain(before.map((edge) => edge.key)), ['1:2'])
  assert.match(before[0].d, /^M[\d.]+,[\d.]+ C/)
  const drawn = new Map(before.map((edge) => [edge.key, edge.d]))
  assert.deepEqual(plain(graph.movedEdgeKeys(drawn, before)), [], 'the same layout moves nothing')

  const mobile = graph.graphEdgePaths(
    graph.buildTaskGraph(records, { today: '2026-11-10', mobile: true }),
  )
  assert.deepEqual(plain(graph.movedEdgeKeys(drawn, mobile)), ['1:2'], 'a new layout moves the curve')

  const added = graph.graphEdgePaths(
    graph.buildTaskGraph(
      [...records.slice(0, 2), task(3, { previousTaskIds: [2], inboundDependencyCount: 1 })],
      { today: '2026-11-10' },
    ),
  )
  assert.ok(added.some((edge) => edge.key === '2:3'))
  assert.ok(
    !graph.movedEdgeKeys(drawn, added).includes('2:3'),
    'a new edge enters through presence, not as a moved edge',
  )
})

// ---------------------------------------------------------------------------
// useTaskGraph on the real query store (audit A9)
// ---------------------------------------------------------------------------

const runtime = () => {
  const slots = [],
    pending = []
  let cursor = 0
  let subscription = null
  const same = (a, b) =>
    a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]))
  const memo = (fn, deps) => {
    const i = cursor++
    if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { deps, value: fn() }
    return slots[i].value
  }
  const react = {
    useState: (initial) => {
      const i = cursor++
      if (!(i in slots))
        slots[i] = { value: typeof initial === 'function' ? initial() : initial }
      const slot = slots[i]
      return [
        slot.value,
        (next) => {
          slot.value = typeof next === 'function' ? next(slot.value) : next
        },
      ]
    },
    useRef: (initial) => {
      const i = cursor++
      if (!(i in slots)) slots[i] = { current: initial }
      return slots[i]
    },
    useCallback: (fn, deps) => memo(() => fn, deps),
    useEffect: (fn, deps) => {
      const i = cursor++
      const old = slots[i]
      if (old && deps && same(old.deps, deps)) return
      slots[i] = { deps }
      pending.push(() => {
        old?.cleanup?.()
        slots[i].cleanup = fn()
      })
    },
    useSyncExternalStore: (subscribe, getSnapshot) => {
      if (subscription?.subscribe !== subscribe) {
        subscription?.off()
        subscription = { subscribe, off: subscribe(() => {}) }
      }
      return getSnapshot()
    },
  }
  const window = new EventTarget()
  const globals = { window, CustomEvent }
  const events = load('shared/utils/events.ts', {}, globals)
  const { createQueryStore } = load('shared/utils/queryStore.ts', {}, globals)
  const store = createQueryStore()
  const query = load(
    'shared/hooks/useRevalidatingQuery.ts',
    {
      react,
      '@shared/api/authTokens': {
        getAccessToken: () => 'token',
        getTokenSubject: () => 'member-1',
      },
      '@shared/utils/events': events,
      '@shared/utils/queryStore': { queryStore: store },
    },
    globals,
  )
  return {
    react,
    events,
    query,
    globals,
    async run(fn) {
      cursor = 0
      fn()
      while (pending.length) pending.shift()()
      await microtasks()
      cursor = 0
      return fn()
    },
  }
}

const graphHarness = () => {
  const r = runtime()
  const pages = []
  const scope = { selectedSpaceId: 4, selectedProjectId: null }
  const source = {
    openPage: (page, signal) => {
      const request = { page, signal, ...deferred() }
      pages.push(request)
      return request.promise
    },
    completedPage: async () => ({ items: [], hasNext: false, nextCursor: null }),
    detail: async (id) => task(id),
  }
  const graphData = load('features/task-map/graphData.ts')
  const { useTaskGraph, taskGraphKey } = load(
    'features/task-map/useTaskGraph.ts',
    {
      react: r.react,
      '@shared/hooks/useRevalidatingQuery': r.query,
      '@contexts/TimePreferencesContext': {
        useTimePreferences: () => ({ zoneId: 'Asia/Seoul' }),
      },
      '@features/spaces/store': { useSpaces: () => scope },
      './graphData': graphData,
      './graphApi': { taskGraphSource: source },
    },
    r.globals,
  )
  return {
    pages,
    scope,
    events: r.events,
    taskGraphKey,
    render: (includeCompleted = false) => r.run(() => useTaskGraph(includeCompleted)),
  }
}

test('a task change refreshes the map in place: the snapshot stays and progress is first-load only', async () => {
  const h = graphHarness()
  const first = await h.render()
  assert.equal(first.isLoading, true)
  assert.equal(first.data, null)
  h.pages[0].resolve({ content: [task(1), task(2)], last: false })
  await microtasks()
  const progress = await h.render()
  assert.equal(progress.isLoading, true)
  assert.equal(progress.count, 2, 'the first load reports how many tasks it has read')
  h.pages[1].resolve({ content: [task(3)], last: true })
  await microtasks()
  const loaded = await h.render()
  assert.equal(loaded.isLoading, false)
  assert.equal(loaded.data.tasks.length, 3)

  h.events.dispatchTaskChanged(3, 'state-mutated')
  h.events.dispatchScheduleChanged({ reason: 'task-state-mutated' })
  await coalesced()
  const refreshing = await h.render()
  assert.equal(h.pages.length, 3, 'one task and one schedule event refetch once')
  assert.equal(refreshing.isLoading, false, 'a refresh never swaps the map for the loading panel')
  assert.equal(refreshing.isRefreshing, true)
  assert.equal(refreshing.data, loaded.data, 'the snapshot on screen is kept')
  h.pages[2].resolve({ content: [task(1), task(2), task(3), task(4)], last: true })
  await microtasks()
  const refreshed = await h.render()
  assert.equal(refreshed.data.tasks.length, 4)
  assert.equal(refreshed.count, 3, 'a refresh does not report progress (4 would be the refresh)')
})

test('a failed refresh keeps the snapshot and passes the server message through', async () => {
  const h = graphHarness()
  await h.render()
  h.pages[0].resolve({ content: [task(1)], last: true })
  await microtasks()
  const loaded = await h.render()
  loaded.reload()
  await h.render()
  h.pages[1].reject(apiError('작업 목록을 불러오지 못했어요.', 500))
  await microtasks()
  const failed = await h.render()
  assert.equal(failed.error, '작업 목록을 불러오지 못했어요.')
  assert.equal(failed.data.tasks.length, 1)
  assert.equal(failed.isLoading, false)
})

test('another scope or completed toggle never shows this snapshot', async () => {
  const h = graphHarness()
  await h.render()
  h.pages[0].resolve({ content: [task(1)], last: true })
  await microtasks()
  assert.equal((await h.render()).data.tasks.length, 1)
  h.scope.selectedProjectId = 9
  const project = await h.render()
  assert.equal(project.data, null, 'a project filter is part of the key')
  assert.equal(project.isLoading, true)
  assert.notEqual(
    h.taskGraphKey(false, 'Asia/Seoul', 4, null),
    h.taskGraphKey(true, 'Asia/Seoul', 4, null),
  )
  assert.notEqual(
    h.taskGraphKey(false, 'Asia/Seoul', 4, null),
    h.taskGraphKey(false, 'Asia/Seoul', 5, null),
  )
  assert.notEqual(
    h.taskGraphKey(false, 'Asia/Seoul', 4, null),
    h.taskGraphKey(false, 'UTC', 4, null),
  )
})

// ---------------------------------------------------------------------------
// TaskMapPage wiring (audit C4 and the render rule)
// ---------------------------------------------------------------------------

const taskMapPage = (taskGraph) => {
  const surface = (open, path) => Object.assign(() => open(path), { path })
  const Page = load(
    'features/task-map/TaskMapPage.tsx',
    {
      react: React,
      'react/jsx-runtime': jsxRuntime,
      '@features/spaces/store': { useProjectFilter: () => ['all', () => {}] },
      'react-router-dom': {
        Link: ({ to, onClick, className, children }) =>
          React.createElement('a', { href: to, className, 'data-surface': onClick?.path }, children),
      },
      '@shared/components/common/Modal': { default: ({ children }) => React.createElement('div', null, children) },
      '@shared/components/common/StatusPanel': {
        default: ({ variant, title, description }) =>
          React.createElement('div', { 'data-panel': variant }, title, ' ', description),
      },
      '@shared/hooks/useCurrentDay': { default: () => ({ format: () => '2026-11-10' }) },
      '@shared/motion': {
        MOTION_BASE_MS: 0,
        MOTION_EASE: 'linear',
        MOTION_ENTER_MS: 0,
        presenceProps: () => ({}),
        prefersReducedMotion: () => true,
        useArrival: () => false,
        useListPresence: (items, getKey) =>
          (items ?? []).map((item) => ({ key: String(getKey(item)), item, phase: 'present' })),
        usePresence: (value) => ({ mounted: Boolean(value), closing: false, value }),
        useTweenedNumber: (value) => value,
      },
      '@shared/routing/RouteSurface': { useRouteSurfaceNavigation: () => ({ open() {} }) },
      '@shared/routing/linkClick': { surfaceLinkClick: surface },
      '@features/categories': {
        CategoryFilter: () => null,
        useCategories: () => ({ taskCategory: () => null, error: null, reload: async () => {} }),
      },
      './graph': graph,
      './useTaskGraph': { useTaskGraph: () => ({ count: 0, reload() {}, scopeKey: 'k', ...taskGraph }) },
      './TaskMapPage.css': {},
    },
    { window: { matchMedia: () => ({ matches: false }) } },
  ).default
  return renderToStaticMarkup(React.createElement(Page))
}
const snapshot = { tasks: [task(1), task(2, { previousTaskIds: [1], inboundDependencyCount: 1 })], unavailableIds: [] }

test('task map links to task surfaces open them over the map instead of swapping the page', () => {
  const html = taskMapPage({ data: snapshot, isLoading: false, isRefreshing: false, error: null })
  const links = [...html.matchAll(/<a href="(\/app\/tasks\/[^"]+)"[^>]*?(?:data-surface="([^"]*)")?>/g)]
  assert.ok(links.some(([, href]) => href === '/app/tasks/new'))
  assert.ok(links.some(([, href]) => href === '/app/tasks/1'))
  assert.ok(links.length >= 3)
  for (const [, href, surface] of links) assert.equal(surface, href, `${href} opens as a surface`)
})

test('task map shows loading only without a snapshot and keeps the map through errors', () => {
  assert.match(
    taskMapPage({ data: null, isLoading: true, isRefreshing: false, error: null }),
    /data-panel="loading"/,
  )
  const failedRefresh = taskMapPage({ data: snapshot, isLoading: false, isRefreshing: false, error: '작업 맵을 새로 불러오지 못했어요.' })
  assert.doesNotMatch(failedRefresh, /data-panel="error"/, 'the error panel only replaces an empty map')
  assert.match(failedRefresh, /class="tm-warning tm-refresh-error" role="alert">작업 맵을 새로 불러오지 못했어요\./)
  assert.match(failedRefresh, /Task 1/)
  assert.match(
    taskMapPage({ data: null, isLoading: false, isRefreshing: false, error: '작업 맵을 불러오지 못했어요.' }),
    /data-panel="error"/,
  )
  assert.match(
    taskMapPage({ data: snapshot, isLoading: false, isRefreshing: true, error: null }),
    /class="tm-content" aria-busy="true"/,
  )
})

// ---------------------------------------------------------------------------
// Deadline risk rows (audit A10)
// ---------------------------------------------------------------------------

test('deadline risk rows carry their presence phase and minutes render through the tween', () => {
  const tweened = []
  const Item = load('features/deadline-risk/components/DeadlineRiskItem.tsx', {
    'react/jsx-runtime': jsxRuntime,
    'react-router-dom': {
      Link: ({ to, children }) => React.createElement('a', { href: to }, children),
      useLocation: () => ({ pathname: '/app/deadline-risk' }),
    },
    '@shared/motion': {
      useTweenedNumber: (value) => {
        tweened.push(value)
        return value + 0.4
      },
    },
    '@shared/utils/isoDuration': load('shared/utils/isoDuration.ts'),
    '../utils/deadlineRiskView': load('features/deadline-risk/utils/deadlineRiskView.ts'),
  }).default
  const item = {
    taskId: 41,
    title: '금요일 제출',
    deadline: '2026-11-13T15:00:00Z',
    status: 'SHORTAGE',
    requiredMinutes: 300,
    availableMinutes: 120,
    shortageMinutes: 180,
    predecessorTaskIds: [],
    reasons: [],
    suggestedFinish: null,
    recurrenceSeriesId: null,
  }
  const html = renderToStaticMarkup(
    React.createElement(Item, {
      item,
      zoneId: 'Asia/Seoul',
      canOpenPlan: true,
      onOpenPlan() {},
      presence: { 'data-presence': 'enter' },
    }),
  )
  assert.match(html, /<li class="deadline-risk__item deadline-risk__item--shortage" data-presence="enter">/)
  assert.deepEqual(tweened, [300, 120, 180])
  for (const text of ['5시간', '2시간', '3시간']) assert.ok(html.includes(text), text)
})

// ---------------------------------------------------------------------------
// Motion rules for this area's CSS
// ---------------------------------------------------------------------------

// CSS is only readable as text here; the rules apply to every transition in these files.
test('task map and deadline risk CSS animate only allowed properties with the tokens', () => {
  const allowed = new Set([
    'transform',
    'opacity',
    'color',
    'background-color',
    'border-color',
    'stroke',
  ])
  for (const path of [
    'features/task-map/TaskMapPage.css',
    'features/deadline-risk/pages/DeadlineRiskPage.css',
  ]) {
    const css = read(path)
    assert.doesNotMatch(css, /transition:\s*all/, path)
    assert.doesNotMatch(css, /@keyframes/, `${path} uses the shared keyframes`)
    assert.doesNotMatch(css, /infinite/, path)
    for (const [, value] of css.matchAll(/transition:\s*([^;]+);/g)) {
      if (value.trim() === 'none') continue
      for (const part of value.split(',')) {
        const [property, duration] = part.trim().split(/\s+/)
        assert.ok(allowed.has(property), `${path}: ${property} is not animatable here`)
        assert.match(duration, /^var\(--motion-/, `${path}: ${part.trim()} uses a token`)
      }
    }
  }
})
