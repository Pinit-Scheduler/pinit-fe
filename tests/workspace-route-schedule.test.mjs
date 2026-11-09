import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const load = (path, deps = {}, globals = {}) => {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  })
  const module = { exports: {} }
  vm.runInNewContext(outputText, {
    module,
    exports: module.exports,
    Error,
    require: (name) => {
      assert.ok(name in deps, `Unexpected dependency ${name}`)
      return deps[name]
    },
    console: { error() {} },
    ...globals,
  })
  return module.exports
}
const plain = (value) => JSON.parse(JSON.stringify(value))
const routing = load('../src/shared/routing/routeSurfaceState.ts')

test('only entity detail/create/edit URLs become surfaces; plan and map remain pages', () => {
  for (const path of [
    '/app/tasks/new',
    '/app/tasks/42',
    '/app/tasks/42/edit',
    '/app/schedules/new',
    '/app/schedules/7',
    '/app/schedules/7/edit',
    '/app/new',
  ])
    assert.equal(routing.isSurfacePath(path), true, path)
  for (const path of [
    '/app/plan',
    '/app/task-map',
    '/app/tasks',
    '/app/schedules',
    '/app/settings',
  ])
    assert.equal(routing.isSurfacePath(path), false, path)
  assert.equal(routing.surfaceFallback('/app/tasks/42'), '/app/tasks')
  assert.equal(
    routing.surfaceFallback('/app/schedules/7/edit'),
    '/app/schedules',
  )
})
test('background return preserves list query/anchor and rejects external or stacked surfaces', () => {
  const background = {
    pathname: '/app/tasks',
    search: '?category=3',
    hash: '#task-7',
    key: 'prior',
    state: null,
  }
  assert.equal(
    routing.safeBackground({ backgroundLocation: background }),
    background,
  )
  assert.equal(routing.locationHref(background), '/app/tasks?category=3#task-7')
  assert.equal(
    routing.safeBackground({
      backgroundLocation: { pathname: 'https://evil.test' },
    }),
    undefined,
  )
  assert.equal(
    routing.safeBackground({
      backgroundLocation: { pathname: '/app/tasks/new' },
    }),
    undefined,
  )
})

const harness = ({
  fail = false,
  state = 'IN_PROGRESS',
  deferred,
  activeFails = false,
} = {}) => {
  const states = [],
    active = [],
    updates = [],
    published = [],
    events = [],
    requests = []
  let hookIndex = 0,
    pending = null,
    failing = fail,
    verificationFails = activeFails
  const mutation = (name) => async (id) => {
    requests.push([name, id])
    if (deferred) await deferred
    if (failing === 'conflict') throw { conflict: true }
    if (failing) throw new Error('connection lost')
    return {
      id,
      state: {
        start: 'IN_PROGRESS',
        pause: 'SUSPENDED',
        complete: 'COMPLETED',
        cancel: 'NOT_STARTED',
      }[name],
      version: 2,
      allowedActions: {},
    }
  }
  const api = {
    startSchedule: mutation('start'),
    suspendSchedule: mutation('pause'),
    completeSchedule: mutation('complete'),
    cancelSchedule: mutation('cancel'),
    fetchScheduleDetail: async (id) => ({
      id,
      title: 'test',
      state: 'COMPLETED',
      version: 5,
    }),
  }
  const cache = {
    activeScheduleId: 9,
    schedulesById: {
      9: {
        id: 9,
        state,
        version: 1,
        allowedActions: {
          start: ['NOT_STARTED', 'SUSPENDED'].includes(state),
          suspend: state === 'IN_PROGRESS',
          complete: ['NOT_STARTED', 'IN_PROGRESS'].includes(state),
          cancel: ['IN_PROGRESS', 'SUSPENDED', 'COMPLETED'].includes(state),
        },
      },
    },
    pendingScheduleId: null,
    beginMutation: (id) => {
      if (pending !== null) return false
      pending = id
      return true
    },
    endMutation: (id) => {
      if (pending === id) pending = null
    },
    updateScheduleState: (...args) => updates.push(args),
    setActiveSchedule: (id) => active.push(id),
    setSchedule: (schedule) => published.push(schedule),
  }
  const hooks = load('../src/features/schedules/hooks/useScheduleActions.ts', {
    '../api/schedules.ts': api,
    '@features/spaces/metadata': { getMetadata: () => undefined },
    '@features/spaces/conflicts': {
      CONFLICT_RELOADED: 'reloaded',
      isEditConflict: (error) => error?.conflict === true,
    },
    '@features/auth/api/member': {
      fetchActiveScheduleId: async () => {
        if (verificationFails) throw new Error('verification failed')
        return 9
      },
    },
    react: {
      useState: (initial) => {
        const i = hookIndex++
        states[i] = initial
        return [
          initial,
          (next) => {
            states[i] = typeof next === 'function' ? next(states[i]) : next
          },
        ]
      },
      useMemo: (calculate) => calculate(),
      useEffect() {},
      useRef: (initial) => ({ current: initial }),
    },
    '@contexts/ScheduleCacheContext': { useScheduleCache: () => cache },
    '@contexts/ToastContext': { useToast: () => ({ addToast() {} }) },
    '@shared/utils/events': {
      dispatchScheduleChanged: (event) => events.push(event),
    },
    '@shared/utils/scheduleTaskSync': {
      useScheduleTaskSync: () => ({
        syncTaskStateWithSchedule: async () => {},
      }),
    },
  })
  return {
    actions: hooks.default(9, state),
    active,
    updates,
    published,
    events,
    requests,
    states,
    succeed: () => {
      failing = false
      verificationFails = false
    },
  }
}
for (const action of ['complete', 'cancel'])
  test(`failed ${action} retains server active schedule and permits a successful retry`, async () => {
    const h = harness({ fail: true })
    await h.actions[action]()
    assert.deepEqual(h.active, [])
    assert.deepEqual(h.updates, [])
    assert.deepEqual(h.events, [])
    assert.equal(h.states[2], 'connection lost')
    h.succeed()
    await h.actions.retry()
    assert.deepEqual(h.active, [null])
    assert.deepEqual(h.updates, [], 'state-only writes must not bypass the versioned cache')
    assert.equal(h.published[0].version, 2)
    assert.equal(h.published[0].state, action === 'complete' ? 'COMPLETED' : 'NOT_STARTED')
    assert.equal(h.events.length, 1)
    assert.equal(h.states[2], null)
  })
test('a version conflict reloads the schedule instead of resending the stale version', async () => {
  const h = harness({ fail: 'conflict' })
  await h.actions.complete()
  assert.deepEqual(h.requests, [['complete', 9]], 'no automatic retry')
  assert.equal(h.published.length, 1)
  assert.equal(h.published[0].version, 5, 'the latest version replaces the stale one')
  assert.deepEqual(h.active, [])
  assert.equal(h.events.length, 1)
  assert.equal(h.events[0].reason, 'conflict-reloaded')
  assert.equal(h.states[2], null, 'no retry offer for a stale version')
})
test('a synchronous shared lock prevents competing mutations before a React render', async () => {
  let release
  const deferred = new Promise((resolve) => {
    release = resolve
  })
  const h = harness({ deferred })
  const first = h.actions.complete()
  const second = h.actions.cancel()
  release()
  await Promise.all([first, second])
  assert.deepEqual(h.requests, [['complete', 9]])
  assert.deepEqual(h.active, [null])
})
test('suspended schedules can resume/cancel but cannot complete without resuming', () => {
  const h = harness({ state: 'SUSPENDED' })
  assert.equal(h.actions.canStart, true)
  assert.equal(h.actions.canPause, false)
  assert.equal(h.actions.canComplete, false)
  assert.equal(h.actions.canCancel, true)
})

const recurrenceHarness = () => {
  const calls = [],
    prompts = []
  const api = {
    deleteRecurrence: async (...args) => {
      calls.push(['delete', ...args])
      return { impact: { deleted: 3, protected: 2 } }
    },
    updateRecurrence: async (...args) => {
      calls.push(['update', ...args])
      return { impact: { patched: 2 } }
    },
  }
  const series = load(
    '../src/features/recurrence/utils/seriesMutations.ts',
    {
      '../api/recurrences': api,
      './recurrenceRules': {
        deleteImpactMessage: (impact) =>
          `${impact.deleted} deleted, ${impact.protected} protected`,
        editImpactMessage: (impact) => `${impact.patched} patched`,
      },
    },
    {
      window: {
        confirm: (message) => {
          prompts.push(message)
          return false
        },
      },
    },
  )
  return { series, calls, prompts }
}
test('following preview uses original occurrence date; confirmed commit skips a second prompt', async () => {
  const h = recurrenceHarness(),
    ref = { seriesId: 4, occurrenceDate: '2026-11-03', version: 9 }
  assert.equal(
    await h.series.previewSeriesDelete(ref, 'FOLLOWING'),
    '3 deleted, 2 protected',
  )
  await h.series.confirmAndDeleteSeries(ref, 'FOLLOWING', true)
  assert.deepEqual(plain(h.calls), [
    ['delete', 4, 'FOLLOWING', '2026-11-03', true, 9],
    ['delete', 4, 'FOLLOWING', '2026-11-03', false, 9],
  ])
  assert.equal(h.prompts.length, 0)
})
test('edit preview and confirmed update preserve scope and only changed fields', async () => {
  const h = recurrenceHarness(),
    ref = { seriesId: 4, occurrenceDate: '2026-11-03', version: 9 },
    changes = { title: 'changed' }
  assert.equal(
    await h.series.previewSeriesUpdate(ref, 'ALL', changes),
    '2 patched',
  )
  await h.series.confirmAndUpdateSeries(ref, 'ALL', changes, true)
  assert.deepEqual(plain(h.calls), [
    ['update', 4, { expectedVersion: 9, scope: 'ALL', changes }, true],
    ['update', 4, { expectedVersion: 9, scope: 'ALL', changes }, false],
  ])
  assert.equal(h.prompts.length, 0)
})
test('an unconfirmed destructive action never commits when confirmation is declined', async () => {
  const h = recurrenceHarness()
  assert.equal(
    await h.series.confirmAndDeleteSeries(
      { seriesId: 4, occurrenceDate: '2026-11-03' },
      'ALL',
    ),
    false,
  )
  assert.equal(h.calls.length, 1)
  assert.equal(h.calls[0][4], true)
})

test('retry after a successful start with a failed active-ID lookup verifies without posting start twice', async () => {
  const h = harness({ state: 'NOT_STARTED', activeFails: true })
  await h.actions.start()
  assert.match(h.states[2], /현재 상태/)
  assert.deepEqual(h.active, [])
  h.succeed()
  await h.actions.retry()
  assert.deepEqual(h.requests, [['start', 9]])
  assert.deepEqual(h.active, [9])
  assert.equal(h.states[2], null)
})
