import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { errorMessage } from './support/errors.mjs'

// BE ADR-0037 §8: a schedule is personal. The edit page sends only its content and never waits for
// project data; '@features/categories' is left out of the stubs so importing it again fails here.
const createHarness = ({ recurring = false } = {}) => {
  const saved = [],
    exits = [],
    seriesUpdated = [],
    events = [],
    toasts = []
  let failContent = false
  const ScheduleForm = () => null
  const schedule = {
    id: 9,
    title: 'original',
    description: 'details',
    date: { dateTime: '2026-11-03T10:00:00', zoneId: 'Asia/Seoul' },
    scheduleType: 'DEEP_WORK',
    plannedDuration: 'PT30M',
    // The read-time display place and owner (ADR-0037 §7); the form must not echo them back.
    spaceId: 31,
    projectId: 7,
    assigneeId: 1,
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
      useRef: () => ({ current: null }),
      useState: (initial) => [initial, () => {}],
    },
    'react-router-dom': { useParams: () => ({ scheduleId: '9' }) },
    '../../components/ScheduleForm': { default: ScheduleForm },
    '@shared/utils/datetime': {
      toDateFromApi: () => new Date('2026-11-03T01:00:00Z'),
      toApiDateTimeWithZone: (date) => date,
      toDateKey: (date) =>
        new Date(date.dateTime ?? date).toISOString().slice(0, 10),
      toDisplayDayjs: () => ({ format: () => '10:00' }),
    },
    '../../hooks/useScheduleDetail': {
      default: (_id, options) => {
        assert.equal(options.refreshOnChange, false, 'editing must pin its first snapshot')
        return { schedule, isLoading: false, error: null }
      },
    },
    '@contexts/ToastContext': {
      useToast: () => ({ addToast: (...args) => toasts.push(args) }),
    },
    '@shared/api/errorMessage': errorMessage,
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
    failContent: (value) => {
      failContent = value
    },
    saved,
    exits,
    seriesUpdated,
    events,
    toasts,
  }
}

// Values an old open tab or a future form could still carry; none of them may reach the server.
const stray = {
  spaceId: 31,
  assigneeId: 2,
  categoryId: 8,
  categoryChanged: true,
  locationChanged: true,
  assigneeChanged: true,
  affiliationChanged: true,
}
const AFFILIATION = ['spaceId', 'projectId', 'assigneeId', 'location', 'assignee']

test('the edit form mounts as soon as the schedule loads and carries no place or assignee', () => {
  const form = createHarness().render()
  assert.ok(form, 'no project lookup gates the editor')
  for (const key of ['spaceId', 'assigneeId', 'categoryId'])
    assert.equal(Object.hasOwn(form.props.initialValues, key), false, key)
  assert.equal(form.props.initialValues.title, 'original')
})

test('a title-only save sends only content, even when the submitted values carry stray place fields', async () => {
  const h = createHarness()
  const form = h.render()
  await form.props.onSubmit({
    ...form.props.initialValues,
    ...stray,
    title: 'changed title',
  })
  assert.equal(h.saved.length, 1)
  const [id, payload] = h.saved[0]
  assert.equal(id, 9)
  assert.equal(payload.title, 'changed title')
  for (const key of AFFILIATION)
    assert.equal(Object.hasOwn(payload, key), false, key)
  assert.deepEqual(h.exits, ['/app/schedules'])
})

test('moving a schedule publishes both the old date and the saved new date', async () => {
  const h = createHarness()
  const form = h.render()
  const nextDate = new Date('2026-11-04T01:00:00Z')
  await form.props.onSubmit({ ...form.props.initialValues, date: nextDate })
  assert.equal(h.events[0].reason, 'updated')
  assert.equal(h.events[0].previousDateKey, '2026-11-03')
  assert.equal(h.events[0].schedule.date.toISOString(), nextDate.toISOString())
})

test('an ALL recurrence edit sends only the content changes, with no place argument', async () => {
  const h = createHarness({ recurring: true })
  const form = h.render()
  await form.props.onSubmit({
    ...form.props.initialValues,
    ...stray,
    title: 'renamed for all occurrences',
  })
  assert.equal(h.seriesUpdated.length, 1)
  assert.equal(h.seriesUpdated[0].length, 4, 'no affiliation argument')
  assert.equal(h.seriesUpdated[0][1], 'ALL')
  assert.deepEqual(h.seriesUpdated[0][2], { title: 'renamed for all occurrences' })
  assert.deepEqual(h.exits, ['/app/schedules'])
})

test('a failed save preserves the editor and the retry still sends no place', async () => {
  const h = createHarness()
  const form = h.render()
  const values = { ...form.props.initialValues, ...stray, title: 'saved title' }
  h.failContent(true)
  await assert.rejects(form.props.onSubmit(values), /content failed/)
  assert.equal(h.saved.length, 0)
  assert.deepEqual(h.events, [])
  assert.deepEqual(h.exits, [])
  h.failContent(false)
  await h.render().props.onSubmit(values)
  assert.equal(h.saved.length, 1)
  for (const key of AFFILIATION)
    assert.equal(Object.hasOwn(h.saved[0][1], key), false, key)
  assert.equal(h.events[0].reason, 'updated')
  assert.deepEqual(h.exits, ['/app/schedules'])
})

test('a failed recurring save keeps the draft; the retry commits content only', async () => {
  const h = createHarness({ recurring: true })
  const form = h.render()
  const values = { ...form.props.initialValues, ...stray, title: 'renamed' }
  h.failContent(true)
  await assert.rejects(form.props.onSubmit(values), /content failed/)
  assert.deepEqual(h.seriesUpdated, [])
  assert.deepEqual(h.events, [])
  assert.deepEqual(h.exits, [])
  h.failContent(false)
  await h.render().props.onSubmit(values)
  assert.equal(h.seriesUpdated.length, 1)
  assert.equal(h.seriesUpdated[0][1], 'ALL')
  assert.equal(h.seriesUpdated[0].length, 4)
  assert.deepEqual(h.exits, ['/app/schedules'])
})
