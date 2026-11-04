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
const row = (id, date = '2026-11-04') => ({ id, title: `schedule ${id}`, date: { dateTime: `${date}T09:00:00`, zoneId: 'Asia/Seoul' } })
const ids = (result) => Array.from(result.schedules, (s) => s.id)
const settle = async () => { await Promise.resolve(); await Promise.resolve() }
const listHarness = () => {
  const h = hooks(), requests = []
  let notify
  const useList = load('../src/features/schedules/hooks/useScheduleList.ts', {
    react: h.react,
    '@shared/utils/datetime': {
      toDateKey: (date) => dayjs(date.dateTime ?? date).format('YYYY-MM-DD'),
      toApiDateTimeWithZone: (date) => ({ dateTime: date.format('YYYY-MM-DDTHH:mm:ss'), zoneId: 'Asia/Seoul' }),
    },
    '../api/schedules': { fetchSchedules: (date) => {
      const response = deferred(); requests.push({ ...response, date }); return response.promise
    } },
    '@shared/utils/events': { onScheduleChanged: (fn) => { notify = fn; return () => { notify = null } } },
  })
  return { requests, emit: (event) => notify(event), flush: h.flush,
    render(date, flush = true) { h.begin(); const result = useList(dayjs(date)); if (flush) h.flush(); return result },
  }
}

test('a newly selected date never renders the previous date rows before effects run', async () => {
  const h = listHarness()
  h.render('2026-11-04'); h.requests[0].resolve([row(1)]); await settle()
  assert.deepEqual(ids(h.render('2026-11-04')), [1])
  const switched = h.render('2026-11-05', false)
  assert.deepEqual(ids(switched), [])
  assert.equal(switched.isLoading, true)
  h.flush(); h.requests[1].reject(new Error('offline')); await settle()
  const failed = h.render('2026-11-05')
  assert.deepEqual(ids(failed), [])
  assert.equal(failed.error, 'offline')
})

test('rapid date changes ignore out-of-order successful and failed responses', async () => {
  const h = listHarness()
  h.render('2026-11-04'); h.render('2026-11-05'); h.render('2026-11-06')
  h.requests[2].resolve([row(3, '2026-11-06')]); await settle()
  h.requests[1].resolve([row(2, '2026-11-05')]); h.requests[0].reject(new Error('late error')); await settle()
  const result = h.render('2026-11-06')
  assert.deepEqual(ids(result), [3]); assert.equal(result.error, null)
})

test('a date edit invalidates both cached days and rejects a pre-edit read before effect cleanup', async () => {
  const h = listHarness()
  h.render('2026-11-05'); h.requests[0].resolve([row(2, '2026-11-05')]); await settle()
  h.render('2026-11-04'); h.requests[1].resolve([row(1)]); await settle()
  h.render('2026-11-05'); h.requests[2].resolve([row(2, '2026-11-05')]); await settle()
  h.render('2026-11-04') // cached old day, background read is still pending
  h.emit({ schedule: row(1, '2026-11-05'), reason: 'updated' }) // legacy emitter may lack previousDateKey
  h.requests[3].resolve([row(1)]); await settle() // arrives before React can clean up the old effect
  assert.deepEqual(ids(h.render('2026-11-04')), [])
  h.requests[4].resolve([]); await settle()
  assert.deepEqual(ids(h.render('2026-11-04')), [])
  assert.deepEqual(ids(h.render('2026-11-05', false)), []) // stale destination snapshot was invalidated too
  h.flush(); h.requests[5].resolve([row(2, '2026-11-05'), row(1, '2026-11-05')]); await settle()
  assert.deepEqual(ids(h.render('2026-11-05')), [2, 1])
})

test('payload-free changes and repeated same-tick refreshes cannot retain stale data', async () => {
  const h = listHarness()
  h.render('2026-11-04'); h.requests[0].resolve([row(1)]); await settle()
  h.render('2026-11-04')
  h.emit({ reason: 'restore' }); h.emit({ reason: 'recurrence' })
  const pending = h.render('2026-11-04')
  assert.equal(pending.isLoading, true); assert.deepEqual(ids(pending), [])
  h.requests[1].resolve([row(2)]); await settle()
  h.render('2026-11-04').refetch(); h.render('2026-11-04')
  assert.equal(h.requests.length, 3)
  h.requests[2].resolve([]); await settle()
  assert.deepEqual(ids(h.render('2026-11-04')), [])
})

const dragHarness = () => {
  const h = hooks(), moves = [], captures = new Set(), captureLog = []
  let refreshed = 0
  const scroller = { overflowY: 'auto', scrollTop: 0, parentElement: null }
  const element = {
    overflowY: 'visible', scrollTop: 0, parentElement: scroller,
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
  return { moves, captures, captureLog, event, scroller,
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
