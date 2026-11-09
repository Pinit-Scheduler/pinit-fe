import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const read = (path) => readFileSync(new URL('../src/' + path, import.meta.url), 'utf8')

function load(path, dependencies = {}) {
  const output = ts.transpileModule(read(path), {
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
    Map,
    Set,
    require: (name) => {
      assert.ok(name in dependencies, 'Unexpected dependency ' + name)
      return dependencies[name]
    },
  })
  return module.exports
}

const settle = load('features/today/settle.ts', {
  react: { useEffect() {}, useState() {} },
  '@shared/motion/tokens': { MOTION_ENTER_MS: 240 },
})
const key = (task) => task.id
const ids = (list) => (list ? Array.from(list, (task) => task.id) : list)
const task = (id, completed = false) => ({ id, completed })

// ---------------------------------------------------------------------------
// Holding a completed row before it leaves the ready list
// ---------------------------------------------------------------------------

test('a task completed out of the ready list is held where it was, then released', () => {
  const first = [task(1), task(2), task(3)]
  let state = settle.initialSettle(first, 'day')
  const done = new Set([2])
  const next = [task(1), task(3)]
  state = settle.settleStep(state, next, 'day', key, (t) => done.has(t.id), 1000, 480)
  assert.deepEqual(ids(state.shown), [1, 2, 3], 'the completed row stays at its position')
  assert.equal(settle.nextRelease(state.heldUntil, 1000), 480)

  const early = settle.releaseSettled(state, key, 1200)
  assert.equal(early, state, 'nothing changes before the hold ends')
  const released = settle.releaseSettled(state, key, 1480)
  assert.deepEqual(ids(released.shown), [1, 3])
  assert.equal(released.shown, next, 'with nothing held the received list is shown as is')
  assert.equal(settle.nextRelease(released.heldUntil, 1480), null)
})

test('rows removed for other reasons leave at once', () => {
  let state = settle.initialSettle([task(1), task(2)], 'day')
  const next = [task(1)]
  state = settle.settleStep(state, next, 'day', key, () => false, 0)
  assert.equal(state.shown, next)
  assert.equal(state.heldUntil.size, 0)
})

test('a held row keeps its first deadline across refetches and comes back when reopened', () => {
  let state = settle.initialSettle([task(1), task(2)], 'day')
  state = settle.settleStep(state, [task(1)], 'day', key, () => true, 0, 480)
  // Another refetch with the same ids does not extend the hold.
  state = settle.settleStep(state, [task(1)], 'day', key, () => true, 100, 480)
  assert.equal(state.heldUntil.get('2'), 480)
  assert.deepEqual(ids(state.shown), [1, 2])
  // Reopened: the server lists it again, so it is a normal row and no longer held.
  const back = [task(1), task(2)]
  state = settle.settleStep(state, back, 'day', key, () => false, 200, 480)
  assert.equal(state.shown, back)
  assert.equal(state.heldUntil.size, 0)
})

test('a new day starts a new baseline instead of holding the old day', () => {
  let state = settle.initialSettle([task(1), task(2)], 'mon')
  const tuesday = [task(7)]
  state = settle.settleStep(state, tuesday, 'tue', key, () => true, 0)
  assert.equal(state.shown, tuesday)
  assert.equal(state.heldUntil.size, 0)
  const unknown = settle.settleStep(state, undefined, 'wed', key, () => true, 0)
  assert.equal(unknown.shown, undefined, 'no data for the new key shows nothing from the old one')
})

test('the same list object returns the same state', () => {
  const list = [task(1)]
  const state = settle.initialSettle(list, 'day')
  assert.equal(settle.settleStep(state, list, 'day', key, () => true, 0), state)
})

test('the hold covers the completion stroke', () => {
  // The strike line starts 80ms after the click and draws for 240ms.
  assert.ok(settle.SETTLE_HOLD_MS >= 80 + 240)
})

// ---------------------------------------------------------------------------
// TodayPage keeps its panels through refreshes (audit A8 / pages 2)
// ---------------------------------------------------------------------------

const page = read('features/today/pages/TodayPage.tsx')
const css = read('features/today/pages/TodayPage.css')

test('Today keys its data on the day, not on a refresh counter', () => {
  assert.doesNotMatch(page, /refresh/i, 'no refresh counter in the key or state')
  assert.doesNotMatch(page, /loadedKey/)
  assert.match(page, /useRevalidatingQuery<TodayTasks>\(\s*'today\/tasks\/' \+ dayKey/)
  assert.match(page, /useRevalidatingQuery<ScheduleResponse\[\]>\(\s*'today\/schedules\/' \+ dayKey/)
  assert.equal(
    (page.match(/invalidateOn: \['task', 'schedule'\]/g) ?? []).length,
    2,
    'both panels refetch on the coalesced change batch',
  )
  assert.doesNotMatch(page, /onDataChanged|onTaskChanged|onScheduleChanged/, 'no second listener')
})

test('Today shows its loading lines only for a first load', () => {
  assert.match(page, /tasksQuery\.isInitialLoading \?/)
  assert.match(page, /schedulesQuery\.isInitialLoading \?/)
  assert.doesNotMatch(page, /aria-busy=\{loading\}/)
})

test('Today rows enter and leave through list presence', () => {
  assert.match(page, /useListPresence\(readyShown, taskKey, \{ resetKey: dayKey \}\)/)
  assert.match(page, /useListPresence\(tasks\?\.due, taskKey, \{ resetKey: dayKey \}\)/)
  assert.match(page, /useListPresence\(sortedSchedules, scheduleKey/)
  assert.equal((page.match(/\{\.\.\.presenceProps\(phase\)\}/g) ?? []).length, 2)
  assert.match(page, /useSettlingList\(tasks\?\.ready/)
})

test('Today motion uses the shared tokens and never transition: all', () => {
  assert.doesNotMatch(css, /transition:\s*all/)
  assert.doesNotMatch(css, /@keyframes/)
  assert.doesNotMatch(css, /infinite/)
  for (const [, value] of css.matchAll(/(?:animation|transition):([^;]+);/g))
    assert.match(value, /var\(--motion-/, 'timing comes from a token: ' + value.trim())
})

// ---------------------------------------------------------------------------
// Focus leaves a row before it turns inert
// ---------------------------------------------------------------------------

function loadFocus(activeRef) {
  class FakeElement {
    constructor(name, attrs = {}, children = []) {
      this.name = name
      this.attrs = attrs
      this.children = children
      this.parent = null
      this.focused = 0
      children.forEach((child) => (child.parent = this))
    }
    getAttribute(name) {
      return name in this.attrs ? this.attrs[name] : null
    }
    get nextElementSibling() {
      const list = this.parent?.children ?? []
      return list[list.indexOf(this) + 1] ?? null
    }
    get previousElementSibling() {
      const list = this.parent?.children ?? []
      return list[list.indexOf(this) - 1] ?? null
    }
    contains(other) {
      for (let node = other; node; node = node.parent) if (node === this) return true
      return false
    }
    closest(selector) {
      for (let node = this; node; node = node.parent)
        if (selector === '[data-presence="exit"]' && node.attrs['data-presence'] === 'exit')
          return node
      return null
    }
    querySelectorAll() {
      const out = []
      const walk = (node) =>
        node.children.forEach((child) => {
          if (child.name === 'input' || child.name === 'button') out.push(child)
          walk(child)
        })
      walk(this)
      return out
    }
    focus() {
      this.focused++
      activeRef.current = this
    }
  }
  const output = ts.transpileModule(read('features/today/focus.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const module = { exports: {} }
  vm.runInNewContext(output, {
    module,
    exports: module.exports,
    Array,
    HTMLElement: FakeElement,
    document: {
      get activeElement() {
        return activeRef.current
      },
    },
  })
  return { ...module.exports, El: FakeElement }
}

const row = (El, id, presence) => {
  const check = new El('input', { id: 'check-' + id })
  const title = new El('button', { id: 'title-' + id })
  return {
    row: new El('div', presence ? { 'data-presence': presence } : {}, [new El('article', {}, [check, title])]),
    check,
    title,
  }
}

test('focus in a leaving row moves to the same control in the next row', () => {
  const active = { current: null }
  const { moveFocusOutOfLeavingRow, El } = loadFocus(active)
  const a = row(El, 1, 'exit')
  const b = row(El, 2)
  const root = new El('div', {}, [new El('div', {}, [a.row, b.row])])
  active.current = a.check
  assert.equal(moveFocusOutOfLeavingRow(root, () => null), true)
  assert.equal(active.current, b.check)
})

test('focus falls back to the row above, then to the heading', () => {
  const active = { current: null }
  const { moveFocusOutOfLeavingRow, El } = loadFocus(active)
  const above = row(El, 1)
  const last = row(El, 2, 'exit')
  const root = new El('div', {}, [new El('div', {}, [above.row, last.row])])
  active.current = last.title
  moveFocusOutOfLeavingRow(root, () => null)
  assert.equal(active.current, above.title)

  const only = row(El, 3, 'exit')
  const heading = new El('h2')
  const lone = new El('div', {}, [heading, new El('div', {}, [only.row])])
  active.current = only.check
  assert.equal(moveFocusOutOfLeavingRow(lone, () => heading), true)
  assert.equal(active.current, heading)
})

test('focus outside a leaving row is left alone', () => {
  const active = { current: null }
  const { moveFocusOutOfLeavingRow, El } = loadFocus(active)
  const a = row(El, 1)
  const root = new El('div', {}, [a.row])
  active.current = a.check
  assert.equal(moveFocusOutOfLeavingRow(root, () => null), false)
  assert.equal(a.check.focused, 0)
})

test('Today hands the focus on and fades only mounts it is waiting for', () => {
  assert.match(page, /useLayoutEffect\(\(\) => \{\s*moveFocusOutOfLeavingRow\(workspaceRef\.current/)
  assert.equal((page.match(/<h2 tabIndex=\{-1\}>/g) ?? []).length, 2)
  // Cached content shown again on a return to the tab does not replay a fade.
  assert.doesNotMatch(css, /\.today-page__empty:not\(/)
  assert.match(css, /\.today-page__empty--after-rows \{\s*animation:/)
  assert.match(css, /\.today-page__count--reveal \{\s*animation:/)
  assert.match(css, /\.today-page__reveal \{\s*animation: [^;]* backwards;/)
})
