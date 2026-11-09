import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const plain = (value) => JSON.parse(JSON.stringify(value))
const settle = () => new Promise((resolve) => setTimeout(resolve, 5))
const microtasks = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

function load(path, dependencies = {}, globals = {}) {
  const source = readFileSync(new URL('../src/' + path, import.meta.url), 'utf8')
  const output = ts.transpileModule(source, {
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
    AbortController,
    queueMicrotask,
    setTimeout,
    clearTimeout,
    Date,
    require: (name) => {
      assert.ok(name in dependencies, 'Unexpected dependency ' + name)
      return dependencies[name]
    },
    ...globals,
  })
  return module.exports
}

const eventsModule = (overrides = {}) => {
  const window = new EventTarget()
  const api = load('shared/utils/events.ts', {}, { window, CustomEvent, ...overrides })
  return { window, ...api }
}

// ---------------------------------------------------------------------------
// Event coalescing
// ---------------------------------------------------------------------------

test('task and schedule changes dispatched in one task reach each listener once, with every detail', async () => {
  const events = eventsModule()
  const batches = []
  events.onDataChanged((batch) => batches.push(plain(batch)))
  events.dispatchTaskChanged({ taskId: 4, reason: 'state-mutated' })
  events.dispatchScheduleChanged({ reason: 'task-state-mutated' })
  events.dispatchTaskChanged(4, 'state-mutated')
  assert.equal(batches.length, 0, 'delivery waits for the end of the task')
  await settle()
  assert.deepEqual(batches, [
    {
      tasks: [
        { taskId: 4, reason: 'state-mutated' },
        { taskId: 4, reason: 'state-mutated' },
      ],
      schedules: [{ reason: 'task-state-mutated' }],
    },
  ])
})

test('a dispatch after an await in the same task still joins the batch', async () => {
  const events = eventsModule()
  let calls = 0
  events.onDataChanged(() => calls++)
  events.dispatchTaskChanged(7, 'schedule-state-updated')
  await Promise.resolve()
  await Promise.resolve()
  events.dispatchScheduleChanged({ scheduleId: 3, reason: 'state-mutated' })
  await settle()
  assert.equal(calls, 1)
})

test('per-kind listeners get the shared detail fields plus the full list', async () => {
  const events = eventsModule()
  const seen = []
  events.onTaskChanged((detail, details) => seen.push(plain([detail, details])))
  events.onScheduleChanged((detail) => seen.push(plain(['schedule', detail])))
  events.dispatchTaskChanged({ taskId: 1, reason: 'restore' })
  events.dispatchTaskChanged({ taskId: 2, reason: 'restore' })
  await settle()
  assert.deepEqual(seen, [
    [{ reason: 'restore' }, [{ taskId: 1, reason: 'restore' }, { taskId: 2, reason: 'restore' }]],
  ])
  events.dispatchTaskChanged({ taskId: 9, reason: 'update' })
  events.dispatchScheduleChanged({ scheduleId: 5, reason: 'created' })
  await settle()
  assert.deepEqual(seen.slice(1), [
    [{ taskId: 9, reason: 'update' }, [{ taskId: 9, reason: 'update' }]],
    ['schedule', { scheduleId: 5, reason: 'created' }],
  ])
})

test('raw window events from other modules are coalesced too, and unsubscribing before the flush drops the call', async () => {
  const events = eventsModule()
  let kept = 0, dropped = 0
  events.onDataChanged(() => kept++)
  const off = events.onDataChanged(() => dropped++)
  events.window.dispatchEvent(new CustomEvent('task:changed', { detail: { reason: 'resource-unavailable' } }))
  events.window.dispatchEvent(new CustomEvent('schedule:changed', { detail: { reason: 'resource-unavailable' } }))
  off()
  await settle()
  assert.equal(kept, 1)
  assert.equal(dropped, 0)
})

test('one failing listener does not cancel the others', async () => {
  const thrown = []
  const events = eventsModule({
    setTimeout: (fn, ms) =>
      setTimeout(() => {
        try {
          fn()
        } catch (error) {
          thrown.push(error.message)
        }
      }, ms),
  })
  let reached = false
  events.onDataChanged(() => {
    throw new Error('broken listener')
  })
  events.onDataChanged(() => {
    reached = true
  })
  events.dispatchTaskChanged(1, 'update')
  for (let i = 0; i < 50 && thrown.length === 0; i++) await settle()
  assert.equal(reached, true)
  assert.deepEqual(thrown, ['broken listener'], 'the error is rethrown, not swallowed')
})

test('a local save absorbs exactly one realtime echo; re-reads are not saves', () => {
  const events = eventsModule()
  events.dispatchTaskChanged({ taskId: 5, reason: 'state-mutated' })
  assert.equal(events.takeLocalEcho('task', 5), true)
  assert.equal(events.takeLocalEcho('task', 5), false, 'a second server change still refreshes')
  assert.equal(events.takeLocalEcho('schedule', 5), false, 'kinds are separate')
  events.dispatchScheduleChanged({ schedule: { id: 8 }, reason: 'created' })
  assert.equal(events.takeLocalEcho('schedule', 8), true, 'the id inside a schedule payload counts')
  events.dispatchScheduleChanged({ scheduleId: 3, reason: 'conflict-reloaded' })
  assert.equal(events.takeLocalEcho('schedule', 3), false)
  events.dispatchTaskChanged({ reason: 'space' })
  assert.equal(events.takeLocalEcho('task', 0), false)
})

// ---------------------------------------------------------------------------
// Realtime: first connect and local echo
// ---------------------------------------------------------------------------

const realtimeComponent = (echo) => {
  let changed, cleanup
  const calls = { workspaceChanged: 0, reads: 0 }
  const Component = load('features/spaces/WorkspaceRealtime.tsx', {
    react: { useEffect: (effect) => { cleanup = effect() }, useState: () => [false, () => {}] },
    'react/jsx-runtime': { jsx: () => null },
    '@contexts/TaskCacheContext': { useTaskCache: () => ({ setTask() {} }) },
    '@contexts/ScheduleCacheContext': { useScheduleCache: () => ({ setSchedule() {} }) },
    '@features/tasks/api/tasks': { fetchTaskDetail: () => { calls.reads++; return Promise.resolve({ id: 1 }) } },
    '@features/schedules/api/schedules': { fetchScheduleDetail: () => { calls.reads++; return Promise.resolve({ id: 1 }) } },
    './store': {
      useSpaces: () => ({ spaces: [{ id: 22 }], memberId: 4 }),
      workspaceChanged: () => calls.workspaceChanged++,
    },
    './realtime': { subscribeToWorkspace: (_signal, listener) => { changed = listener; return Promise.resolve() } },
    './metadata': { evictWorkspaceResource() {} },
    '@shared/utils/events': { takeLocalEcho: echo },
    '@shared/motion/usePresence': { usePresence: () => ({ mounted: false, closing: false }) },
  }).default
  Component()
  return { calls, changed: (event) => changed(event), cleanup: () => cleanup() }
}

test('the echo of this client\'s own save skips the global refetch but still reads the detail', async () => {
  const echoes = []
  const h = realtimeComponent((kind, id) => {
    echoes.push([kind, id])
    return id === 1
  })
  h.changed({ spaceId: 22, resourceId: 1, resourceType: 'TASK', action: 'UPDATED', version: 3 })
  await new Promise((resolve) => setTimeout(resolve, 200))
  assert.equal(h.calls.workspaceChanged, 0)
  assert.equal(h.calls.reads, 1)
  h.changed({ spaceId: 22, resourceId: 2, resourceType: 'SCHEDULE', action: 'UPDATED', version: 1 })
  await new Promise((resolve) => setTimeout(resolve, 200))
  assert.equal(h.calls.workspaceChanged, 1, 'another participant\'s change refreshes the views')
  h.changed({ spaceId: 22, resourceId: 1, resourceType: 'TASK', action: 'DELETED', version: 4 })
  h.changed()
  await new Promise((resolve) => setTimeout(resolve, 200))
  assert.equal(h.calls.workspaceChanged, 2, 'removals and resyncs always refresh')
  assert.deepEqual(echoes, [['task', 1], ['schedule', 2]])
  h.cleanup()
})

test('the realtime notice fades out after it has appeared, and unmounts at once inside its delay', () => {
  const render = ({ presence, entered }) => {
    // useState order in the component: disconnected, entered, lastDisconnected.
    const states = [!presence.closing, entered, !presence.closing]
    let cursor = 0
    const Component = load('features/spaces/WorkspaceRealtime.tsx', {
      react: { useEffect() {}, useState: () => [states[cursor++], () => {}] },
      'react/jsx-runtime': { jsx: (type, props) => ({ type, props }) },
      '@contexts/TaskCacheContext': { useTaskCache: () => ({ setTask() {} }) },
      '@contexts/ScheduleCacheContext': { useScheduleCache: () => ({ setSchedule() {} }) },
      '@features/tasks/api/tasks': { fetchTaskDetail() {} },
      '@features/schedules/api/schedules': { fetchScheduleDetail() {} },
      './store': { useSpaces: () => ({ spaces: [{ id: 22 }], memberId: 4 }), workspaceChanged() {} },
      './realtime': { subscribeToWorkspace() {} },
      './metadata': { evictWorkspaceResource() {} },
      '@shared/utils/events': { takeLocalEcho: () => false },
      '@shared/motion/usePresence': { usePresence: () => presence },
    }).default
    return Component()
  }
  const open = render({ presence: { mounted: true, closing: false, value: true }, entered: false })
  assert.equal(open.type, 'p')
  assert.equal(open.props['data-state'], undefined)
  assert.equal(typeof open.props.onAnimationStart, 'function', 'the entrance marks the notice as shown')
  const fading = render({ presence: { mounted: true, closing: true, value: true }, entered: true })
  assert.equal(fading.props['data-state'], 'closing')
  assert.equal(fading.props.onAnimationStart, undefined)
  assert.equal(
    render({ presence: { mounted: true, closing: true, value: true }, entered: false }),
    null,
    'a reconnect before the notice appeared never flashes it',
  )
  assert.equal(render({ presence: { mounted: false, closing: false }, entered: false }), null)
  const css = readFileSync(new URL('../src/features/spaces/spaces.css', import.meta.url), 'utf8')
  assert.match(
    css,
    /\.space-realtime-status\[data-state='closing'\] \{\s*animation: motion-fade-out var\(--motion-exit\) var\(--motion-ease-exit\) both;/,
  )
})

// ---------------------------------------------------------------------------
// Stale-while-revalidate store
// ---------------------------------------------------------------------------

const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
const storeHarness = () => {
  const { createQueryStore } = load('shared/utils/queryStore.ts')
  const store = createQueryStore()
  const requests = []
  const fetcher = (signal) => {
    const request = { signal, ...deferred() }
    requests.push(request)
    return request.promise
  }
  return { store, requests, fetcher }
}

test('a refetch keeps this key\'s data on screen and only flips fetching', async () => {
  const { store, requests, fetcher } = storeHarness()
  store.subscribe('tasks', () => {})
  store.register('tasks', fetcher)
  store.revalidate('tasks')
  store.revalidate('tasks')
  await microtasks()
  assert.equal(requests.length, 1, 'callers in one tick share one request')
  assert.equal(store.get('tasks').hasData, false)
  requests[0].resolve(['a'])
  await microtasks()
  assert.deepEqual(plain(store.get('tasks')).data, ['a'])
  store.invalidate()
  await microtasks()
  assert.equal(requests.length, 2)
  assert.deepEqual(plain(store.get('tasks').data), ['a'], 'old data stays during the refetch')
  assert.equal(store.get('tasks').fetching, true)
  assert.equal(store.get('tasks').stale, true)
  requests[1].resolve(['a', 'b'])
  await microtasks()
  assert.deepEqual(plain(store.get('tasks').data), ['a', 'b'])
  assert.equal(store.get('tasks').stale, false)
})

test('a response that started before an invalidation never lands', async () => {
  const { store, requests, fetcher } = storeHarness()
  store.subscribe('day', () => {})
  store.register('day', fetcher)
  store.revalidate('day')
  await microtasks()
  store.invalidate((key) => key === 'day')
  await microtasks()
  assert.equal(requests[0].signal.aborted, true)
  requests[0].resolve(['before the edit'])
  requests[1].resolve(['after the edit'])
  await microtasks()
  assert.deepEqual(plain(store.get('day').data), ['after the edit'])
})

test('a failed refresh keeps the data and reports the server message; keys never share data', async () => {
  const { store, requests, fetcher } = storeHarness()
  store.subscribe('a', () => {})
  store.register('a', fetcher)
  store.revalidate('a')
  await microtasks()
  requests[0].resolve({ n: 1 })
  await microtasks()
  store.revalidate('a')
  await microtasks()
  requests[1].reject(new Error('서버가 보낸 문구'))
  await microtasks()
  assert.deepEqual(plain(store.get('a').data), { n: 1 })
  assert.equal(store.get('a').error, '서버가 보낸 문구')
  assert.equal(store.get('b').hasData, false)
  assert.equal(store.get('b').data, undefined)
})

test('unwatched entries go stale on invalidation and refetch only when read again', async () => {
  const { store, requests, fetcher } = storeHarness()
  const off = store.subscribe('day/1', () => {})
  store.register('day/1', fetcher)
  store.revalidate('day/1')
  await microtasks()
  requests[0].resolve([1])
  await microtasks()
  off()
  store.invalidate((key) => key.startsWith('day/'))
  await microtasks()
  assert.equal(requests.length, 1)
  assert.equal(store.get('day/1').stale, true)
  assert.deepEqual(plain(store.get('day/1').data), [1], 'stale data is still this key\'s data')
})

test('setData patches locally and clear forgets every account\'s data', () => {
  const { store } = storeHarness()
  store.setData('list', [1])
  store.setData('list', (previous) => [...previous, 2])
  assert.deepEqual(plain(store.get('list').data), [1, 2])
  store.clear()
  assert.equal(store.get('list').hasData, false)
})

// ---------------------------------------------------------------------------
// useRevalidatingQuery
// ---------------------------------------------------------------------------

const hookHarness = () => {
  const slots = []
  let cursor = 0
  const pending = []
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]))
  const memo = (fn, deps) => {
    const i = cursor++
    const old = slots[i]
    if (!old || !same(old.deps, deps)) slots[i] = { deps, value: fn() }
    return slots[i].value
  }
  const subscriptions = new Map()
  const react = {
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
      if (!subscriptions.has(subscribe)) {
        subscriptions.forEach((off) => off())
        subscriptions.clear()
        subscriptions.set(subscribe, subscribe(() => {}))
      }
      return getSnapshot()
    },
  }
  const window = new EventTarget()
  const events = load('shared/utils/events.ts', {}, { window, CustomEvent })
  const { createQueryStore } = load('shared/utils/queryStore.ts')
  const store = createQueryStore()
  const { useRevalidatingQuery } = load('shared/hooks/useRevalidatingQuery.ts', {
    react,
    '@shared/api/authTokens': { getAccessToken: () => 'token', getTokenSubject: () => 'member-1' },
    '@shared/utils/events': events,
    '@shared/utils/queryStore': { queryStore: store },
  }, { window })
  const requests = []
  const fetcher = (signal) => {
    const request = { signal, ...deferred() }
    requests.push(request)
    return request.promise
  }
  return {
    events,
    requests,
    render(key, options = {}) {
      cursor = 0
      const result = useRevalidatingQuery(key, fetcher, { store, ...options })
      while (pending.length) pending.shift()()
      return result
    },
  }
}

test('useRevalidatingQuery: initial load, refresh keeps data, another key never shows it', async () => {
  const h = hookHarness()
  const first = h.render('tasks?filter=open', { invalidateOn: ['task'] })
  assert.equal(first.isInitialLoading, true)
  assert.equal(first.data, undefined)
  await microtasks()
  h.requests[0].resolve(['a'])
  await microtasks()
  const loaded = h.render('tasks?filter=open', { invalidateOn: ['task'] })
  assert.deepEqual(plain(loaded.data), ['a'])
  assert.equal(loaded.isInitialLoading, false)
  assert.equal(loaded.isRefreshing, false)

  h.events.dispatchTaskChanged(1, 'update')
  h.events.dispatchTaskChanged(1, 'update')
  await settle()
  const refreshing = h.render('tasks?filter=open', { invalidateOn: ['task'] })
  assert.equal(h.requests.length, 2, 'two events in one task refetch once')
  assert.deepEqual(plain(refreshing.data), ['a'])
  assert.equal(refreshing.isRefreshing, true)
  assert.equal(refreshing.isInitialLoading, false)

  const other = h.render('tasks?filter=done', { invalidateOn: ['task'] })
  assert.equal(other.data, undefined, 'a new key starts empty, never with the previous key\'s rows')
  assert.equal(other.isInitialLoading, true)
})

test('useRevalidatingQuery: a failed first load is an error, not a spinner; shouldRefetch filters batches', async () => {
  const h = hookHarness()
  const options = {
    invalidateOn: ['task'],
    shouldRefetch: (batch) => batch.tasks.some((detail) => detail.taskId === 3),
  }
  h.render('task/3', options)
  await microtasks()
  h.requests[0].reject(new Error('작업을 찾을 수 없어요.'))
  await microtasks()
  const failed = h.render('task/3', options)
  assert.equal(failed.isInitialLoading, false)
  assert.equal(failed.error, '작업을 찾을 수 없어요.')
  h.events.dispatchTaskChanged(4, 'update')
  await settle()
  h.render('task/3', options)
  await microtasks()
  assert.equal(h.requests.length, 1, 'a change to another task is ignored')
  h.events.dispatchTaskChanged(3, 'update')
  await settle()
  h.render('task/3', options)
  await microtasks()
  assert.equal(h.requests.length, 2)
})

// ---------------------------------------------------------------------------
// Presence
// ---------------------------------------------------------------------------

const presence = () => load('shared/motion/presence.ts')

test('presenceStep keeps a value through its exit and cancels the exit when it returns', () => {
  const { presenceStep } = presence()
  const task = { id: 1 }
  let state = presenceStep(null, task)
  assert.deepEqual(plain(state), { value: { id: 1 }, closing: false })
  assert.equal(presenceStep(state, task), state, 'no change keeps the same object')
  state = presenceStep(state, null)
  assert.deepEqual(plain(state), { value: { id: 1 }, closing: true })
  assert.equal(presenceStep(state, false), state)
  assert.deepEqual(plain(presenceStep(state, task)), { value: { id: 1 }, closing: false })
  assert.equal(presenceStep(null, false), null)
})

test('list presence: baseline is still, new keys enter, removed keys exit in place, refetch replays nothing', () => {
  const { reconcilePresence, dropExited, nextExitDue } = presence()
  const key = (item) => item.id
  const phases = (entries) => entries.map((entry) => `${entry.key}:${entry.phase}`)
  let entries = reconcilePresence([], [{ id: 1 }, { id: 2 }, { id: 3 }], key, true, 0)
  assert.deepEqual(phases(entries), ['1:present', '2:present', '3:present'])
  entries = reconcilePresence(entries, [{ id: 1 }, { id: 3 }, { id: 4 }], key, false, 1000)
  assert.deepEqual(phases(entries), ['1:present', '2:exit', '3:present', '4:enter'])
  entries = reconcilePresence(entries, [{ id: 1 }, { id: 3 }, { id: 4 }], key, false, 1100)
  assert.deepEqual(phases(entries), ['1:present', '2:exit', '3:present', '4:present'], 'a refetch with the same rows animates nothing')
  assert.equal(entries[1].exitedAt, 1000, 'the exit keeps its start time')
  assert.equal(nextExitDue(entries, 160, 1100), 60)
  assert.deepEqual(phases(dropExited(entries, 160, 1100)), phases(entries))
  assert.deepEqual(phases(dropExited(entries, 160, 1160)), ['1:present', '3:present', '4:present'])
  entries = reconcilePresence(entries, [{ id: 2 }, { id: 1 }, { id: 3 }, { id: 4 }], key, false, 1120)
  assert.deepEqual(phases(entries), ['2:present', '1:present', '3:present', '4:present'], 'a row that comes back while leaving stays put')
  assert.equal(nextExitDue(entries, 160, 1120), null)
})

// ---------------------------------------------------------------------------
// Toasts, surface titles, tween
// ---------------------------------------------------------------------------

test('a repeated toast message updates the visible toast in place; the oldest beyond three is dropped', () => {
  const { upsertToast } = load('shared/contexts/toastList.ts')
  let id = 0
  const next = () => ++id
  let state = upsertToast([], { message: '저장했어요', type: 'success' }, next)
  state = upsertToast(state.list, { message: '실패했어요', type: 'error' }, next)
  const again = upsertToast(state.list, { message: '저장했어요', type: 'info' }, next)
  assert.equal(again.id, 1, 'same message keeps its id, so it does not remount')
  assert.deepEqual(plain(again.list.map((toast) => [toast.id, toast.type])), [[1, 'info'], [2, 'error']])
  const leaving = again.list.map((toast) => (toast.id === 1 ? { ...toast, leaving: true } : toast))
  assert.equal(upsertToast(leaving, { message: '저장했어요' }, next).list[0].leaving, false, 'showing it again cancels the exit')
  state = upsertToast(again.list, { message: 'c' }, next)
  state = upsertToast(state.list, { message: 'd' }, next)
  assert.deepEqual(plain(state.dropped), [1])
  assert.deepEqual(plain(state.list.map((toast) => toast.message)), ['실패했어요', 'c', 'd'])
})

test('surface titles follow the surface path', () => {
  const routing = load('shared/routing/routeSurfaceState.ts')
  assert.equal(routing.surfaceTitle('/app/tasks/new'), '작업 추가')
  assert.equal(routing.surfaceTitle('/app/tasks/12/edit'), '작업 수정')
  assert.equal(routing.surfaceTitle('/app/tasks/12'), '작업 상세')
  assert.equal(routing.surfaceTitle('/app/schedules/new'), '일정 추가')
  assert.equal(routing.surfaceTitle('/app/new'), '일정 추가')
  assert.equal(routing.surfaceTitle('/app/schedules/3/edit'), '일정 수정')
  assert.equal(routing.surfaceTitle('/app/schedules/3/'), '일정 상세')
})

test('number tweens decelerate along --motion-ease and land exactly on the target', () => {
  const { tweenAt } = load('shared/motion/useTweenedNumber.ts', {
    react: {},
    './tokens': load('shared/motion/tokens.ts'),
  })
  assert.equal(tweenAt(10, 20, 0, 240), 10)
  assert.equal(tweenAt(10, 20, 240, 240), 20)
  assert.equal(tweenAt(10, 20, 999, 240), 20)
  assert.equal(tweenAt(10, 20, 50, 0), 20)
  const half = tweenAt(0, 100, 120, 240)
  assert.ok(half > 70 && half < 100, `decelerating curve is past the midpoint at half time (${half})`)
  let previous = -1
  for (let t = 0; t <= 240; t += 12) {
    const value = tweenAt(0, 100, t, 240)
    assert.ok(value >= previous, 'never moves backwards')
    previous = value
  }
})

test('motion tokens in CSS and TS agree', () => {
  const css = readFileSync(new URL('../src/shared/styles/motion.css', import.meta.url), 'utf8')
  const tokens = load('shared/motion/tokens.ts')
  const value = (name) => Number(new RegExp(`--motion-${name}: (\\d+)ms`).exec(css)?.[1])
  assert.equal(value('fast'), tokens.MOTION_FAST_MS)
  assert.equal(value('base'), tokens.MOTION_BASE_MS)
  assert.equal(value('enter'), tokens.MOTION_ENTER_MS)
  assert.equal(value('exit'), tokens.MOTION_EXIT_MS)
  assert.equal(value('status-delay'), tokens.MOTION_STATUS_DELAY_MS)
  assert.match(css, /--motion-ease: cubic-bezier\(0\.2, 0, 0, 1\)/)
  assert.match(css, /--motion-ease-exit: cubic-bezier\(0\.4, 0, 1, 1\)/)
  assert.match(css, /--motion-distance: 8px/)
})

test('under reduced motion, no shared rule whose keyframe travels a fixed distance gets its duration back', () => {
  const css = readFileSync(new URL('../src/shared/styles/motion.css', import.meta.url), 'utf8')
  // Keyframes that move by a fixed amount rather than --motion-distance (which is 0 under reduced motion).
  const travelling = [...css.matchAll(/@keyframes ([\w-]+) \{([^@]*?)\n\}/g)]
    .filter(([, , body]) => /transform/.test(body) && !/--motion-distance/.test(body))
    .map(([, name]) => name)
  assert.deepEqual(travelling.sort(), ['motion-sheet-in', 'motion-sheet-out'])
  const reducedStart = css.indexOf('/* Reduced motion.')
  const before = css.slice(0, reducedStart)
  const reduced = css.slice(reducedStart)
  const rules = (text) =>
    [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({
      selector: selector.trim(),
      body,
    }))
  for (const { selector, body } of rules(before)) {
    const used = travelling.find((name) => new RegExp(`animation:\\s*${name}\\b`).test(body))
    if (!used) continue
    const override = rules(reduced).find((rule) => rule.selector === selector)
    assert.ok(override, `${selector} has a reduced-motion override`)
    assert.match(override.body, /animation-name: motion-fade-(in|out);/, selector)
  }
  assert.match(reduced, /@media \(prefers-reduced-motion: reduce\) and \(max-width: 899px\)/)
})

test('shared keyframes are defined once, in motion.css only', async () => {
  const { readdirSync, statSync } = await import('node:fs')
  const { join } = await import('node:path')
  const root = new URL('../src/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
  const walk = (dir) =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name)
      return statSync(path).isDirectory() ? walk(path) : path.endsWith('.css') ? [path] : []
    })
  const counts = {}
  for (const file of walk(root)) {
    for (const match of readFileSync(file, 'utf8').matchAll(/@keyframes ([\w-]+)/g))
      (counts[match[1]] ??= []).push(file.replace(/\\/g, '/').split('/src/')[1])
  }
  for (const name of ['modalFadeIn', 'modalSlideUp', 'fadeIn', 'fadeSlideIn', 'motion-fade-in', 'motion-rise-in'])
    assert.deepEqual(counts[name], ['shared/styles/motion.css'], name)
})
