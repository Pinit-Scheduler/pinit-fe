import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import dayjs from 'dayjs'

const hooks = () => {
  const slots = []
  let cursor = 0, pending = []
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]))
  const memo = (fn, deps) => {
    const i = cursor++, old = slots[i]
    if (!old || !same(old.deps, deps)) slots[i] = { deps, value: fn() }
    return slots[i].value
  }
  return {
    begin() { cursor = 0 },
    flush() { const queue = pending; pending = []; queue.forEach((fn) => fn()) },
    react: {
      useState(initial) {
        const i = cursor++
        if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial
        return [slots[i], (value) => { slots[i] = typeof value === 'function' ? value(slots[i]) : value }]
      },
      useRef(initial) {
        const i = cursor++
        if (!(i in slots)) slots[i] = { current: initial }
        return slots[i]
      },
      useMemo: memo,
      useCallback: (fn, deps) => memo(() => fn, deps),
      useEffect(fn, deps) {
        const i = cursor++, old = slots[i]
        if (old && same(old.deps, deps)) return
        slots[i] = { deps }
        pending.push(() => { old?.cleanup?.(); slots[i].cleanup = fn() })
      },
    },
  }
}
const load = (file, deps, globals = {}) => {
  const { outputText } = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  const module = { exports: {} }
  vm.runInNewContext(outputText, { module, exports: module.exports, Error, ...globals,
    require(name) { assert.ok(name in deps, name); return deps[name] },
  })
  return module.exports.default
}
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const loadModule = (file, deps, globals = {}) => {
  const { outputText } = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  const module = { exports: {} }
  vm.runInNewContext(outputText, {
    module, exports: module.exports, Error, AbortController, queueMicrotask, setTimeout, clearTimeout, Date,
    ...globals,
    require(name) { assert.ok(name in deps, name); return deps[name] },
  })
  return module.exports
}
const row = (id, date = '2026-11-04') => ({ id, title: `schedule ${id}`, date: { dateTime: `${date}T09:00:00`, zoneId: 'Asia/Seoul' } })
const ids = (result) => Array.from(result.schedules, (s) => s.id)
const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve() }
// Change events are coalesced to the end of the task, so let a timer pass after a dispatch.
const afterEvents = () => new Promise((resolve) => setTimeout(resolve, 5))

// useScheduleList now runs on useRevalidatingQuery: these tests load the real query hook, store and
// events, and only fake React's scheduling. They replace the old "a refetch shows nothing" rule:
// a refetch keeps this day's rows on screen, and the rule that a pre-edit read must not land stays.
const listHarness = () => {
  const slots = []
  let cursor = 0
  const pending = []
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]))
  const memo = (fn, deps) => {
    const i = cursor++, old = slots[i]
    if (!old || !same(old.deps, deps)) slots[i] = { deps, value: fn() }
    return slots[i].value
  }
  const subscriptions = new Map()
  const react = {
    useRef(initial) {
      const i = cursor++
      if (!(i in slots)) slots[i] = { current: initial }
      return slots[i]
    },
    useCallback: (fn, deps) => memo(() => fn, deps),
    useEffect(fn, deps) {
      const i = cursor++, old = slots[i]
      if (old && deps && same(old.deps, deps)) return
      slots[i] = { deps }
      pending.push(() => { old?.cleanup?.(); slots[i].cleanup = fn() })
    },
    useSyncExternalStore(subscribe, getSnapshot) {
      if (!subscriptions.has(subscribe)) {
        subscriptions.forEach((off) => off())
        subscriptions.clear()
        subscriptions.set(subscribe, subscribe(() => {}))
      }
      return getSnapshot()
    },
  }
  const window = new EventTarget()
  const events = loadModule('../src/shared/utils/events.ts', {}, { window, CustomEvent })
  const { createQueryStore } = loadModule('../src/shared/utils/queryStore.ts', {})
  const store = createQueryStore()
  const errorMessage = loadModule('../src/shared/api/errorMessage.ts', {})
  const query = loadModule('../src/shared/hooks/useRevalidatingQuery.ts', {
    '@shared/api/errorMessage': errorMessage,
    react,
    '@shared/api/authTokens': { getAccessToken: () => 'token', getTokenSubject: () => 'member-1' },
    '@shared/utils/events': events,
    '@shared/utils/queryStore': { queryStore: store },
  }, { window })
  const requests = []
  const scope = { selectedSpaceId: null, selectedProjectId: null }
  const useList = loadModule('../src/features/schedules/hooks/useScheduleList.ts', {
    '@shared/utils/datetime': {
      toDateKey: (date) => dayjs(date.dateTime ?? date).format('YYYY-MM-DD'),
      toApiDateTimeWithZone: (date) => ({ dateTime: date.format('YYYY-MM-DDTHH:mm:ss'), zoneId: 'Asia/Seoul' }),
    },
    '../api/schedules': { fetchSchedules: (date) => {
      const response = deferred(); requests.push({ ...response, day: date.dateTime.slice(0, 10) }); return response.promise
    } },
    '@shared/hooks/useRevalidatingQuery': query,
    '@shared/api/errorMessage': errorMessage,
    '@features/spaces/store': { useSpaces: () => scope },
  }).default
  return {
    requests, scope, events,
    /** The latest read for a day. */
    last: (day) => requests.filter((request) => request.day === day).at(-1),
    async render(date) {
      cursor = 0
      const result = useList(dayjs(date))
      while (pending.length) pending.shift()()
      await settle()
      return result
    },
    /** One render as React would paint it, before effects or microtasks run. */
    renderNow(date) { cursor = 0; return useList(dayjs(date)) },
  }
}

test('a newly selected date never renders the previous date rows, even before effects run', async () => {
  const h = listHarness()
  await h.render('2026-11-04'); h.last('2026-11-04').resolve([row(1)]); await settle()
  assert.deepEqual(ids(await h.render('2026-11-04')), [1])
  const switched = h.renderNow('2026-11-05')
  assert.deepEqual(ids(switched), [])
  assert.equal(switched.isLoading, true)
  assert.equal(switched.data, undefined)
  // 응답이 오지 않은 실패: httpClient는 네트워크 오류를 status 0인 ApiError로 던진다.
  await h.render('2026-11-05'); h.last('2026-11-05').reject(Object.assign(new Error('offline'), { name: 'ApiError', status: 0 })); await settle()
  const failed = await h.render('2026-11-05')
  assert.deepEqual(ids(failed), [])
  assert.equal(failed.isLoading, false, 'a failed first load is an error, not a spinner')
  assert.equal(failed.error, '일정을 불러오지 못했어요. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.')
})

test('rapid date changes never mix days, whatever order the responses arrive in', async () => {
  const h = listHarness()
  await h.render('2026-11-04'); await h.render('2026-11-05'); await h.render('2026-11-06')
  h.last('2026-11-06').resolve([row(3, '2026-11-06')]); await settle()
  h.last('2026-11-05').resolve([row(2, '2026-11-05')]); h.last('2026-11-04').reject(new Error('late error')); await settle()
  const result = await h.render('2026-11-06')
  assert.deepEqual(ids(result), [3]); assert.equal(result.error, null)
  // Leaving a day before its first load finished abandoned that load. Going back starts over
  // with a loading state, never with another day's rows.
  const back = await h.render('2026-11-05')
  assert.deepEqual(ids(back), []); assert.equal(back.isLoading, true)
})

test('a schedule change keeps the day on screen while it refreshes and drops a pre-edit read', async () => {
  const h = listHarness()
  await h.render('2026-11-05'); h.last('2026-11-05').resolve([row(2, '2026-11-05')]); await settle()
  await h.render('2026-11-04'); h.last('2026-11-04').resolve([row(1)]); await settle()
  const cached = await h.render('2026-11-04') // revisit: cached rows at once, background read pending
  assert.deepEqual(ids(cached), [1])
  const preEdit = h.last('2026-11-04')
  h.events.dispatchScheduleChanged({ schedule: row(1, '2026-11-05'), reason: 'updated' }) // may lack previousDateKey
  await afterEvents()
  preEdit.resolve([row(1), row(99)]); await settle() // started before the edit: must not land
  const refreshing = await h.render('2026-11-04')
  assert.deepEqual(ids(refreshing), [1], 'the rows stay; nothing blanks and the pre-edit read is dropped')
  assert.equal(refreshing.isLoading, false)
  assert.equal(refreshing.isRefreshing, true)
  assert.notEqual(h.last('2026-11-04'), preEdit, 'the change started a fresh read')
  h.last('2026-11-04').resolve([]); await settle()
  assert.deepEqual(ids(await h.render('2026-11-04')), [])
  // The destination day was cached too. It went stale and reads again when it is shown.
  await h.render('2026-11-05')
  const destination = h.renderNow('2026-11-05')
  assert.deepEqual(ids(destination), [2]); assert.equal(destination.isRefreshing, true)
  h.last('2026-11-05').resolve([row(2, '2026-11-05'), row(1, '2026-11-05')]); await settle()
  assert.deepEqual(ids(await h.render('2026-11-05')), [2, 1])
})

test('several changes in one task refetch once, and refetch() forces a fresh read', async () => {
  const h = listHarness()
  await h.render('2026-11-04'); h.last('2026-11-04').resolve([row(1)]); await settle()
  const before = h.requests.length
  h.events.dispatchScheduleChanged({ reason: 'restore' }); h.events.dispatchScheduleChanged({ reason: 'recurrence' })
  await afterEvents()
  const pending = await h.render('2026-11-04')
  assert.equal(h.requests.length, before + 1, 'payload-free changes in one task read once')
  assert.deepEqual(ids(pending), [1]); assert.equal(pending.isRefreshing, true)
  h.last('2026-11-04').resolve([row(2)]); await settle()
  const loaded = await h.render('2026-11-04')
  assert.deepEqual(ids(loaded), [2])
  loaded.refetch(); await settle()
  assert.equal(h.requests.length, before + 2)
  h.last('2026-11-04').resolve([]); await settle()
  assert.deepEqual(ids(await h.render('2026-11-04')), [])
})

test('another space is another key: its day never shows the previous space rows', async () => {
  const h = listHarness()
  await h.render('2026-11-04'); h.last('2026-11-04').resolve([row(1)]); await settle()
  h.scope.selectedSpaceId = 7
  const other = h.renderNow('2026-11-04')
  assert.deepEqual(ids(other), []); assert.equal(other.isLoading, true)
})

const dragHarness = () => {
  const h = hooks(), moves = [], captures = new Set(), captureLog = []
  let refreshed = 0
  const scroller = { overflowY: 'auto', scrollTop: 0, parentElement: null }
  const style = new Map()
  const element = {
    overflowY: 'visible', scrollTop: 0, parentElement: scroller,
    style: { setProperty: (name, value) => style.set(name, value), removeProperty: (name) => style.delete(name) },
    getBoundingClientRect: () => ({ left: 260, right: 1054, width: 794 }),
    setPointerCapture(id) { captures.add(id); captureLog.push(['capture', id]) },
    hasPointerCapture: (id) => captures.has(id),
    releasePointerCapture(id) { captures.delete(id); captureLog.push(['release', id]) },
  }
  const useDrag = load('../src/features/schedules/hooks/useScheduleDrag.ts', { react: h.react }, {
    window: { innerWidth: 1110 }, getComputedStyle: (el) => ({ overflowY: el.overflowY }),
  })
  const event = (x, y, extra = {}) => ({
    pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1,
    clientX: x, clientY: y, currentTarget: element, target: { closest: () => null },
    preventDefault() { this.prevented = true }, stopPropagation() { this.stopped = true }, ...extra,
  })
  return { moves, captures, captureLog, event, scroller, style,
    get refreshed() { return refreshed },
    render(extra = {}) { h.begin(); const result = useDrag({ containerRef: { current: element }, hasItems: true,
      onMove: (...args) => moves.push(args), onRefresh: () => refreshed++, resetKey: '2026-11-04', ...extra }); h.flush(); return result },
  }
}

test('horizontal drag captures the pointer and drops at list edges outside the original card', () => {
  const h = dragHarness(), handlers = h.render().getItemHandlers(row(1))
  handlers.onPointerDown(h.event(450, 300)); handlers.onPointerMove(h.event(400, 302))
  assert.equal(h.captures.has(1), true)
  handlers.onPointerLeave?.() // crossing the card boundary must not cancel the gesture
  handlers.onPointerUp(h.event(280, 302)) // list left edge, far from viewport left
  assert.equal(h.moves.length, 1); assert.equal(h.moves[0][1], -1)
  assert.equal(h.captures.size, 0)
  const click = h.event(280, 302); handlers.onClickCapture(click)
  assert.equal(click.prevented, true); assert.equal(click.stopped, true)
})

test('release position determines the next-day drop even before move state renders', () => {
  const h = dragHarness(), handlers = h.render().getItemHandlers(row(1))
  handlers.onPointerDown(h.event(450, 300)); handlers.onPointerMove(h.event(500, 302))
  handlers.onPointerUp(h.event(1040, 302))
  assert.equal(h.moves.length, 1); assert.equal(h.moves[0][1], 1)
})

test('a click near an edge and a vertical scrolling gesture never move a schedule', () => {
  const h = dragHarness(), handlers = h.render().getItemHandlers(row(1))
  handlers.onPointerDown(h.event(280, 300)); handlers.onPointerUp(h.event(280, 300))
  handlers.onPointerDown(h.event(280, 300)); handlers.onPointerMove(h.event(282, 360)); handlers.onPointerUp(h.event(282, 360))
  assert.equal(h.moves.length, 0); assert.equal(h.captures.size, 0)
})

test('cancel, lost capture, and date changes release the pointer without applying a move', () => {
  for (const reason of ['cancel', 'lost', 'date']) {
    const h = dragHarness(), handlers = h.render().getItemHandlers(row(1))
    handlers.onPointerDown(h.event(450, 300)); handlers.onPointerMove(h.event(400, 300))
    if (reason === 'cancel') handlers.onPointerCancel()
    if (reason === 'lost') handlers.onLostPointerCapture()
    if (reason === 'date') h.render({ resetKey: '2026-11-05' })
    handlers.onPointerUp(h.event(280, 300))
    assert.equal(h.moves.length, 0, reason); assert.equal(h.captures.size, 0, reason)
  }
})

test('controls, right mouse buttons, and disabled lists cannot start date moves', () => {
  for (const reason of ['control', 'right', 'disabled']) {
    const h = dragHarness(), handlers = h.render({ disabled: reason === 'disabled' }).getItemHandlers(row(1))
    const extra = reason === 'control' ? { target: { closest: () => ({ classList: { contains: () => false } }) } }
      : reason === 'right' ? { button: 2 } : {}
    handlers.onPointerDown(h.event(450, 300, extra)); handlers.onPointerMove(h.event(400, 300)); handlers.onPointerUp(h.event(280, 300))
    assert.equal(h.moves.length, 0, reason)
  }
})

test('releasing outside before activation cannot leave a ghost drag', () => {
  const h = dragHarness(), handlers = h.render().getItemHandlers(row(1))
  handlers.onPointerDown(h.event(450, 300)); handlers.onPointerMove(h.event(400, 300, { buttons: 0 }))
  handlers.onPointerUp(h.event(280, 300))
  assert.equal(h.moves.length, 0); assert.equal(h.captures.size, 0)
})

test('touch refresh checks the actual page scroller after the grid layout migration', () => {
  const h = dragHarness(), actions = h.render().containerTouchHandlers
  h.scroller.scrollTop = 100
  actions.onTouchStart({ touches: [{ clientY: 100 }] }); actions.onTouchMove({ touches: [{ clientY: 200 }] }); actions.onTouchEnd()
  assert.equal(h.refreshed, 0)
  h.scroller.scrollTop = 0
  actions.onTouchStart({ touches: [{ clientY: 100 }] }); actions.onTouchMove({ touches: [{ clientY: 200 }] }); actions.onTouchEnd()
  assert.equal(h.refreshed, 1)
})

test('a dragged card leans toward the pointer, capped, and settles back when released', () => {
  const h = dragHarness(), handlers = h.render().getItemHandlers(row(1))
  handlers.onPointerDown(h.event(450, 300)); handlers.onPointerMove(h.event(400, 302))
  assert.equal(h.style.get('--schedule-drag-x'), `${Math.round(-50 * 0.35)}px`)
  handlers.onPointerMove(h.event(100, 302))
  assert.equal(h.style.get('--schedule-drag-x'), '-48px', 'the lean is capped')
  handlers.onPointerUp(h.event(450, 302))
  assert.equal(h.style.has('--schedule-drag-x'), false, 'released cards ease back to their place')
})
