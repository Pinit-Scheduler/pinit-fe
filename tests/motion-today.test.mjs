import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import vm from 'node:vm'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const dayjs = require('dayjs')
const plain = (value) => JSON.parse(JSON.stringify(value))

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
  '@shared/motion/tokens': { COMPLETION_HOLD_MS: 480 },
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

test('the completion hold covers the strike line', () => {
  const tokens = load('shared/motion/tokens.ts')
  assert.ok(tokens.COMPLETION_HOLD_MS >= tokens.MOTION_STRIKE_DELAY_MS + tokens.MOTION_ENTER_MS)
})

// ---------------------------------------------------------------------------
// TodayPage keeps its panels through refreshes (audit Data A8, Pages 2)
// ---------------------------------------------------------------------------

const todayHarness = () => {
  const h = { queries: [], presence: [], seededTasks: [], seededSchedules: [], focus: 0, state: {}, leaving: [] }
  // Effects run inline so the seeding they do is observable without a DOM.
  const react = { ...React, useEffect: (effect) => void effect(), useLayoutEffect: (effect) => void effect() }
  const realPresence = load('shared/motion/useListPresence.ts', {
    react: React,
    './presence': {},
    './tokens': { MOTION_EXIT_MS: 1 },
  })
  const page = load('features/today/pages/TodayPage.tsx', {
    react,
    'react/jsx-runtime': require('react/jsx-runtime'),
    'react-router-dom': { Link: ({ to, children }) => React.createElement('a', { href: to }, children) },
    '@features/schedules/api/schedules': { fetchSchedules() {} },
    '@features/tasks/api/tasks': { fetchTasks() {}, fetchTasksByDeadline() {}, createScheduleFromTask() {}, fetchTaskDetail() {} },
    '@shared/utils/datetime': {
      formatDateTimeWithZone: (date) => date.dateTime.slice(11, 16),
      toApiDateTimeWithZone: () => ({}),
    },
    '@shared/hooks/useCurrentDay': { default: () => dayjs('2026-11-10T12:00:00') },
    '@shared/hooks/useRevalidatingQuery': {
      default: (key, _fetcher, options) => {
        h.queries.push({ key, invalidateOn: [...options.invalidateOn] })
        return {
          data: undefined, error: null, isInitialLoading: false, isFetching: false, refetch() {},
          ...h.state[key.split('/')[1]],
        }
      },
    },
    '@features/tasks/components/TaskScheduleModal': { default: () => null },
    '@features/tasks/components/WorkspaceTaskCard': { default: ({ task }) => React.createElement('article', null, task.title) },
    '@features/schedules/components/ScheduleCard': { default: ({ schedule }) => React.createElement('article', null, schedule.title) },
    '@contexts/TaskCacheContext': { useTaskCache: () => ({ setTask: (task) => h.seededTasks.push(task.id), tasksById: {} }) },
    '@contexts/ScheduleCacheContext': { useScheduleCache: () => ({ setSchedule: (schedule) => h.seededSchedules.push(schedule.id) }) },
    '@contexts/TimePreferencesContext': { useTimePreferences: () => ({ zoneId: 'Asia/Seoul' }) },
    '@shared/utils/events': { dispatchScheduleChanged() {}, dispatchTaskChanged() {} },
    '@shared/routing/RouteSurface': { useRouteSurfaceNavigation: () => ({ open() {} }) },
    '@shared/routing/viewTransitionNavigation': { tabLinkClick: () => () => {} },
    '@shared/motion/useListPresence': {
      presenceProps: realPresence.presenceProps,
      useListPresence: (items, getKey, options) => {
        h.presence.push(options.resetKey)
        const present = (items ?? []).map((item) => ({ key: String(getKey(item)), item, phase: 'present' }))
        // The ready list is the first of the three.
        return h.presence.length === 1 ? [...present, ...h.leaving] : present
      },
    },
    '@shared/motion/useTweenedNumber': { useTweenedNumber: (value) => value },
    '@shared/components/common/WorkspaceIcon': { default: () => null },
    '../settle': load('features/today/settle.ts', { react: React, '@shared/motion/tokens': { COMPLETION_HOLD_MS: 480 } }),
    '../focus': { moveFocusOutOfLeavingRow: () => { h.focus++ } },
    './TodayPage.css': {},
  }).default
  h.render = (state) => {
    h.queries = []
    h.presence = []
    h.state = state
    return renderToStaticMarkup(React.createElement(page))
  }
  return h
}
const card = (id) => ({ id, title: `작업 ${id}`, completed: false })
const slot = (id, time) => ({ id, title: `일정 ${id}`, state: 'NOT_STARTED', date: { dateTime: `2026-11-10T${time}:00` } })
const loaded = {
  tasks: { data: { ready: [card(1)], due: [card(2)] } },
  schedules: { data: [slot(5, '13:00'), slot(4, '09:00')] },
}

test('Today keys both panels on the day and refreshes them on one change batch, not a counter', () => {
  const h = todayHarness()
  h.render(loaded)
  assert.deepEqual(plain(h.queries), [
    { key: 'today/tasks/2026-11-10@Asia/Seoul', invalidateOn: ['task', 'schedule'] },
    { key: 'today/schedules/2026-11-10@Asia/Seoul', invalidateOn: ['task', 'schedule'] },
  ])
  assert.deepEqual(h.presence, Array(3).fill('2026-11-10@Asia/Seoul'), 'another day is a new baseline, not an animated swap')
})

test('Today seeds the tasks and schedules it shows into the caches the cards read', () => {
  const h = todayHarness()
  h.render(loaded)
  assert.deepEqual(h.seededTasks, [1, 2])
  assert.deepEqual(h.seededSchedules, [5, 4])
})

test('Today shows its loading lines only for a first load; a refresh or a failed refresh keeps the rows', () => {
  const h = todayHarness()
  let html = h.render({ tasks: { isInitialLoading: true }, schedules: { isInitialLoading: true } })
  assert.match(html, /작업을 불러오는 중…/)
  assert.match(html, /일정을 불러오는 중…/)
  html = h.render({
    tasks: { ...loaded.tasks, isFetching: true, error: '작업 서버 메시지' },
    schedules: { ...loaded.schedules, isFetching: true },
  })
  assert.doesNotMatch(html, /불러오는 중/)
  assert.match(html, /today-workspace__tasks" aria-busy="true"/)
  assert.match(html, /<span>작업 서버 메시지<\/span>/)
  assert.match(html, /<article>작업 1<\/article>[\s\S]*<article>작업 2<\/article>|<article>작업 2<\/article>[\s\S]*<article>작업 1<\/article>/)
  assert.match(html, /<time>09:00<\/time>[\s\S]*<time>13:00<\/time>/, 'schedules in start order')
  // Content shown straight from the cache does not replay the reveal.
  assert.doesNotMatch(html, /today-page__reveal|today-page__count--reveal|today-page__empty--after-rows/)
  html = h.render({ tasks: { error: '작업 서버 메시지' }, schedules: { error: null } })
  assert.match(html, /workspace-inline-error" role="alert"><span>작업 서버 메시지<\/span>/)
  assert.match(html, /workspace-inline-error" role="alert"><span>일정을 불러오지 못했어요\.<\/span>/)
})

test('a leaving Today row stays in place, inert, and the focus is handed on first', () => {
  const h = todayHarness()
  h.leaving = [{ key: '9', item: card(9), phase: 'exit' }]
  const html = h.render(loaded)
  assert.match(html, /<div class="today-page__task-row" data-presence="exit" aria-hidden="true" inert=""><article>작업 9<\/article>/)
  assert.ok(h.focus > 0)
  assert.equal(html.match(/<h2 tabindex="-1">/g)?.length, 2, 'both panel headings can take the focus')
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
