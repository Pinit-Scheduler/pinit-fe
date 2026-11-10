import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import vm from 'node:vm'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import { apiError, requireFrom } from './support/errors.mjs'

const require = createRequire(import.meta.url)
const dayjs = require('dayjs')
dayjs.extend(require('dayjs/plugin/utc'))
dayjs.extend(require('dayjs/plugin/timezone'))

const read = (path) => readFileSync(new URL('../src/' + path, import.meta.url), 'utf8')
const load = (path, dependencies = {}, globals = {}) => {
  const { outputText } = ts.transpileModule(read(path), {
    fileName: path,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
    },
  })
  const module = { exports: {} }
  vm.runInNewContext(outputText, {
    module,
    exports: module.exports,
    console,
    Error,
    Map,
    Set,
    Promise,
    require: requireFrom(dependencies),
    ...globals,
  })
  return module.exports
}
const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

const motion = load('features/planner/utils/planMotion.ts')

test('a loaded plan only shows under the key it was requested for', () => {
  const key = motion.dayPlanKey({ date: '2026-11-10', zoneId: 'Asia/Seoul', horizonDays: 7, spaceId: 3, projectId: null })
  assert.equal(key, '2026-11-10@Asia/Seoul/7/3/all')
  const other = motion.dayPlanKey({ date: '2026-11-11', zoneId: 'Asia/Seoul', horizonDays: 7, spaceId: 3, projectId: null })
  const loaded = { key, plan: { date: '2026-11-10' } }
  assert.equal(motion.resultForKey(loaded, key), loaded)
  assert.equal(motion.resultForKey(loaded, other), null)
  assert.equal(motion.resultForKey(null, key), null)
})

test('the arrival stagger is capped so a long proposal never waits', () => {
  assert.deepEqual([0, 1, 5, 6, 7, 40].map(motion.staggerIndex), [0, 1, 5, 6, 6, 6])
  assert.equal(motion.staggerIndex(-1), 0)
})

test('only rows whose suggestion moved between proposals are highlighted', () => {
  const row = (taskId, start, type = 'DEEP_WORK') => ({ taskId, suggestedStartLocal: start, suggestedType: type })
  const moved = motion.movedSuggestions(
    [row(1, '2026-11-10T09:00'), row(2, '2026-11-10T10:00'), row(3, '2026-11-10T11:00')],
    [row(1, '2026-11-10T09:00'), row(2, '2026-11-10T10:30'), row(3, '2026-11-10T11:00', 'QUICK_TASK'), row(4, '2026-11-10T12:00')],
  )
  assert.deepEqual(Array.from(moved).sort(), [2, 3])
})

test('created schedules join the timeline once, only for their plan date', () => {
  const read = [{ id: 1 }, { id: 2 }]
  const created = { date: '2026-11-10', schedules: [{ id: 2 }, { id: 3 }] }
  assert.deepEqual(Array.from(motion.withCreatedSchedules(read, created, '2026-11-10'), (s) => s.id), [1, 2, 3])
  assert.equal(motion.withCreatedSchedules(read, created, '2026-11-11'), read)
  assert.equal(motion.withCreatedSchedules(read, null, '2026-11-10'), read)
  assert.equal(motion.withCreatedSchedules(read, { date: '2026-11-10', schedules: [{ id: 1 }] }, '2026-11-10'), read)
})

test('a plain click on a surface link opens the surface; modified clicks keep the link', () => {
  const opened = []
  const handler = motion.surfaceLinkClick((path) => opened.push(path), '/app/tasks/7')
  const click = (extra = {}) => {
    const event = { button: 0, defaultPrevented: false, metaKey: false, altKey: false, ctrlKey: false, shiftKey: false, ...extra, prevented: false }
    event.preventDefault = () => { event.prevented = true }
    handler(event)
    return event.prevented
  }
  assert.equal(click(), true)
  assert.deepEqual(opened, ['/app/tasks/7'])
  for (const modifier of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }, { defaultPrevented: true }])
    assert.equal(click(modifier), false)
  assert.equal(opened.length, 1)
})

/* ---------------------------------------------------------------- */
/* useDayPlan with a tiny hook harness.                              */
/* ---------------------------------------------------------------- */

const hookHarness = (useHook) => {
  const states = []
  let effects = []
  const deps = []
  let cursor = 0
  let effectCursor = 0
  const react = {
    useState(initial) {
      const index = cursor++
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial
      return [states[index], (next) => { states[index] = typeof next === 'function' ? next(states[index]) : next }]
    },
    useEffect(fn, list) {
      const index = effectCursor++
      const previous = deps[index]
      if (!previous || !list || list.some((value, i) => !Object.is(value, previous.list[i]))) {
        previous?.cleanup?.()
        deps[index] = { list, cleanup: null }
        effects.push(() => { deps[index].cleanup = fn() ?? null })
      }
    },
  }
  return {
    react,
    render(props) {
      cursor = 0
      effectCursor = 0
      const result = useHook()(props)
      const pending = effects
      effects = []
      pending.forEach((run) => run())
      return result
    },
  }
}

const dayPlanHarness = (fetchDayPlan) => {
  let hook
  const harness = hookHarness(() => hook)
  hook = load('features/planner/hooks/useDayPlan.ts', {
    react: harness.react,
    '@features/spaces/store': { useSpaces: () => ({ selectedSpaceId: 3, selectedProjectId: null }) },
    '@features/schedules/api/schedules': { fetchSchedules: async () => [] },
    '../api/plans': { fetchDayPlan },
    '../utils/planMotion': motion,
  }).default
  return harness
}
const planFor = (date, version) => ({ date, version, window: { end: { dateTime: `${date}T23:00:00` } } })

test('useDayPlan keeps the plan through a refresh and a failed refresh, and never shows another date', async () => {
  let fail = false
  let version = 0
  const host = dayPlanHarness(async ({ date }) => {
    if (fail) throw apiError('서버 오류 메시지', 500)
    version += 1
    return planFor(date, version)
  })
  const props = { date: '2026-11-10', zoneId: 'UTC', horizonDays: 7, refreshKey: 0 }
  let state = host.render(props)
  assert.equal(state.isInitialLoading, true)
  assert.equal(state.plan, null)
  await settle()
  state = host.render(props)
  assert.equal(state.plan.version, 1)
  assert.equal(state.isInitialLoading, false)

  // A refresh keeps the plan on screen while it loads.
  host.render({ ...props, refreshKey: 1 })
  state = host.render({ ...props, refreshKey: 1 })
  assert.equal(state.plan.version, 1)
  assert.equal(state.isLoading, true)
  assert.equal(state.isInitialLoading, false)
  await settle()
  state = host.render({ ...props, refreshKey: 1 })
  assert.equal(state.plan.version, 2)

  // A failed refresh keeps the plan and passes the server message through unchanged.
  fail = true
  host.render({ ...props, refreshKey: 2 })
  await settle()
  state = host.render({ ...props, refreshKey: 2 })
  assert.equal(state.plan.version, 2)
  assert.equal(state.error, '서버 오류 메시지')

  // Another date never renders the previous date's plan, not even for one render.
  fail = false
  state = host.render({ ...props, date: '2026-11-11', refreshKey: 2 })
  assert.equal(state.plan, null)
  assert.equal(state.error, null)
  assert.equal(state.isInitialLoading, true)
  await settle()
  state = host.render({ ...props, date: '2026-11-11', refreshKey: 2 })
  assert.equal(state.plan.date, '2026-11-11')
})

test('useDayPlan reports a first-load failure without data', async () => {
  const host = dayPlanHarness(async () => {
    throw apiError('계획 서버 메시지', 500)
  })
  const props = { date: '2026-11-10', zoneId: 'UTC', horizonDays: 7, refreshKey: 0 }
  host.render(props)
  await settle()
  const state = host.render(props)
  assert.equal(state.plan, null)
  assert.equal(state.isInitialLoading, false)
  assert.equal(state.error, '계획 서버 메시지')
})

/* ---------------------------------------------------------------- */
/* PlanPage markup.                                                  */
/* ---------------------------------------------------------------- */

let report
const listPresence = (items, getKey) =>
  (items ?? []).map((item) => ({ key: String(getKey(item)), item, phase: 'present' }))
const planPage = load('features/planner/pages/PlanPage.tsx', {
  react: React,
  'react/jsx-runtime': require('react/jsx-runtime'),
  dayjs,
  'react-router-dom': {
    Link: ({ to, children, className }) => React.createElement('a', { href: to, className }, children),
    useSearchParams: () => [new URLSearchParams(), () => {}],
  },
  '@shared/components/common/WorkspaceIcon': () => null,
  '@shared/components/common/StatusPanel': ({ variant, title, description }) =>
    React.createElement('div', { className: `status-panel status-panel--${variant}` }, title, description),
  '@shared/api/httpClient': { ApiError: class ApiError extends Error {} },
  '@shared/utils/datetime': { getTodayWithOffset: () => dayjs('2026-11-10') },
  '@shared/utils/events': { dispatchScheduleChanged() {}, dispatchTaskChanged() {} },
  '@shared/utils/isoDuration': {
    formatIsoDurationLabel: (value) => value,
    formatMinutesLabel: (minutes) => `${minutes}분`,
    parseIsoDurationMinutes: () => 60,
  },
  '@shared/utils/safeStorage': { NUDGE_KEYS: {}, readFlag: () => true, writeFlag() {} },
  '@shared/routing/RouteSurface': { useRouteSurfaceNavigation: () => ({ open() {} }) },
  '@shared/routing/viewTransitionNavigation': { tabLinkClick: () => () => {} },
  '@shared/motion/useListPresence': { useListPresence: listPresence, presenceProps: () => ({}) },
  '@shared/motion/usePresence': {
    usePresence: (value) => ({ mounted: Boolean(value), closing: false, value: value || undefined }),
  },
  '@shared/motion/useTweenedNumber': { useTweenedNumber: (value) => value },
  '@shared/motion/tokens': { prefersReducedMotion: () => false },
  '@contexts/TimePreferencesContext': { useTimePreferences: () => ({ zoneId: 'UTC', offsetMinutes: 0 }) },
  '@contexts/ToastContext': { useToast: () => ({ addToast() {} }) },
  '@contexts/ScheduleCacheContext': { useScheduleCache: () => ({ upsertSchedule() {}, invalidateSchedules() {} }) },
  '@constants/schedules': { scheduleTypeLabel: { DEEP_WORK: '집중 작업', QUICK_TASK: '빠른 일정' } },
  '@features/routines/api/routines': { fetchRoutines: () => new Promise(() => {}) },
  '@features/routines/utils/routineRules': { KIND_LABEL: {}, mealHintFor: () => null, routineName: () => '' },
  '@features/calibration/api/calibration': { fetchTimeCalibration: () => new Promise(() => {}), updateTimeCalibration() {} },
  '@features/calibration/utils/calibrationView': { blockCalibrationNote: () => null, hasUsableFactor: () => false },
  '../api/plans': { applyDayPlan() {} },
  '../hooks/useDayPlan': () => report,
  '../components/PlanTimeline': () => null,
  '../components/DayReplanningPanel': () => null,
  '../utils/planMapping': {
    MAX_APPLY_BLOCKS: 100,
    findRoutineConflicts: () => ({}),
    mapRejectionsToBlocks: () => ({}),
    parsePlanRejections: () => null,
    unplacedReasonLabel: () => '시간 부족',
    validatePlanSelection: () => ({}),
  },
  '../utils/planMotion': motion,
  './PlanPage.css': {},
}).default

const block = (taskId, hour) => ({
  taskId,
  expectedVersion: 1,
  title: `블록 ${taskId}`,
  start: { dateTime: `2026-11-10T${hour}:00:00`, zoneId: 'UTC' },
  end: { dateTime: `2026-11-10T${hour}:59:00`, zoneId: 'UTC' },
  duration: 'PT1H',
  mustTier: false,
  scheduleType: 'DEEP_WORK',
})
const plan = {
  date: '2026-11-10',
  zoneId: 'UTC',
  blocks: [block(1, '09'), block(2, '10'), block(3, '11')],
  unplaced: [{ taskId: 7, title: '못 넣은 작업', mustTier: false, reason: 'NO_TIME' }],
  routines: [],
  objective: { dailyObjectiveWork: 'PT4H', existingTaskWork: 'PT0S', plannedWork: 'PT3H', used: 'PT3H' },
  window: { start: { dateTime: '2026-11-10T07:00:00', zoneId: 'UTC' }, end: { dateTime: '2026-11-10T23:00:00', zoneId: 'UTC' } },
  windowSource: 'SLEEP_ROUTINE',
  calibrationApplied: false,
}
const renderPlan = (state) => {
  report = { plan: null, planKey: null, schedules: [], isLoading: false, isInitialLoading: false, error: null, ...state }
  return renderToStaticMarkup(React.createElement(planPage))
}

test('the first proposal for a request arrives with a staggered entrance', () => {
  const html = renderPlan({ plan, planKey: 'k1' })
  assert.match(html, /class="plan-page__result" data-arrive="true"/)
  assert.match(html, /id="plan-block-1"[^>]*style="--plan-stagger:0"/)
  assert.match(html, /id="plan-block-3"[^>]*style="--plan-stagger:2"/)
  assert.match(html, /style="--plan-order:0"/)
  assert.match(html, /<span class="motion-strike">블록 1<\/span>/)
  assert.match(html, /3개 선택/)
})

test('a first load shows the delayed status panel; a failure without data shows the server message', () => {
  let html = renderPlan({ isLoading: true, isInitialLoading: true })
  assert.match(html, /status-panel--loading/)
  assert.match(html, /계획을 만드는 중\.\.\./)
  html = renderPlan({ error: '서버가 보낸 메시지' })
  assert.match(html, /role="alert"><div class="status-panel status-panel--error">계획을 불러오지 못했어요\.서버가 보낸 메시지/)
})

test('a refresh keeps the proposal mounted and marks it busy; a failed refresh keeps it with the message', () => {
  let html = renderPlan({ plan, planKey: 'k1', isLoading: true })
  assert.match(html, /class="plan-page__result" aria-busy="true"/)
  assert.match(html, /블록 2/)
  assert.doesNotMatch(html, /status-panel--loading/)
  html = renderPlan({ plan, planKey: 'k1', error: '다시 불러오기 실패 메시지' })
  assert.match(html, /plan-page__refresh-error" role="alert">계획을 불러오지 못했어요\. 다시 불러오기 실패 메시지/)
  assert.match(html, /블록 3/)
})

test('unplaced tasks open the task surface instead of swapping the page behind it', () => {
  const source = read('features/planner/pages/PlanPage.tsx')
  const taskLinks = [...source.matchAll(/<Link\s+to=\{`\/app\/tasks\/[^`]*`\}[\s\S]*?>/g)]
  assert.ok(taskLinks.length > 0)
  for (const [link] of taskLinks) assert.match(link, /onClick=\{surfaceLinkClick\(/)
  const html = renderPlan({ plan, planKey: 'k1' })
  assert.match(html, /<a href="\/app\/tasks\/7" class="plan-page__unplaced-title">못 넣은 작업<\/a>/)
})

/* ---------------------------------------------------------------- */
/* Timeline and replanning markup.                                   */
/* ---------------------------------------------------------------- */

test('timeline items sit in slots positioned by transform so edited starts glide', () => {
  const timeline = load('features/planner/components/PlanTimeline.tsx', {
    dayjs,
    react: React,
    'react/jsx-runtime': require('react/jsx-runtime'),
    '@shared/motion/useListPresence': { useListPresence: listPresence, presenceProps: () => ({}) },
    './PlanTimeline.css': {},
  }).default
  const start = Date.UTC(2026, 10, 10, 9)
  const html = renderToStaticMarkup(React.createElement(timeline, {
    zoneId: 'UTC',
    windowStartMs: start,
    windowEndMs: start + 4 * 3600000,
    onSelectBlock() {},
    items: [
      { key: '1', kind: 'block', title: '블록', startMs: start + 3600000, endMs: start + 7200000, selected: true },
      { key: 'schedule-5', kind: 'schedule', title: '일정', startMs: start, endMs: start + 1800000 },
    ],
  }))
  assert.match(html, /class="plan-timeline__slot plan-timeline__slot--block" style="transform:translateY\(45px\);height:45px"/)
  assert.match(html, /class="plan-timeline__slot plan-timeline__slot--schedule" style="transform:translateY\(0px\)/)
  assert.match(html, /<button type="button" class="plan-timeline__item plan-timeline__item--block"/)
  assert.doesNotMatch(html, /plan-timeline__item[^"]*" style="top/)
})

test('a replaced replanning preview stays for its exit, inert and hidden from assistive tech', () => {
  const utils = load('features/planner/utils/replanning.ts')
  const preview = {
    spaceId: 10, projectId: null, date: '2026-11-10', zoneId: 'UTC', plannedAt: new Date().toISOString(),
    changes: [101, 102].map((scheduleId, index) => ({
      scheduleId, taskId: index + 1, title: `이동 ${index + 1}`,
      beforeStart: '2026-11-10T01:00:00Z', beforeEnd: '2026-11-10T01:30:00Z',
      afterStart: '2026-11-10T01:30:00Z', afterEnd: '2026-11-10T02:00:00Z',
    })),
    protectedSchedules: [], unplaced: [],
  }
  const render = (closing) => {
    const panel = load('features/planner/components/DayReplanningPanel.tsx', {
      react: React, 'react/jsx-runtime': require('react/jsx-runtime'), dayjs,
      '@shared/motion/usePresence': { usePresence: (value) => ({ mounted: true, closing, value: value ?? { preview, selectedIds: [101] } }) },
      '@features/spaces/store': { useSpaces: () => ({ loading: false, error: null, memberId: 1, selectedProjectId: null,
        selectedSpace: { id: 10, name: '공간', version: 1, members: [] }, selectedProject: null }) },
      '../hooks/useDayReplan': () => ({ delay: '30', preview: closing ? null : preview, phase: 'idle', selectedIds: closing ? [] : [101], appliedCount: null }),
      '../utils/replanning': utils, './DayReplanningPanel.css': {},
    }).default
    return renderToStaticMarkup(React.createElement(panel, { date: dayjs().tz('UTC').format('YYYY-MM-DD'), zoneId: 'UTC', onApplied() {} }))
  }
  const open = render(false)
  assert.match(open, /<div class="day-replan__preview">/)
  assert.match(open, /style="--replan-stagger:1"/)
  const leaving = render(true)
  assert.match(leaving, /class="day-replan__preview" data-state="closing" inert="" aria-hidden="true"/)
  // The leaving preview keeps the selection it had instead of unchecking mid-fade.
  assert.match(leaving, /<input type="checkbox" checked=""/)
})

/* ---------------------------------------------------------------- */
/* CSS contract.                                                      */
/* ---------------------------------------------------------------- */

const plannerCss = [
  'features/planner/pages/PlanPage.css',
  'features/planner/components/PlanTimeline.css',
  'features/planner/components/DayReplanningPanel.css',
].map((path) => [path, read(path)])

test('planner CSS animates only allowed properties with the motion tokens', () => {
  const allowed = /^(transform|opacity|color|background-color|background|border-color|stroke)$/
  for (const [path, css] of plannerCss) {
    assert.doesNotMatch(css, /transition:\s*all/, path)
    assert.doesNotMatch(css, /infinite/, path)
    for (const [, value] of css.matchAll(/transition:\s*([^;]+);/g)) {
      for (const part of value.split(',')) {
        const property = part.trim().split(/\s+/)[0]
        assert.match(property, allowed, `${path}: ${part.trim()}`)
        assert.match(part, /var\(--motion-/, `${path}: ${part.trim()} uses a token`)
      }
    }
    for (const [, value] of css.matchAll(/animation:\s*([^;]+);/g))
      assert.match(value, /var\(--motion-|^plan-page-block-flash 1200ms var\(--motion-ease\)/, `${path}: ${value}`)
  }
})

test('planner CSS never redefines shared keyframes and handles reduced motion', () => {
  const shared = ['motion-fade-in', 'motion-fade-out', 'motion-rise-in', 'motion-rise-out', 'motion-drop-in', 'motion-sheet-in', 'motion-sheet-out', 'modalFadeIn', 'modalSlideUp', 'fadeIn', 'fadeSlideIn']
  for (const [path, css] of plannerCss) {
    for (const [, name] of css.matchAll(/@keyframes\s+([\w-]+)/g)) assert.ok(!shared.includes(name), `${path} redefines ${name}`)
    assert.doesNotMatch(css, /\banimation:\s*(fadeIn|fadeSlideIn)\b/, path)
  }
  const page = plannerCss[0][1]
  const reduced = page.slice(page.indexOf('@media (prefers-reduced-motion: reduce)'))
  assert.match(reduced, /animation-delay: 0ms/)
  assert.match(reduced, /animation-name: motion-fade-in/)
  assert.match(plannerCss[2][1], /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation-delay: 0ms/)
})
