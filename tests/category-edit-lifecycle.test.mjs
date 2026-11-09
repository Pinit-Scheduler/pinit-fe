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
      if (name === '@features/spaces/metadata') {
        const source = readFileSync(
          new URL('../src/features/spaces/metadata.ts', import.meta.url),
          'utf8',
        )
        const output = ts.transpileModule(source, {
          compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2022,
          },
        }).outputText
        const registry = { exports: {} }
        vm.runInNewContext(output, {
          module: registry,
          exports: registry.exports,
        })
        return registry.exports
      }
      if (name === '@features/spaces/moveResult')
        return { moveResultMessage: () => null }
      if (name === '@features/spaces/EditConflictDialog')
        return { default: () => null }
      if (name === '@shared/motion/usePresence')
        return {
          usePresence: (value) => ({ mounted: !!value, closing: false, value: value || undefined }),
        }
      if (name === '@features/spaces/MyInputDisclosure')
        return { default: () => null }
      if (name === '@features/spaces/conflicts')
        return { changedInput: () => [], isEditConflict: () => false }
      if (name === '@constants/schedules' && !(name in dependencies))
        return { scheduleTypeLabel: {} }
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
      spaceId: -4,
      assigneeId: null,
      expectedVersion: 7,
      recurrenceVersion: 9,
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
      '@features/spaces/AffiliationFields': { default: CategoryPicker },
      '@features/spaces/affiliationImpact': {
        needsRecordDisclosure: () => false,
      },
      '@features/spaces/store': { useSpaces: () => ({ spaces: [] }) },
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
      // Dependency chips animate through list presence; the form logic does not depend on it.
      '@shared/motion': {
        useListPresence: (items, getKey) =>
          items.map((item) => ({ key: String(getKey(item)), item, phase: 'present' })),
        presenceProps: () => ({}),
      },
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
      spaceId: -4,
      assigneeId: null,
      expectedVersion: 7,
      recurrenceVersion: 9,
    }
    let waitForSubmit = null
    const render = () => {
      hooks.begin()
      return Form({
        initialValues,
        onSubmit: async (values) => {
          submitted.push(values)
          if (waitForSubmit) await waitForSubmit
          return false
        },
      })
    }
    render()
    initialValues = {
      ...initialValues,
      categoryId: 8,
      assigneeId: 88,
      expectedVersion: 11,
      recurrenceVersion: 13,
    }
    let tree = render()
    await tree.props.onSubmit({ preventDefault() {} })
    assert.equal(submitted.at(-1).categoryId, 7)
    assert.equal(submitted.at(-1).categoryChanged, false)
    assert.equal(submitted.at(-1).expectedVersion, 7)
    assert.equal(submitted.at(-1).recurrenceVersion, 9)
    assert.equal(submitted.at(-1).assigneeId, null)
    assert.equal(submitted.at(-1).locationChanged, false)
    assert.equal(submitted.at(-1).assigneeChanged, false)
    tree = render()
    find(tree, CategoryPicker).props.onChange({
      categoryId: 8,
      spaceId: -4,
      assigneeId: null,
    })
    tree = render()
    await tree.props.onSubmit({ preventDefault() {} })
    assert.equal(submitted.at(-1).categoryId, 8)
    assert.equal(submitted.at(-1).categoryChanged, true)
    tree = render()
    find(tree, CategoryPicker).props.onChange({
      categoryId: 7,
      spaceId: -4,
      assigneeId: null,
    })
    tree = render()
    await tree.props.onSubmit({ preventDefault() {} })
    assert.equal(submitted.at(-1).categoryChanged, false)
    let release
    waitForSubmit = new Promise((resolve) => {
      release = resolve
    })
    tree = render()
    const before = submitted.length
    const first = tree.props.onSubmit({ preventDefault() {} })
    const duplicate = tree.props.onSubmit({ preventDefault() {} })
    assert.equal(
      submitted.length,
      before + 1,
      'Synchronous duplicate submissions must be locked before rendering',
    )
    release()
    await Promise.all([first, duplicate])
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
    seriesAssigned = [],
    seriesUpdated = []
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
      confirmAndUpdateSeries: async (...args) => {
        if (failContent) throw new Error('content failed')
        seriesUpdated.push(args)
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
    seriesUpdated,
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
  assert.equal(Object.hasOwn(h.saved[0][1], 'projectId'), false)
  assert.equal(Object.hasOwn(h.saved[0][1], 'assigneeId'), false)
  assert.deepEqual(h.assigned, [])
})

test('task content and project save atomically; a rejected save keeps the editor and the draft', async () => {
  const h = createTaskEdit()
  const form = h.render()
  const values = {
    ...form.props.initialValues,
    title: 'draft',
    categoryId: 8,
    categoryChanged: true,
  }
  h.failContent(true)
  await form.props.onSubmit(values)
  assert.equal(h.saved.length, 0)
  assert.deepEqual(h.events, [])
  assert.deepEqual(h.exits, [])
  assert.match(h.toasts.at(-1)[0], /content failed/)
  h.failContent(false)
  await h.render().props.onSubmit(values)
  assert.equal(h.saved.length, 1)
  assert.equal(h.saved[0][1].projectId, 8)
  assert.equal(h.saved[0][1].title, 'draft')
  assert.deepEqual(h.assigned, [])
  assert.deepEqual(h.events, [[9, 'update']])
  assert.deepEqual(h.exits, ['/app/tasks'])
})

test('recurring task content and project scope commit atomically and a rejection keeps the draft', async () => {
  const h = createTaskEdit({ recurring: true })
  const form = h.render()
  const values = {
    ...form.props.initialValues,
    categoryId: 8,
    categoryChanged: true,
  }
  h.failContent(true)
  await form.props.onSubmit(values)
  assert.deepEqual(h.seriesAssigned, [])
  assert.deepEqual(h.seriesUpdated, [])
  assert.deepEqual(h.events, [])
  assert.deepEqual(h.exits, [])
  assert.match(h.toasts.at(-1)[0], /content failed/)
  h.failContent(false)
  await h.render().props.onSubmit(values)
  assert.equal(h.seriesUpdated.length, 1)
  assert.equal(h.seriesUpdated[0][1], 'ALL')
  assert.equal(h.seriesUpdated[0][4].projectId, 8)
  assert.deepEqual(h.seriesAssigned, [])
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
        if (_url.startsWith('/workspace/recurrences/') && !options?.method)
          return {
            spaceId: -1,
            projectId: 7,
            version: 2,
            assigneeId: null,
            allowedActions: {},
          }
        if (options?.method === 'PATCH') {
          writes.push(options.json)
          return {
            spaceId: -1,
            projectId: options.json.location.projectId,
            version: 3,
            assigneeId: null,
            allowedActions: {},
          }
        }
        if (fail) throw new Error('refresh failed')
        return snapshot
      },
    },
    '@shared/api/authTokens': { getAccessToken: () => 'actor-1' },
    '@shared/utils/events': {
      onDataChanged: () => () => {},
      onTaskChanged: () => () => {},
      onScheduleChanged: () => () => {},
    },
  })
  await store.reloadCategories()
  fail = true
  await store.assignSeriesCategory(4, 8, 'ALL', '2026-11-03')
  assert.equal(writes.length, 1)
  assert.equal(writes[0].expectedVersion, 2)
  assert.equal(writes[0].location.projectId, 8)
  assert.equal(store.useCategories().hasLoaded, true)
  assert.equal(store.useCategories().error, 'refresh failed')
})
