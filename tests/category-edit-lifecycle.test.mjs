import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const jsx = (type, props, key) => ({ type, props, key })
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
    console: { error() {} },
    require: (name) => {
      assert.ok(name in dependencies, `Unexpected dependency ${name}`)
      return dependencies[name]
    },
  })
  return module.exports
}
const find = (node, type) => {
  if (!node || typeof node !== 'object') return null
  if (node.type === type) return node
  const children = node.props?.children
  for (const child of Array.isArray(children) ? children : [children]) {
    const result = find(child, type)
    if (result) return result
  }
  return null
}
const createHooks = (seed = []) => {
  let cursor = 0
  const states = [...seed]
  return {
    begin() {
      cursor = 0
    },
    react: {
      useId: () => 'form-id',
      useEffect() {},
      useMemo: (fn) => fn(),
      useState(initial) {
        const index = cursor++
        if (!(index in states))
          states[index] = typeof initial === 'function' ? initial() : initial
        return [
          states[index],
          (value) => {
            states[index] =
              typeof value === 'function' ? value(states[index]) : value
          },
        ]
      },
      useRef(initial) {
        const index = cursor++
        if (!(index in states)) states[index] = { current: initial }
        return states[index]
      },
    },
  }
}

for (const kind of ['task', 'schedule']) {
  test(`${kind} form compares categories to its mount snapshot, even after background data changes`, async () => {
    const hooks = createHooks()
    const CategoryPicker = () => null
    const submitted = []
    const day = {
      startOf() {
        return this
      },
      add() {
        return this
      },
      format: () => '2026-11-03',
      utc() {
        return this
      },
      utcOffset() {
        return this
      },
    }
    let scheduleValues = {
      title: 'draft',
      description: 'details',
      categoryId: 7,
      date: new Date(),
      scheduleType: 'DEEP_WORK',
    }
    const dependencies = {
      'react/jsx-runtime': { jsx, jsxs: jsx },
      react: hooks.react,
      '@shared/components/common/WorkspaceIcon': { default: () => null },
      '@shared/routing/RouteSurface': {
        useRouteSurfaceNavigation: () => ({ markDirty() {}, close() {} }),
        RouteSurfaceActions: () => null,
      },
      '@contexts/TimePreferencesContext': {
        useTimePreferences: () => ({ offsetMinutes: 540 }),
      },
      '@features/categories': { CategoryPicker },
      '@shared/utils/datetime': {
        getTodayWithOffset: () => day,
        toDateKey: () => '2026-11-03',
      },
      '@shared/utils/isoDuration': {
        parseDurationInput: () => ({ kind: 'empty' }),
      },
      '@features/recurrence/components/RecurrenceRuleFields': {
        default: () => null,
      },
      '@features/recurrence/utils/recurrenceRules': {},
      '@constants/difficulty': { FIBONACCI_DIFFICULTIES: [1, 2, 3] },
      '@shared/utils/taskEstimate': { DIFFICULTY_ESTIMATE_MINUTES: { 2: 30 } },
      './TaskForm.css': {},
      './modals/TaskDependencyModal': { default: () => null },
      dayjs: { default: () => day },
      './ScheduleForm.css': {},
      '../hooks/useScheduleForm': {
        default: () => ({
          values: scheduleValues,
          errors: {},
          validate: () => true,
          setSubmitting() {},
          reset() {},
          onChange: (key, value) => {
            scheduleValues = { ...scheduleValues, [key]: value }
          },
        }),
      },
    }
    const path =
      kind === 'task'
        ? '../src/features/tasks/components/TaskForm.tsx'
        : '../src/features/schedules/components/ScheduleForm.tsx'
    const Form = load(path, dependencies).default
    let initialValues = {
      title: 'draft',
      description: 'details',
      categoryId: 7,
    }
    const render = () => {
      hooks.begin()
      return Form({
        initialValues,
        onSubmit: async (values) => {
          submitted.push(values)
          return false
        },
      })
    }
    render()
    initialValues = { ...initialValues, categoryId: 8 }
    let tree = render()
    await tree.props.onSubmit({ preventDefault() {} })
    assert.equal(submitted.at(-1).categoryId, 7)
    assert.equal(submitted.at(-1).categoryChanged, false)
    tree = render()
    find(tree, CategoryPicker).props.onChange(8)
    tree = render()
    await tree.props.onSubmit({ preventDefault() {} })
    assert.equal(submitted.at(-1).categoryId, 8)
    assert.equal(submitted.at(-1).categoryChanged, true)
    tree = render()
    find(tree, CategoryPicker).props.onChange(7)
    tree = render()
    await tree.props.onSubmit({ preventDefault() {} })
    assert.equal(submitted.at(-1).categoryChanged, false)
  })
}

const createTaskEdit = ({ recurring = false } = {}) => {
  const task = {
    id: 9,
    title: 'original',
    description: 'details',
    dueDate: '2026-11-03',
    importance: 5,
    difficulty: 2,
    tags: [],
    ...(recurring
      ? { recurrence: { seriesId: 4, occurrenceDate: '2026-11-03' } }
      : {}),
  }
  const hooks = createHooks([task, null, false, [], []])
  const TaskForm = () => null
  const saved = [],
    assigned = [],
    events = [],
    toasts = [],
    exits = [],
    seriesAssigned = []
  let categoryId = 7,
    failCategory = false,
    failContent = false
  const Form = load('../src/features/tasks/pages/TaskEditPage.tsx', {
    'react/jsx-runtime': { jsx, jsxs: jsx },
    react: hooks.react,
    'react-router-dom': { useParams: () => ({ taskId: '9' }) },
    '@shared/routing/RouteSurface': {
      useRouteSurfaceNavigation: () => ({
        complete: (path) => exits.push(path),
      }),
    },
    '@features/categories': {
      useCategories: () => ({
        taskCategory: () => ({ id: categoryId }),
        isLoading: false,
        hasLoaded: true,
        error: null,
        reload: async () => {},
      }),
      assignTaskCategory: async (...args) => {
        if (failCategory) throw new Error('category failed')
        assigned.push(args)
      },
      assignSeriesCategory: async (...args) => {
        if (failCategory) throw new Error('category failed')
        seriesAssigned.push(args)
      },
    },
    '../components/TaskForm': { default: TaskForm },
    '../api/tasks': {
      updateTask: async (id, payload) => {
        if (failContent) throw new Error('content failed')
        saved.push([id, payload])
        return { ...task, ...payload }
      },
    },
    '@shared/utils/datetime': {
      toDayjsFromDateWithOffset: () => ({ format: () => '2026-11-03' }),
      toApiDateWithOffset: (value) => value,
    },
    '@contexts/TaskCacheContext': { useTaskCache: () => ({ setTask() {} }) },
    '@contexts/ToastContext': {
      useToast: () => ({ addToast: (...args) => toasts.push(args) }),
    },
    '@shared/utils/events': {
      dispatchTaskChanged: (...args) => events.push(args),
    },
    '@shared/utils/isoDuration': {
      parseIsoDurationMinutes: () => null,
      formatIsoDurationLabel: () => null,
      parseDurationInput: () => ({ kind: 'empty' }),
    },
    './TaskPages.css': {},
    '@features/recurrence/components/RecurrenceScopeDialog': {
      useRecurrenceScope: () => ({ dialog: null, ask: async () => 'ALL' }),
    },
    '@features/recurrence/utils/seriesMutations': {
      confirmAndUpdateSeries: async () => {
        if (failContent) throw new Error('content failed')
        return 'updated'
      },
    },
    '@features/recurrence/utils/recurrenceRules': {
      flexibleChanges: () => ({ title: 'edited' }),
    },
  }).default
  return {
    render: () => {
      hooks.begin()
      return find(Form(), TaskForm)
    },
    saved,
    assigned,
    events,
    toasts,
    exits,
    seriesAssigned,
    refreshCategory: (value) => {
      categoryId = value
    },
    failCategory: (value) => {
      failCategory = value
    },
    failContent: (value) => {
      failContent = value
    },
  }
}

test('task title-only saves do not overwrite a category changed in a background refresh', async () => {
  const h = createTaskEdit()
  const original = h.render()
  h.refreshCategory(8)
  const current = h.render()
  await current.props.onSubmit({
    ...original.props.initialValues,
    title: 'draft',
    categoryChanged: false,
  })
  assert.equal(h.saved.length, 1)
  assert.deepEqual(h.assigned, [])
})

test('task content success is published before a failing category write and category retry preserves the editor', async () => {
  const h = createTaskEdit()
  const form = h.render()
  const values = {
    ...form.props.initialValues,
    title: 'draft',
    categoryId: 8,
    categoryChanged: true,
  }
  h.failCategory(true)
  await form.props.onSubmit(values)
  assert.equal(h.saved.length, 1)
  assert.deepEqual(h.events, [[9, 'update']])
  assert.deepEqual(h.exits, [])
  assert.match(
    h.toasts.at(-1)[0],
    /작업 내용은 저장됐지만 카테고리는 저장하지 못했어요/,
  )
  h.failCategory(false)
  await h.render().props.onSubmit(values)
  assert.deepEqual(h.assigned, [[9, 8]])
  assert.deepEqual(h.exits, ['/app/tasks'])
})

test('recurring task category success is published when content fails and can be reverted on retry', async () => {
  const h = createTaskEdit({ recurring: true })
  const form = h.render()
  h.failContent(true)
  await form.props.onSubmit({
    ...form.props.initialValues,
    categoryId: 8,
    categoryChanged: true,
  })
  assert.deepEqual(h.seriesAssigned, [[4, 8, 'ALL', '2026-11-03']])
  assert.equal(h.events[0][0].reason, 'category')
  assert.deepEqual(h.exits, [])
  assert.match(
    h.toasts.at(-1)[0],
    /카테고리는 저장됐지만 반복 작업 내용은 저장하지 못했어요/,
  )
  h.failContent(false)
  await h
    .render()
    .props.onSubmit({ ...form.props.initialValues, categoryChanged: false })
  assert.deepEqual(h.seriesAssigned[1], [4, 7, 'ALL', '2026-11-03'])
  assert.deepEqual(h.exits, ['/app/tasks'])
})

test('a committed series category write stays successful when its follow-up refresh fails', async () => {
  let fail = false
  const writes = []
  const snapshot = {
    categories: [{ id: 7, name: 'work', builtIn: false }],
    taskAssignments: {},
    scheduleAssignments: { 9: 7 },
  }
  const store = load('../src/features/categories/store.ts', {
    react: { useEffect() {}, useSyncExternalStore: (_subscribe, get) => get() },
    '@shared/api/config': { buildApiUrl: (path) => path },
    '@shared/api/httpClient': {
      httpClient: async (_url, options) => {
        if (options?.method === 'PUT') {
          writes.push(options.json)
          return
        }
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
  await store.reloadCategories()
  fail = true
  await store.assignSeriesCategory(4, 8, 'ALL', '2026-11-03')
  assert.equal(writes.length, 1)
  assert.equal(store.useCategories().hasLoaded, true)
  assert.equal(store.useCategories().error, 'refresh failed')
})
