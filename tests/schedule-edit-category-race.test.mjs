import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const createHarness = ({ recurring = false } = {}) => {
  const assigned = [],
    saved = [],
    exits = [],
    seriesAssigned = [],
    seriesUpdated = [],
    events = [],
    toasts = []
  const savedCategory = { current: null }
  let failCategory = false,
    failContent = false
  let category = { isLoading: true, error: null, id: null }
  const ScheduleForm = () => null
  const schedule = {
    id: 9,
    title: 'original',
    description: 'details',
    date: { dateTime: '2026-11-03T10:00:00', zoneId: 'Asia/Seoul' },
    scheduleType: 'DEEP_WORK',
    plannedDuration: 'PT30M',
    ...(recurring
      ? { recurrence: { seriesId: 4, occurrenceDate: '2026-11-03' } }
      : {}),
  }
  const dependencies = {
    'react/jsx-runtime': {
      jsx: (type, props) => ({ type, props }),
      jsxs: (type, props) => ({ type, props }),
    },
    react: {
      useCallback: (fn) => fn,
      useEffect() {},
      useMemo: (fn) => fn(),
      useRef: () => savedCategory,
    },
    'react-router-dom': { useParams: () => ({ scheduleId: '9' }) },
    '../../components/ScheduleForm': { default: ScheduleForm },
    '@shared/utils/datetime': {
      toDateFromApi: () => new Date('2026-11-03T01:00:00Z'),
      toApiDateTimeWithZone: (date) => date,
      toDateKey: () => '2026-11-03',
      toDisplayDayjs: () => ({ format: () => '10:00' }),
    },
    '../../hooks/useScheduleDetail': {
      default: () => ({ schedule, isLoading: false, error: null }),
    },
    '@contexts/ToastContext': {
      useToast: () => ({ addToast: (...args) => toasts.push(args) }),
    },
    '@contexts/TimePreferencesContext': {
      useTimePreferences: () => ({ offsetMinutes: 540 }),
    },
    './ScheduleFormPage.css': {},
    '../../api/schedules': {
      updateSchedule: async (id, payload) => {
        if (failContent) throw new Error('content failed')
        saved.push([id, payload])
        return { ...schedule, ...payload }
      },
    },
    '@shared/utils/events': {
      dispatchScheduleChanged: (detail) => events.push(detail),
    },
    '@shared/utils/isoDuration': {
      parseIsoDurationMinutes: () => 30,
      parseDurationInput: () => ({ kind: 'empty' }),
      minutesToIsoDuration: (value) => `PT${value}M`,
    },
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
      fixedChanges: (before, after) =>
        before.title === after.title ? {} : { title: after.title },
    },
    '@shared/routing/RouteSurface': {
      useRouteSurfaceNavigation: () => ({
        complete: (fallback) => exits.push(fallback),
      }),
    },
    '@features/categories': {
      useCategories: () => ({
        ...category,
        scheduleCategory: () =>
          category.id === null ? null : { id: category.id },
        reload: async () => {},
      }),
      assignScheduleCategory: async (...args) => {
        if (failCategory) throw new Error('category failed')
        assigned.push(args)
      },
      assignSeriesCategory: async (...args) => {
        if (failCategory) throw new Error('category failed')
        seriesAssigned.push(args)
      },
    },
  }
  const source = readFileSync(
    new URL(
      '../src/features/schedules/pages/form/ScheduleEditPage.tsx',
      import.meta.url,
    ),
    'utf8',
  )
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
  const findForm = (node) => {
    if (!node || typeof node !== 'object') return null
    if (node.type === ScheduleForm) return node
    const children = node.props?.children
    for (const child of Array.isArray(children) ? children : [children]) {
      const result = findForm(child)
      if (result) return result
    }
    return null
  }
  return {
    render: () => findForm(module.exports.default()),
    setCategory: (next) => {
      category = { hasLoaded: !next.isLoading && !next.error, ...next }
    },
    failCategory: (value) => {
      failCategory = value
    },
    failContent: (value) => {
      failContent = value
    },
    assigned,
    saved,
    exits,
    seriesAssigned,
    seriesUpdated,
    events,
    toasts,
  }
}

test('a fast schedule response cannot mount a form with an unknown category; title-only save preserves it after category lookup', async () => {
  const h = createHarness()
  assert.equal(h.render(), null)
  h.setCategory({ isLoading: false, error: null, id: 7 })
  const form = h.render()
  assert.equal(form.props.initialValues.categoryId, 7)
  await form.props.onSubmit({
    ...form.props.initialValues,
    title: 'changed title',
  })
  assert.equal(h.saved.length, 1)
  assert.deepEqual(h.assigned, [])
  assert.deepEqual(h.exits, ['/app/schedules'])
})

test('failed category lookup cannot expose a destructive default None; recovery uses the existing assignment', () => {
  const h = createHarness()
  h.setCategory({ isLoading: false, error: 'temporary failure', id: null })
  assert.equal(h.render(), null)
  assert.deepEqual(h.assigned, [])
  h.setCategory({ isLoading: false, error: null, id: 7 })
  assert.equal(h.render().props.initialValues.categoryId, 7)
})

test('confirmed uncategorized schedules remain editable with an explicit None value', async () => {
  const h = createHarness()
  h.setCategory({ isLoading: false, error: null, id: null })
  const form = h.render()
  assert.equal(form.props.initialValues.categoryId, null)
  await form.props.onSubmit({
    ...form.props.initialValues,
    title: 'changed title',
  })
  assert.deepEqual(h.assigned, [])
})

test('title-only ALL recurrence edit never rewrites category overrides on other occurrences', async () => {
  const h = createHarness({ recurring: true })
  h.setCategory({ isLoading: false, error: null, id: 7 })
  const form = h.render()
  await form.props.onSubmit({
    ...form.props.initialValues,
    title: 'renamed for all occurrences',
  })
  assert.deepEqual(h.seriesAssigned, [])
  assert.equal(h.seriesUpdated.length, 1)
  assert.equal(h.seriesUpdated[0][1], 'ALL')
  assert.equal(h.seriesUpdated[0][2].title, 'renamed for all occurrences')
  assert.deepEqual(h.exits, ['/app/schedules'])
})

test('an explicitly changed recurrence category still applies to the confirmed scope', async () => {
  const h = createHarness({ recurring: true })
  h.setCategory({ isLoading: false, error: null, id: 7 })
  const form = h.render()
  await form.props.onSubmit({
    ...form.props.initialValues,
    title: 'renamed',
    categoryId: 8,
    categoryChanged: true,
  })
  assert.deepEqual(h.seriesAssigned, [[4, 8, 'ALL', '2026-11-03']])
  assert.equal(h.seriesUpdated.length, 1)
})

test('background category refresh failure keeps the mounted schedule editor and its stable identity', async () => {
  const h = createHarness()
  h.setCategory({ isLoading: false, hasLoaded: true, error: null, id: 7 })
  const original = h.render()
  h.setCategory({
    isLoading: false,
    hasLoaded: true,
    error: 'refresh failed',
    id: 7,
  })
  const duringFailure = h.render()
  assert.ok(duringFailure)
  assert.equal(duringFailure.type, original.type)
  await duringFailure.props.onSubmit({
    ...original.props.initialValues,
    title: 'unsaved title before refresh',
  })
  assert.equal(h.saved[0][1].title, 'unsaved title before refresh')
  assert.deepEqual(h.assigned, [])
})

test('title-only save after a category refresh never writes the stale form category back', async () => {
  const h = createHarness()
  h.setCategory({ isLoading: false, error: null, id: 7 })
  const original = h.render()
  h.setCategory({ isLoading: false, error: null, id: 8 })
  const latest = h.render()
  await latest.props.onSubmit({
    ...original.props.initialValues,
    title: 'title edit',
    categoryChanged: false,
  })
  assert.deepEqual(h.assigned, [])
  assert.equal(h.saved[0][1].title, 'title edit')
})

test('schedule content success is published even when the category write fails, and retry keeps the editor open', async () => {
  const h = createHarness()
  h.setCategory({ isLoading: false, error: null, id: 7 })
  const form = h.render()
  const values = {
    ...form.props.initialValues,
    title: 'saved title',
    categoryId: 8,
    categoryChanged: true,
  }
  h.failCategory(true)
  await assert.rejects(form.props.onSubmit(values), /category failed/)
  assert.equal(h.saved.length, 1)
  assert.equal(h.events[0].reason, 'updated')
  assert.deepEqual(h.exits, [])
  assert.match(
    h.toasts.at(-1)[0],
    /일정 내용은 저장됐지만 카테고리는 저장하지 못했어요/,
  )
  h.failCategory(false)
  await h.render().props.onSubmit(values)
  assert.deepEqual(h.assigned, [[9, 8]])
  assert.deepEqual(h.exits, ['/app/schedules'])
})

test('a saved recurrence category is published when the content write fails; retry can undo that partial category change', async () => {
  const h = createHarness({ recurring: true })
  h.setCategory({ isLoading: false, error: null, id: 7 })
  const form = h.render()
  h.failContent(true)
  await assert.rejects(
    form.props.onSubmit({
      ...form.props.initialValues,
      categoryId: 8,
      categoryChanged: true,
    }),
    /content failed/,
  )
  assert.deepEqual(h.seriesAssigned, [[4, 8, 'ALL', '2026-11-03']])
  assert.equal(h.events[0].reason, 'category')
  assert.deepEqual(h.exits, [])
  assert.match(
    h.toasts.at(-1)[0],
    /카테고리는 저장됐지만 반복 일정 내용은 저장하지 못했어요/,
  )
  h.failContent(false)
  await h
    .render()
    .props.onSubmit({ ...form.props.initialValues, categoryChanged: false })
  assert.deepEqual(h.seriesAssigned[1], [4, 7, 'ALL', '2026-11-03'])
  assert.deepEqual(h.exits, ['/app/schedules'])
})
