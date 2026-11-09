import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'

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
    require: (name) => {
      assert.ok(name in dependencies, 'Unexpected dependency ' + name)
      return dependencies[name]
    },
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
  const { isCompletionOnly, COMPLETION_SETTLE_MS } = load(
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
  // Long enough for the strike (80ms delay + enter) to finish, short enough to feel immediate.
  assert.ok(COMPLETION_SETTLE_MS >= 80 + 240 && COMPLETION_SETTLE_MS <= 800)
})

test('TaskListPage reads project assignments at render, not in the request', () => {
  const page = src('features/tasks/pages/TaskListPage.tsx')
  const fetcher = page.slice(
    page.indexOf('useRevalidatingQuery<TaskListData>('),
    page.indexOf('{ errorMessage: errorText }'),
  )
  assert.ok(fetcher.length > 0)
  assert.doesNotMatch(fetcher, /taskAssignments/, 'a category reload must not re-create the request')
  assert.match(page, /useListPresence\(visible/)
  assert.doesNotMatch(page, /setLoading\(true\)/)
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

test('the task detail seeds from the cache and never swaps shown content for the loading line', () => {
  const modal = src('features/tasks/components/TaskDetailModal.tsx')
  assert.match(modal, /const isLoading = !task && !error/)
  assert.doesNotMatch(modal, /setIsLoading\(true\)/)
  assert.match(modal, /<CompletionCheck/)
  assert.match(modal, /className="motion-strike"/)
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
  const render = hookRunner('features/tasks/utils/useArrival.ts')
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

test('task and category modals play their exit instead of unmounting at once', () => {
  for (const path of [
    'features/tasks/components/TaskScheduleModal.tsx',
    'features/tasks/components/modals/TaskDependencyModal.tsx',
    'features/tasks/components/modals/TaskArchiveModal.tsx',
    'features/tasks/components/modals/TagManagerModal.tsx',
    'features/categories/components.tsx',
  ]) {
    const source = src(path)
    assert.match(source, /usePresence\(/, path)
    assert.match(source, /closing=\{/, path)
    assert.doesNotMatch(source, /if \(!isOpen\) return null/, path)
  }
  const list = src('features/tasks/pages/TaskListPage.tsx')
  assert.doesNotMatch(list, /archiveOpen &&|managerOpen &&/)
})

test('a list refresh keeps pages that "more" added meanwhile, and shows a failed refresh over an empty result', () => {
  const page = src('features/tasks/pages/TaskListPage.tsx')
  // Page counts belong to a key, and the refresh reads pages that landed while it ran.
  assert.match(page, /pagesShown\.current\.key === key/)
  assert.match(page, /responses\.length < shown\(\)/)
  assert.match(page, /pagesShown\.current = \{ key, pages: page \+ 1 \}/)
  // The inline refresh error is not tied to the non-empty branch.
  assert.match(page, /\{error && visible !== undefined && \(/)
})

test('task modals show neither an empty result on opening nor a blank label while fading', () => {
  const picker = src('features/tasks/components/modals/TaskDependencyModal.tsx')
  assert.match(picker, /const \[loading, setLoading\] = useState\(true\)/)
  const archive = src('features/tasks/components/modals/TaskArchiveModal.tsx')
  assert.match(archive, /\) : !initialLoaded \? \(/)
  // A later page that fails keeps the rows already read.
  assert.match(archive, /\{error && tasks\.length === 0 \? \(/)
  const schedule = src('features/tasks/components/TaskScheduleModal.tsx')
  assert.match(schedule, /if \(isOpen && shownLabel !== taskLabel\) setShownLabel\(taskLabel\)/)
  assert.match(schedule, /\{shownLabel \?\? '작업'\}/)
})
