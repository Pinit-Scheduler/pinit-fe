import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const load = (path, dependencies) => {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  })
  const module = { exports: {} }
  vm.runInNewContext(outputText, {
    module,
    exports: module.exports,
    Error,
    require: (name) => {
      assert.ok(name in dependencies, `Unexpected dependency ${name}`)
      return dependencies[name]
    },
  })
  return module.exports
}

test('a loaded actor-specific category snapshot survives background fetch failure and resets for a new session', async () => {
  let fail = false
  const snapshot = {
    categories: [{ id: 7, name: 'work', builtIn: false }],
    taskAssignments: { 9: 7 },
    scheduleAssignments: { 9: 7 },
  }
  const store = load('../src/features/categories/store.ts', {
    react: { useEffect() {}, useSyncExternalStore: (_subscribe, get) => get() },
    '@shared/api/config': { buildApiUrl: (path) => path },
    '@shared/api/httpClient': {
      httpClient: async () => {
        if (fail) throw new Error('refresh failed')
        return snapshot
      },
    },
    '@shared/api/authTokens': { getAccessToken: () => 'actor-1' },
    '@shared/utils/events': {
      onTaskChanged: () => () => {},
      onScheduleChanged: () => () => {},
    },
  })
  assert.equal(store.useCategories().hasLoaded, false)
  await store.reloadCategories()
  assert.equal(store.useCategories().hasLoaded, true)
  assert.equal(store.useCategories().scheduleCategory(9).id, 7)
  fail = true
  await assert.rejects(store.reloadCategories(), /refresh failed/)
  const stale = store.useCategories()
  assert.equal(stale.hasLoaded, true)
  assert.equal(stale.error, 'refresh failed')
  assert.equal(stale.scheduleCategory(9).id, 7)
  store.resetCategories()
  assert.equal(store.useCategories().hasLoaded, false)
  assert.equal(store.useCategories().scheduleCategory(9), null)
})

test('background category failure does not remove the task form; initial lookup failure still blocks unsafe defaults', () => {
  let category = { isLoading: false, hasLoaded: true, error: null }
  const TaskForm = () => null
  const task = {
    id: 9,
    title: 'original',
    description: 'details',
    difficulty: 2,
    importance: 5,
    tags: [],
    dueDate: { date: '2026-11-03' },
  }
  let index = 0
  const values = [task, null, false, [], []]
  const module = load('../src/features/tasks/pages/TaskEditPage.tsx', {
    'react/jsx-runtime': {
      jsx: (type, props, key) => ({ type, props, key }),
      jsxs: (type, props, key) => ({ type, props, key }),
      Fragment: 'fragment',
    },
    react: {
      useEffect() {},
      useState: (initial) => [
        index < values.length ? values[index++] : initial,
        () => {},
      ],
      useRef: () => ({ current: null }),
    },
    'react-router-dom': { useParams: () => ({ taskId: '9' }) },
    '@shared/routing/RouteSurface': {
      useRouteSurfaceNavigation: () => ({ complete() {} }),
    },
    '@features/categories': {
      useCategories: () => ({
        ...category,
        taskCategory: () => ({ id: 7 }),
        reload: async () => {},
      }),
    },
    '../components/TaskForm': { default: TaskForm },
    '../api/tasks': {},
    '@shared/utils/datetime': {
      toDayjsFromDateWithOffset: () => ({ format: () => '2026-11-03' }),
    },
    '@contexts/TaskCacheContext': { useTaskCache: () => ({ setTask() {} }) },
    '@contexts/ToastContext': { useToast: () => ({ addToast() {} }) },
    '@shared/utils/events': {},
    '@shared/utils/isoDuration': {
      parseIsoDurationMinutes: () => null,
      formatIsoDurationLabel: () => null,
    },
    './TaskPages.css': {},
    '@features/recurrence/components/RecurrenceScopeDialog': {
      useRecurrenceScope: () => ({ dialog: null }),
    },
    '@features/recurrence/utils/seriesMutations': {},
    '@features/recurrence/utils/recurrenceRules': {},
  })
  const find = (node) => {
    if (!node || typeof node !== 'object') return null
    if (node.type === TaskForm) return node
    const children = node.props?.children
    for (const child of Array.isArray(children) ? children : [children]) {
      const result = find(child)
      if (result) return result
    }
    return null
  }
  const render = () => {
    index = 0
    return find(module.default())
  }
  const original = render()
  assert.ok(original)
  category = { isLoading: false, hasLoaded: true, error: 'background failure' }
  const failedRefresh = render()
  assert.ok(failedRefresh)
  assert.equal(failedRefresh.type, original.type)
  assert.equal(failedRefresh.key, original.key)
  assert.equal(failedRefresh.props.initialValues.categoryId, 7)
  category = { isLoading: false, hasLoaded: false, error: 'initial failure' }
  assert.equal(render(), null)
})
