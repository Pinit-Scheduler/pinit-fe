import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'
import { createRequire } from 'node:module'
import React from 'react'
import * as jsxRuntime from 'react/jsx-runtime'
import { renderToStaticMarkup } from 'react-dom/server'
import { requireFrom } from './support/errors.mjs'

const nodeRequire = createRequire(import.meta.url)

const plain = (value) => JSON.parse(JSON.stringify(value))
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  await new Promise((resolve) => setImmediate(resolve))
}
const src = (path) => readFileSync(new URL('../src/' + path, import.meta.url), 'utf8')

function load(path, dependencies = {}, globals = {}) {
  const output = ts.transpileModule(src(path), {
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
    Error,
    JSON,
    Promise,
    require: requireFrom(dependencies),
    ...globals,
  })
  return module.exports
}

// ---------------------------------------------------------------------------
// Categories store (audit B4): the snapshot survives a page change
// ---------------------------------------------------------------------------

const categoryHarness = () => {
  const calls = []
  let respond = () => ({
    projects: [{ id: 7, name: 'work', spaceId: 1 }],
    taskAssignments: { 9: 7 },
    scheduleAssignments: {},
  })
  const window = new EventTarget()
  const effects = []
  let mounting = false
  // mount() runs a consumer's effects at once and keeps their cleanups. read() only renders.
  const react = {
    useSyncExternalStore: (subscribe, get) => get(),
    useEffect(effect) {
      if (mounting) effects.push(effect() ?? null)
    },
  }
  const store = load(
    'features/categories/store.ts',
    {
      react,
      '@shared/api/config': { buildApiUrl: (path) => path },
      '@shared/api/httpClient': {
        httpClient: async (url) => {
          calls.push(url)
          return respond()
        },
      },
      '@shared/api/authTokens': { getAccessToken: () => 'actor-1' },
      '@features/spaces/metadata': {},
      '@shared/utils/events': { onDataChanged: () => () => {} },
      '@shared/utils/sameData': load('shared/utils/sameData.ts'),
    },
    { window },
  )
  const mount = () => {
    const from = effects.length
    mounting = true
    const state = store.useCategories()
    mounting = false
    const cleanups = effects.slice(from)
    return { state, unmount: () => cleanups.forEach((cleanup) => cleanup?.()) }
  }
  return {
    store,
    calls,
    mount,
    read: () => store.useCategories(),
    setResponse: (next) => {
      respond = next
    },
  }
}

test('categories keep their snapshot when the last consumer unmounts, and revalidate quietly on return', async () => {
  const h = categoryHarness()
  const first = h.mount()
  await flush()
  assert.equal(h.calls.length, 1)
  assert.equal(h.read().taskCategory(9).id, 7)
  first.unmount()
  // Leaving the Tasks screen used to reset the store, so chips and filters blanked on return.
  const kept = h.read()
  assert.equal(kept.hasLoaded, true)
  assert.equal(kept.isLoading, false)
  assert.equal(kept.taskCategory(9).id, 7)

  h.setResponse(() => ({
    projects: [{ id: 7, name: 'work', spaceId: 1 }],
    taskAssignments: { 9: 7, 10: 7 },
    scheduleAssignments: {},
  }))
  const second = h.mount()
  assert.equal(second.state.hasLoaded, true, 'the kept snapshot shows on the first frame')
  assert.equal(second.state.taskCategory(9).id, 7)
  await flush()
  assert.equal(h.calls.length, 2, 'missed changes are fetched in the background')
  assert.equal(h.read().taskCategory(10).id, 7)
  second.unmount()
})

test('a category reload with the same content keeps the same objects, so list filters do not re-run', async () => {
  const h = categoryHarness()
  const consumer = h.mount()
  await flush()
  const before = h.read()
  await h.store.reloadCategories()
  const after = h.read()
  assert.equal(after.taskAssignments, before.taskAssignments)
  assert.equal(after.categories, before.categories)
  h.setResponse(() => ({
    projects: [{ id: 7, name: 'work', spaceId: 1 }],
    taskAssignments: { 9: 8 },
    scheduleAssignments: {},
  }))
  await h.store.reloadCategories()
  const changed = h.read()
  assert.notEqual(changed.taskAssignments, before.taskAssignments)
  assert.equal(changed.categories, before.categories, 'unchanged parts keep their identity')
  consumer.unmount()
})

// ---------------------------------------------------------------------------
// TaskListPage refresh policy
// ---------------------------------------------------------------------------

test('a completion waits for its motion before the task list refreshes; other changes refresh at once', () => {
  const { isCompletionOnly } = load(
    'features/tasks/utils/taskListRefresh.ts',
  )
  // WorkspaceTaskCard: one task event and one schedule event per toggle.
  assert.equal(
    isCompletionOnly({
      tasks: [{ taskId: 4, reason: 'state-mutated' }],
      schedules: [{ reason: 'task-state-mutated' }],
    }),
    true,
  )
  // TaskDetailModal toggle.
  assert.equal(isCompletionOnly({ tasks: [{ taskId: 4, reason: 'reopen' }], schedules: [] }), true)
  for (const batch of [
    { tasks: [{ taskId: 4, reason: 'create' }], schedules: [] },
    { tasks: [{ reason: 'space-scope' }], schedules: [{ reason: 'space-scope' }] },
    { tasks: [{ taskId: 4, reason: 'state-mutated' }], schedules: [{ reason: 'created' }] },
    { tasks: [], schedules: [{ reason: 'task-state-mutated' }] },
  ])
    assert.equal(isCompletionOnly(batch), false, JSON.stringify(batch))
})

test('a list refresh re-reads the pages on screen, including one "more" added while it ran', async () => {
  const { readShownPages } = load('features/tasks/utils/taskListRefresh.ts')
  let shown = 1
  const reads = []
  const read = async (page) => {
    reads.push(page)
    // "More" lands while the refresh waits for its first page.
    if (page === 0) shown = 2
    return { page, last: page >= 3 }
  }
  const pages = await readShownPages(read, () => shown, (response) => response.last)
  assert.deepEqual(plain(pages.map((response) => response.page)), [0, 1])
  assert.deepEqual(reads, [0, 1])
  shown = 2
  const capped = await readShownPages(
    async (page) => {
      if (page === 0) shown = 5
      return { page, last: page === 2 }
    },
    () => shown,
    (response) => response.last,
  )
  assert.equal(capped.length, 3, 'never reads past the last page')
})

const taskListPage = ({ query, taskAssignments = {}, category = 'all' }) => {
  const queries = []
  const modals = []
  const Page = load(
    'features/tasks/pages/TaskListPage.tsx',
    {
      react: React,
      'react/jsx-runtime': jsxRuntime,
      '@features/spaces/store': {
        useProjectFilter: () => [category, () => {}],
        useSpaces: () => ({ selectedSpaceId: 22 }),
      },
      '../api/tasks': { searchTasks: () => new Promise(() => {}) },
      '@contexts/TaskCacheContext': { useTaskCache: () => ({ setTask() {} }) },
      '@shared/utils/datetime': { getTodayWithOffset: () => ({ format: () => '2026-11-10' }) },
      '@contexts/TimePreferencesContext': { useTimePreferences: () => ({ offsetMinutes: 540 }) },
      '@shared/utils/events': { onDataChanged: () => () => {} },
      '@shared/hooks/useRevalidatingQuery': {
        useRevalidatingQuery: (key, fetcher) => {
          queries.push(key)
          return { isRefreshing: false, refetch() {}, setData() {}, ...query }
        },
      },
      '@shared/motion': {
        arrivalIndex: (index) => index,
        COMPLETION_HOLD_MS: 0,
        presenceProps: () => ({}),
        useArrival: () => false,
        useListPresence: (items, getKey) =>
          (items ?? []).map((item) => ({ key: String(getKey(item)), item, phase: 'present' })),
        usePresence: (value) => ({ mounted: Boolean(value), closing: false, value }),
        useTweenedNumber: (value) => value,
      },
      '@shared/routing/RouteSurface': { useRouteSurfaceNavigation: () => ({ open() {} }) },
      '@features/categories': {
        CategoryFilter: () => null,
        CategoryManager: (props) => (modals.push(['manager', props.open]), null),
        useCategories: () => ({ taskAssignments, hasLoaded: true, error: null }),
      },
      '../components/WorkspaceTaskCard': { default: ({ task }) => React.createElement('p', null, task.title) },
      '../components/modals/TaskArchiveModal': { default: (props) => (modals.push(['archive', props.open]), null) },
      '../components/TaskFilterPanel': { default: () => null },
      '../utils/taskSearch': load('features/tasks/utils/taskSearch.ts'),
      '../utils/taskListRefresh': load('features/tasks/utils/taskListRefresh.ts'),
      './TaskPages.css': {},
    },
    { sessionStorage: { getItem: () => null, setItem() {} } },
  ).default
  const html = renderToStaticMarkup(React.createElement(Page))
  return { html, key: queries[0], modals }
}

test('the task list shows a failed refresh over an empty result and keeps its modals mounted closed', () => {
  const { html, modals } = taskListPage({
    query: { data: { tasks: [], total: 0, pages: 1, hasMore: false }, error: '작업을 새로 불러오지 못했어요.' },
  })
  assert.match(html, /role="alert"><p>작업을 새로 불러오지 못했어요\.<\/p>/)
  assert.match(html, /등록된 작업이 없습니다/, 'the empty result stays under the error')
  assert.deepEqual(modals, [['archive', false], ['manager', false]], 'closed modals stay mounted, so they can fade out')
})

test('a project reload never re-creates the task list request', () => {
  const data = { tasks: [{ id: 1, title: '작업 1' }], total: 1, pages: 1, hasMore: false }
  const before = taskListPage({ query: { data, error: null }, category: 7, taskAssignments: {} })
  const after = taskListPage({ query: { data, error: null }, category: 7, taskAssignments: { 1: 7 } })
  assert.equal(after.key, before.key, 'assignments are applied at render, not in the request')
  assert.doesNotMatch(before.html, /작업 1/)
  assert.match(after.html, /작업 1/)
})

// ---------------------------------------------------------------------------
// TaskDetailModal (audit A6)
// ---------------------------------------------------------------------------

test('the task detail ignores its own toggle echo and unrelated tasks, but follows linked ones', () => {
  const { detailRefreshNeeded } = load('features/tasks/utils/taskDetailRefresh.ts')
  // Its own completion: no refetch, the echo is consumed.
  assert.deepEqual(plain(detailRefreshNeeded([{ taskId: 5, reason: 'complete' }], 5, [], 1)), {
    refetch: false,
    ownToggles: 0,
  })
  // A second, unexpected complete of the same task still refetches.
  assert.deepEqual(plain(detailRefreshNeeded([{ taskId: 5, reason: 'complete' }], 5, [], 0)), {
    refetch: true,
    ownToggles: 0,
  })
  assert.equal(detailRefreshNeeded([{ taskId: 6, reason: 'state-mutated' }], 5, [], 0).refetch, false)
  assert.equal(detailRefreshNeeded([{ taskId: 6, reason: 'state-mutated' }], 5, [6], 0).refetch, true)
  assert.equal(detailRefreshNeeded([{ reason: 'space-scope' }], 5, [], 0).refetch, true)
  assert.equal(detailRefreshNeeded([{ taskId: 5, reason: 'update' }], 5, [], 2).refetch, true)
  // Its own delete closes the surface: no read that could only answer 404 during the exit.
  assert.equal(detailRefreshNeeded([{ taskId: 5, reason: 'delete' }], 5, [], 0).refetch, false)
  assert.equal(
    detailRefreshNeeded([{ taskId: 5, reason: 'delete' }, { reason: 'space' }], 5, [], 0).refetch,
    true,
  )
})

// ---------------------------------------------------------------------------
// useArrival: entrances only for content the screen waited for
// ---------------------------------------------------------------------------

const hookRunner = (path) => {
  let slots = []
  let index = 0
  let dirty = false
  const react = {
    useState(initial) {
      const i = index++
      if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial
      return [
        slots[i],
        (next) => {
          slots[i] = typeof next === 'function' ? next(slots[i]) : next
          dirty = true
        },
      ]
    },
  }
  const module = load(path, { react })
  return (...args) => {
    let result
    let guard = 0
    do {
      dirty = false
      index = 0
      result = module.useArrival(...args)
      assert.ok(guard++ < 5, 'render loop')
    } while (dirty)
    return result
  }
}

test('useArrival marks content as arriving only after this screen waited for its key', () => {
  const render = hookRunner('shared/motion/useArrival.ts')
  assert.equal(render(false, 'cached'), false, 'cached content on mount does not replay an entrance')
  assert.equal(render(true, 'sorted'), false)
  assert.equal(render(false, 'sorted'), true, 'the new sort arrives once loaded')
  assert.equal(render(false, 'sorted'), true, 'and stays marked, so re-renders do not restart it')
  assert.equal(render(false, 'other'), false, 'a cached key switched to at once does not arrive')
})

// ---------------------------------------------------------------------------
// Static checks for the tasks and categories areas
// ---------------------------------------------------------------------------

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })
const areaFiles = ['features/tasks', 'features/categories'].flatMap((dir) =>
  walk(fileURLToPath(new URL('../src/' + dir, import.meta.url))),
)

// CSS is only readable as text here; the rules apply to every rule in these areas.
test('tasks and categories CSS name their transitions and define no keyframes', () => {
  for (const file of areaFiles.filter((path) => path.endsWith('.css'))) {
    const css = readFileSync(file, 'utf8')
    assert.doesNotMatch(css, /transition:\s*all/, file)
    assert.doesNotMatch(css, /@keyframes/, file)
    assert.doesNotMatch(css, /infinite/, file)
    assert.doesNotMatch(css, /transition:[^;]*\b(width|height|top|left|margin)\b/, file)
  }
  const pages = src('features/tasks/pages/TaskPages.css')
  const list = pages.match(/\.task-page__list\s*\{[^}]*\}/g) ?? []
  assert.ok(list.length > 0)
  for (const rule of list) assert.doesNotMatch(rule, /animation/, 'list containers never animate on mount')
  const root = pages.match(/^\.task-page\s*\{[^}]*\}/m)?.[0] ?? ''
  assert.doesNotMatch(root, /animation/, 'the page root never animates on mount')
})

const modalDeps = (presence) => ({
  react: React,
  'react/jsx-runtime': jsxRuntime,
  '@shared/components/common/WorkspaceIcon': { default: () => null },
  '@shared/components/common/Modal': {
    default: ({ closing, children }) =>
      React.createElement('div', { role: 'dialog', 'data-closing': String(closing) }, children),
  },
  '@shared/motion': {
    arrivalIndex: (index) => index,
    useArrival: () => false,
    usePresence: (value) => presence ?? { mounted: Boolean(value), closing: false, value },
  },
})

test('task pickers open on a loading line, never on an empty result', () => {
  const Dependency = load('features/tasks/components/modals/TaskDependencyModal.tsx', {
    ...modalDeps(),
    './TaskDependencyModal.css': {},
    '../../api/tasks': { searchTasks: () => new Promise(() => {}) },
    '../../utils/taskSearch': load('features/tasks/utils/taskSearch.ts'),
  }).default
  const picker = renderToStaticMarkup(
    React.createElement(Dependency, { isOpen: true, onClose() {}, selectedIds: [], onApply() {}, title: '이전 작업' }),
  )
  assert.match(picker, /role="status">불러오는 중\.\.\./)
  assert.doesNotMatch(picker, /작업이 없습니다/)

  const Archive = load('features/tasks/components/modals/TaskArchiveModal.tsx', {
    ...modalDeps(),
    './TaskArchiveModal.css': {},
    '../../api/tasks': { fetchTaskArchiveByCursor: () => new Promise(() => {}) },
    '@shared/utils/datetime': { formatDateWithOffset: () => '' },
    '@shared/utils/deadlineStyles': { getDeadlineStyle: () => ({}) },
    '@shared/utils/priorityStyles': { getDifficultyStyle: () => ({}), getImportanceStyle: () => ({}) },
  }).default
  const archive = renderToStaticMarkup(React.createElement(Archive, { onClose() {} }))
  assert.match(archive, /불러오는 중\.\.\./)
  assert.doesNotMatch(archive, /아카이브된 작업이 없습니다/)
})

test('task modals hand their exit to the modal and keep naming the task while they fade', () => {
  const closing = { mounted: true, closing: true }
  const Dependency = load('features/tasks/components/modals/TaskDependencyModal.tsx', {
    ...modalDeps(closing),
    './TaskDependencyModal.css': {},
    '../../api/tasks': { searchTasks: () => new Promise(() => {}) },
    '../../utils/taskSearch': load('features/tasks/utils/taskSearch.ts'),
  }).default
  assert.match(
    renderToStaticMarkup(
      React.createElement(Dependency, { isOpen: false, onClose() {}, selectedIds: [], onApply() {}, title: '이전 작업' }),
    ),
    /data-closing="true"/,
  )

  // The opener clears the task as the exit starts; a fake hook runtime renders the same instance twice.
  const slots = []
  let index = 0
  const hooks = {
    useId: () => 'id',
    useRef: (initial) => {
      const i = index++
      if (!(i in slots)) slots[i] = { current: initial }
      return slots[i]
    },
    useState: (initial) => {
      const i = index++
      if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial
      return [slots[i], (next) => { slots[i] = typeof next === 'function' ? next(slots[i]) : next }]
    },
    useEffect() {},
  }
  const jsx = (type, props) => ({ type, props })
  const Schedule = load('features/tasks/components/TaskScheduleModal.tsx', {
    react: hooks,
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'fragment' },
    '@shared/components/common/WorkspaceIcon': { default: () => null },
    '@shared/components/common/Modal': { default: () => null },
    '@shared/motion': { usePresence: (open) => (open ? { mounted: true, closing: false } : closing) },
    dayjs: { default: nodeRequire('dayjs') },
    './TaskScheduleModal.css': {},
    '@shared/utils/datetime': { toApiDateTimeWithZone: (date) => date },
    '@features/spaces/conflicts': { CONFLICT_RELOADED: '', isEditConflict: () => false },
  }).default
  const heading = (props) => {
    index = 0
    const nodes = []
    const walk = (node) => {
      if (Array.isArray(node)) return node.forEach(walk)
      if (!node || typeof node !== 'object') return
      nodes.push(node)
      walk(node.props?.children)
    }
    const root = Schedule({ onClose() {}, onSubmit: async () => {}, ...props })
    walk(root)
    return { closing: root.props.closing, text: nodes.find((node) => node.type === 'h1').props.children }
  }
  assert.deepEqual(heading({ isOpen: true, taskLabel: '보고서 쓰기' }), { closing: false, text: '보고서 쓰기' })
  assert.deepEqual(heading({ isOpen: false, taskLabel: undefined }), { closing: true, text: '보고서 쓰기' })
})
