import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

// Motion and flicker rules for the schedules area (docs/motion/README.md, flicker-audit A1-A8, B3).

const source = (path) => readFileSync(new URL('../src/' + path, import.meta.url), 'utf8')
const load = (path, dependencies, globals = {}) => {
  const output = ts.transpileModule(source(path), {
    fileName: path,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  const module = { exports: {} }
  vm.runInNewContext(output, {
    module, exports: module.exports, Error, setTimeout, clearTimeout, queueMicrotask, ...globals,
    require: (name) => {
      if (name === '@shared/api/errorMessage' && !(name in dependencies))
        return load('shared/api/errorMessage.ts', {})
      assert.ok(name in dependencies, 'Unexpected dependency ' + name)
      return dependencies[name]
    },
  })
  return module.exports
}
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const settle = () => new Promise((resolve) => setImmediate(resolve))
const statefulReact = () => {
  const slots = [], effects = []
  let cursor = 0, effectCursor = 0
  return {
    begin() { cursor = 0; effectCursor = 0 },
    react: {
      useState(initial) {
        const i = cursor++
        if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial
        return [slots[i], (next) => { slots[i] = typeof next === 'function' ? next(slots[i]) : next }]
      },
      useRef(initial) {
        const i = cursor++
        if (!(i in slots)) slots[i] = { current: initial }
        return slots[i]
      },
      useEffect(effect, deps) {
        const i = effectCursor++
        const previous = effects[i]
        if (!previous || deps.some((value, index) => value !== previous.deps[index])) {
          previous?.cleanup?.()
          effects[i] = { deps, cleanup: effect() }
        }
      },
      useMemo: (calculate) => calculate(),
    },
    cleanup() { effects.forEach((effect) => effect?.cleanup?.()) },
  }
}

// ---------------------------------------------------------------------------
// ScheduleCard actions: optimistic state, per-card lock (audit A4, A5)
// ---------------------------------------------------------------------------

const actionsHarness = ({ pending = null } = {}) => {
  const h = statefulReact()
  let pendingId = pending
  const requests = [], toasts = []
  const cache = {
    schedulesById: {
      9: { id: 9, version: 1, state: 'NOT_STARTED', allowedActions: { complete: true, start: true } },
    },
    get pendingScheduleId() { return pendingId },
    activeScheduleId: null,
    beginMutation: (id) => {
      if (pendingId !== null) return false
      pendingId = id
      return true
    },
    endMutation: (id) => { if (pendingId === id) pendingId = null },
    setActiveSchedule() {},
    setSchedule(schedule) { cache.schedulesById = { ...cache.schedulesById, [schedule.id]: schedule } },
  }
  let response = deferred()
  const useActions = load('features/schedules/hooks/useScheduleActions.ts', {
    react: h.react,
    '../api/schedules.ts': {
      completeSchedule: (id) => { requests.push(['complete', id]); return response.promise },
      fetchScheduleDetail: async (id) => cache.schedulesById[id],
    },
    '@features/spaces/metadata': { getMetadata: () => undefined },
    '@features/spaces/conflicts': { CONFLICT_RELOADED: 'reloaded', isEditConflict: () => false },
    '@features/auth/api/member': { fetchActiveScheduleId: async () => null },
    '@contexts/ScheduleCacheContext': { useScheduleCache: () => cache },
    '@contexts/ToastContext': { useToast: () => ({ addToast: (...args) => toasts.push(args) }) },
    '@shared/utils/events': { dispatchScheduleChanged() {} },
    '@shared/utils/scheduleTaskSync': { useScheduleTaskSync: () => ({ syncTaskStateWithSchedule: async () => {} }) },
  }, { console: { error() {}, warn() {} } }).default
  return {
    requests, toasts, cache,
    response: () => response,
    render() { h.begin(); return useActions(9, 'NOT_STARTED') },
  }
}

test('completing shows the saved state at once and keeps it when the save lands', async () => {
  const h = actionsHarness()
  const saving = h.render().complete()
  const during = h.render()
  assert.equal(during.currentState, 'COMPLETED', 'the card answers the click before the server does')
  assert.equal(during.isMutating, true)
  h.response().resolve({ id: 9, version: 2, state: 'COMPLETED', allowedActions: {} })
  await saving
  const after = h.render()
  assert.equal(after.currentState, 'COMPLETED')
  assert.equal(after.isMutating, false)
})

test('a failed completion rolls the shown state back and passes the server message through', async () => {
  const h = actionsHarness()
  const saving = h.render().complete()
  assert.equal(h.render().currentState, 'COMPLETED')
  h.response().reject(Object.assign(new Error('서버가 거절했어요'), { name: 'ApiError', status: 400 }))
  await saving
  const after = h.render()
  assert.equal(after.currentState, 'NOT_STARTED')
  assert.equal(after.lastError, '서버가 거절했어요')
})

test('another schedule saving locks this card without marking it busy', async () => {
  const h = actionsHarness({ pending: 4 })
  const card = h.render()
  assert.equal(card.isMutating, false, 'only the saving card is busy, so the others never dim')
  assert.equal(card.isLocked, true)
  await card.complete()
  assert.deepEqual(h.requests, [], 'the shared lock still serialises schedule changes')
  assert.equal(h.render().currentState, 'NOT_STARTED')
})

// ---------------------------------------------------------------------------
// ScheduleDetailModal: seed from the cache, keep content on a failed refresh (A7)
// ---------------------------------------------------------------------------

const detailHarness = (cached, others = {}) => {
  const h = statefulReact()
  let reads = 0
  // One provider value, as the real context gives between renders.
  const cache = { setSchedule() {}, schedulesById: { ...(cached ? { 8: cached } : {}), ...others } }
  const listeners = new Set()
  let response = deferred()
  const useDetail = load('features/schedules/hooks/useScheduleDetail.ts', {
    react: h.react,
    '@shared/utils/events': {
      onScheduleChanged: (listener) => { listeners.add(listener); return () => listeners.delete(listener) },
    },
    '../api/schedules': { fetchScheduleDetail: () => { reads++; return response.promise } },
    '@contexts/ScheduleCacheContext': {
      useScheduleCache: () => cache,
    },
  }, { window: new EventTarget() }).default
  return {
    next(value) { response = deferred(); for (const listener of listeners) listener({ scheduleId: 8 }); return response },
    fresh() { response = deferred(); return response },
    reads: () => reads,
    emit(details) { for (const listener of listeners) listener(details[0], details) },
    response: () => response,
    render(options, id = '8') { h.begin(); return useDetail(id, options) },
    cleanup: () => h.cleanup(),
  }
}

test('the detail opens on the cached schedule instead of a loading line, then refreshes it', async () => {
  const h = detailHarness({ id: 8, title: '목록에서', version: 3 })
  const opened = h.render()
  assert.equal(opened.isLoading, false)
  assert.equal(opened.isRefreshing, true)
  assert.equal(opened.schedule.title, '목록에서')
  h.response().resolve({ id: 8, title: '서버에서', version: 4 })
  await settle()
  const loaded = h.render()
  assert.equal(loaded.schedule.title, '서버에서')
  assert.equal(loaded.isRefreshing, false)
  h.cleanup()
})

test('a failed refresh keeps the schedule; only a gone schedule drops it', async () => {
  const h = detailHarness(null)
  h.render()
  h.response().resolve({ id: 8, title: '처음', version: 1 })
  await settle()
  assert.equal(h.render().schedule.title, '처음')
  h.next().reject(Object.assign(new Error('잠시 연결이 끊겼어요'), { status: 503 }))
  h.render()
  await settle()
  const outage = h.render()
  assert.equal(outage.schedule.title, '처음', 'an outage never blanks the modal')
  assert.equal(outage.error, '잠시 연결이 끊겼어요')
  h.next().reject(Object.assign(new Error('일정을 찾을 수 없어요'), { status: 404 }))
  h.render()
  await settle()
  assert.equal(h.render().schedule, null)
  h.cleanup()
})

test('a failed first read for another id never shows the schedule of the previous id', async () => {
  const h = detailHarness(null, { 9: { id: 9, title: '캐시의 9', version: 2 } })
  h.render()
  h.response().resolve({ id: 8, title: '여덟', version: 5 })
  await settle()
  assert.equal(h.render().schedule.title, '여덟')
  h.fresh().reject(Object.assign(new Error('잠시 연결이 끊겼어요'), { status: 503 }))
  h.render(undefined, '9')
  await settle()
  const failed = h.render(undefined, '9')
  assert.equal(failed.schedule.title, '캐시의 9', 'an outage keeps the cached copy of this id, never id 8')
  assert.equal(failed.error, '잠시 연결이 끊겼어요')
  h.cleanup()
})

test('deleting the schedule shown does not read it again while the detail closes', async () => {
  const h = detailHarness(null)
  h.render()
  h.response().resolve({ id: 8, title: '지울 일정', version: 1 })
  await settle()
  h.render()
  const reads = h.reads()
  h.emit([{ scheduleId: 8, reason: 'deleted' }])
  h.render()
  await settle()
  assert.equal(h.reads(), reads, 'its own delete is not read back (it would answer 404)')
  assert.equal(h.render().schedule.title, '지울 일정', 'the closing modal keeps its content')
  // Any other change still refreshes it.
  h.emit([{ scheduleId: 8, reason: 'state-mutated' }])
  h.render()
  assert.equal(h.reads(), reads + 1)
  h.cleanup()
})

test('an edit session never seeds from the cache: its form and version come from its own read', () => {
  const h = detailHarness({ id: 8, title: '목록에서', version: 3 })
  const editing = h.render({ refreshOnChange: false })
  assert.equal(editing.schedule, null)
  assert.equal(editing.isLoading, true)
  h.cleanup()
})

// ---------------------------------------------------------------------------
// ScheduleCacheContext: identical reads do not re-render every consumer (audit B5)
// ---------------------------------------------------------------------------

test('writing the same revision again keeps the cache map, a changed one replaces it', () => {
  const states = []
  let cursor = 0
  const { ScheduleCacheProvider } = load('shared/contexts/ScheduleCacheContext.tsx', {
    react: {
      createContext: () => ({ Provider: 'provider' }),
      useEffect() {},
      useState(initial) {
        const index = cursor++
        if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial
        return [states[index], (next) => { states[index] = typeof next === 'function' ? next(states[index]) : next }]
      },
      useRef(initial) {
        const index = cursor++
        if (!(index in states)) states[index] = { current: initial }
        return states[index]
      },
      useCallback: (fn) => fn,
      useMemo: (fn) => fn(),
    },
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }) },
    '@features/spaces/metadata': { isSpaceUnavailable: () => false, isResourceUnavailable: () => false },
  })
  const render = () => { cursor = 0; return ScheduleCacheProvider({ children: null }).props.value }
  const schedule = { id: 3, version: 2, state: 'NOT_STARTED', allowedActions: { edit: true } }
  render().setSchedule(schedule)
  const first = render().schedulesById
  render().setSchedule({ ...schedule, allowedActions: { edit: true } })
  assert.equal(render().schedulesById, first, 'a list read of the same revision changes nothing')
  render().setSchedule({ ...schedule, version: 3, state: 'COMPLETED' })
  assert.notEqual(render().schedulesById, first)
  assert.equal(render().schedulesById[3].state, 'COMPLETED')
})

// ---------------------------------------------------------------------------
// Source contracts that keep the flicker fixes in place
// ---------------------------------------------------------------------------

const cssFiles = (dir) =>
  readdirSync(new URL('../src/' + dir, import.meta.url), { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? cssFiles(`${dir}/${entry.name}`) : entry.name.endsWith('.css') ? [`${dir}/${entry.name}`] : [],
  )

test('schedule styles name what they transition, never scale on hover and never loop', () => {
  for (const file of cssFiles('features/schedules')) {
    const css = source(file)
    assert.doesNotMatch(css, /transition:\s*all/, `${file} uses transition: all`)
    assert.doesNotMatch(css, /infinite/, `${file} loops an animation`)
    assert.doesNotMatch(css, /:hover[^{]*\{[^}]*scale\(1\.\d+\)/, `${file} scales on hover`)
  }
  // Page roots and the list container do not replay a mount animation on every visit.
  const page = source('features/schedules/pages/tab/SchedulesTabPage.css')
  assert.doesNotMatch(page, /\.schedules-tab__list\s*\{[^}]*animation\s*:/)
  assert.doesNotMatch(page, /\.schedules-tab__weekly-stats\s*\{[^}]*animation\s*:/)
  assert.doesNotMatch(source('features/schedules/pages/form/ScheduleFormPage.css'), /\.schedule-form-page\s*\{[^}]*animation\s*:/)
})

test('the schedules tab never blanks its list for a refresh, the week dots or the overdue banner', () => {
  const page = source('features/schedules/pages/tab/SchedulesTabPage.tsx')
  assert.doesNotMatch(page, /isPresenceLoading/, 'the week dots loading must not blank the day list')
  assert.doesNotMatch(page, /미완료 일정 정보를 불러오는 중/, 'the overdue banner has no loading panel that pushes the page')
  assert.match(page, /scheduleErrorRaw && !hasDayData/, 'an error replaces the list only when the day has no rows')
  assert.match(page, /useListPresence\(/)
  // B3: a move dispatches one change and does not also refetch every view by hand.
  for (const handler of ['handleMoveSchedule', 'handleShiftScheduleTime']) {
    const body = page.slice(page.indexOf(`const ${handler}`), page.indexOf('} finally', page.indexOf(`const ${handler}`)))
    assert.match(body, /dispatchScheduleChanged\(/, handler)
    assert.doesNotMatch(body, /refetch(Schedules|Overdue|WeeklyStats)\(\)/, `${handler} refetches after its dispatch`)
  }
  // A time shift past midnight takes the card off this day instead of leaving it here.
  const shift = page.slice(page.indexOf('const handleShiftScheduleTime'))
  assert.match(shift, /toDateKey\(updated\.date\) === previousDateKey/)
})

test('the schedule card completes with the shared check and strike, from the actions state', () => {
  const card = source('features/schedules/components/ScheduleCard.tsx')
  assert.match(card, /const state = actions\.currentState/)
  assert.match(card, /className="motion-strike" data-done=/)
  assert.match(card, /<ScheduleCompletionMark/)
  assert.doesNotMatch(card, /disabled=\{[^}]*isMutating[^}]*\}\s*\n\s*>\s*\n\s*<WorkspaceIcon name="check"/)
  assert.match(source('features/schedules/components/ScheduleCompletionMark.tsx'), /<CompletionCheck/)
  const player = source('features/schedules/components/MiniPlayerBar.tsx')
  assert.match(player, /usePresence\(/, 'the mini player slides out instead of returning null at once')
  // The controls are disabled by permission only; a pending save never dims the bar. While it
  // saves, the cached permissions belong to the old state, so they do not disable it either.
  assert.doesNotMatch(player, /disabled=\{[^}]*isMutating \|\||\|\| scheduleActions\.isMutating/)
  const controls = player.slice(player.indexOf('mini-player__buttons'), player.indexOf('mini-player__error'))
  assert.equal((controls.match(/disabled=\{/g) ?? []).length, 3)
  for (const control of controls.match(/disabled=\{[^}]*\}/g) ?? [])
    assert.match(control, /!saving &&/, `${control} dims the bar while it saves`)
  // The same holds for the card's completed mark: it is drawn before the save lands.
  assert.match(card, /disabled=\{!actions\.canCancel && !actions\.isMutating\}/)
})
