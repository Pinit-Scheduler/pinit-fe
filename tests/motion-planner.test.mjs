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
const planData = load('features/planner/utils/planData.ts')
const linkClick = load('shared/routing/linkClick.ts')

test('the plan key names every condition the plan depends on', () => {
  const base = { date: '2026-11-10', zoneId: 'Asia/Seoul', horizonDays: 7, spaceId: 3, projectId: null }
  const key = planData.dayPlanKey(base)
  assert.equal(key, '2026-11-10@Asia/Seoul/7/3/all')
  for (const change of [{ date: '2026-11-11' }, { zoneId: 'UTC' }, { horizonDays: 0 }, { spaceId: null }, { projectId: 5 }])
    assert.notEqual(planData.dayPlanKey({ ...base, ...change }), key, JSON.stringify(change))
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
  assert.deepEqual(Array.from(planData.withCreatedSchedules(read, created, '2026-11-10'), (s) => s.id), [1, 2, 3])
  assert.equal(planData.withCreatedSchedules(read, created, '2026-11-11'), read)
  assert.equal(planData.withCreatedSchedules(read, null, '2026-11-10'), read)
  assert.equal(planData.withCreatedSchedules(read, { date: '2026-11-10', schedules: [{ id: 1 }] }, '2026-11-10'), read)
})

test('a plain click on a surface link opens the surface; modified clicks keep the link', () => {
  const opened = []
  const handler = linkClick.surfaceLinkClick((path) => opened.push(path), '/app/tasks/7')
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
/* useDayPlan on the real stale-while-revalidate store.              */
/* ---------------------------------------------------------------- */

const dayPlanHarness = (fetchDayPlan, fetchSchedules = async () => []) => {
  const slots = []
  const pending = []
  let cursor = 0
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]))
  const memo = (fn, deps) => {
    const i = cursor++
    if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { deps, value: fn() }
    return slots[i].value
  }
  let unsubscribe = null
  let subscribed = null
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
      if (subscribed !== subscribe) {
        unsubscribe?.()
        subscribed = subscribe
        unsubscribe = subscribe(() => {})
      }
      return getSnapshot()
    },
  }
  const window = new EventTarget()
  const { createQueryStore } = load('shared/utils/queryStore.ts', {}, { queueMicrotask, AbortController })
  const store = createQueryStore()
  const revalidatingQuery = load('shared/hooks/useRevalidatingQuery.ts', {
    react,
    '@shared/api/authTokens': { getAccessToken: () => 'token', getTokenSubject: () => 'member-1' },
    '@shared/utils/events': { onDataChanged: () => () => {} },
    '@shared/utils/queryStore': { queryStore: store },
  }, { window })
  const useDayPlan = load('features/planner/hooks/useDayPlan.ts', {
    react,
    '@shared/utils/sameData': load('shared/utils/sameData.ts'),
    '@features/spaces/store': { useSpaces: () => ({ selectedSpaceId: 3, selectedProjectId: null }) },
    '@features/schedules/api/schedules': { fetchSchedules },
    '@shared/hooks/useRevalidatingQuery': revalidatingQuery,
    '../api/plans': { fetchDayPlan },
    '../utils/planData': planData,
  }).default
  return {
    render(props) {
      cursor = 0
      const result = useDayPlan(props)
      while (pending.length) pending.shift()()
      return result
    },
  }
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
  const props = { date: '2026-11-10', zoneId: 'UTC', horizonDays: 7 }
  let state = host.render(props)
  assert.equal(state.isInitialLoading, true)
  assert.equal(state.plan, null)
  await settle()
  state = host.render(props)
  assert.equal(state.plan.version, 1)
  assert.equal(state.planKey, '2026-11-10@UTC/7/3/all')
  assert.equal(state.isInitialLoading, false)

  // A refresh keeps the plan on screen while it loads.
  state.refetch()
  await settle()
  state = host.render(props)
  assert.equal(state.plan.version, 2)
  assert.equal(state.isLoading, false)

  // A failed refresh keeps the plan and passes the server message through unchanged.
  fail = true
  state.refetch()
  await Promise.resolve()
  state = host.render(props)
  assert.equal(state.plan.version, 2)
  assert.equal(state.isLoading, true)
  assert.equal(state.isInitialLoading, false)
  await settle()
  state = host.render(props)
  assert.equal(state.plan.version, 2)
  assert.equal(state.error, '서버 오류 메시지')

  // Another date never renders the previous date's plan, not even for one render.
  fail = false
  state = host.render({ ...props, date: '2026-11-11' })
  assert.equal(state.plan, null)
  assert.equal(state.planKey, null)
  assert.equal(state.error, null)
  assert.equal(state.isInitialLoading, true)
  await settle()
  state = host.render({ ...props, date: '2026-11-11' })
  assert.equal(state.plan.date, '2026-11-11')
})

test('useDayPlan reports a first-load failure without data', async () => {
  const host = dayPlanHarness(async () => {
    throw apiError('계획 서버 메시지', 500)
  })
  const props = { date: '2026-11-10', zoneId: 'UTC', horizonDays: 7 }
  host.render(props)
  await settle()
  const state = host.render(props)
  assert.equal(state.plan, null)
  assert.equal(state.isInitialLoading, false)
  assert.equal(state.error, '계획 서버 메시지')
})

test('useDayPlan keeps the same plan object when a refetch returns the same content', async () => {
  let blocks = [{ taskId: 1 }]
  const host = dayPlanHarness(async ({ date }) => ({ ...planFor(date, 1), blocks: blocks.map((b) => ({ ...b })) }))
  const props = { date: '2026-11-10', zoneId: 'UTC', horizonDays: 7 }
  host.render(props)
  await settle()
  let state = host.render(props)
  const first = state.plan

  // An equal response keeps the object, so the page keeps the drafts the user is editing.
  state.refetch()
  await Promise.resolve()
  state = host.render(props)
  assert.equal(state.isRefreshing, true)
  await settle()
  state = host.render(props)
  assert.equal(state.plan, first)
  assert.equal(state.isRefreshing, false)

  // A changed response is a new suggestion.
  blocks = [{ taskId: 2 }]
  state.refetch()
  await settle()
  state = host.render(props)
  assert.notEqual(state.plan, first)
  assert.equal(state.plan.blocks[0].taskId, 2)
})

test('useDayPlan clears a failure while it retries and shows a retry without a plan as loading', async () => {
  let fail = true
  const host = dayPlanHarness(async ({ date }) => {
    if (fail) throw apiError('계획 서버 메시지', 500)
    return planFor(date, 1)
  })
  const props = { date: '2026-11-10', zoneId: 'UTC', horizonDays: 7 }
  host.render(props)
  await settle()
  let state = host.render(props)
  assert.equal(state.error, '계획 서버 메시지')
  fail = false
  state.refetch()
  await Promise.resolve()
  state = host.render(props)
  assert.equal(state.error, null)
  assert.equal(state.isInitialLoading, true)
  await settle()
  state = host.render(props)
  assert.equal(state.plan.version, 1)

  // A failed refresh shows its message once the retry has ended, and the next retry clears it.
  fail = true
  state.refetch()
  await settle()
  state = host.render(props)
  assert.equal(state.error, '계획 서버 메시지')
  state.refetch()
  await Promise.resolve()
  state = host.render(props)
  assert.equal(state.error, null)
  assert.equal(state.isInitialLoading, false)
  assert.equal(state.plan.version, 1)
})

test('a window past midnight also reads the next day; schedules arrive once each, in start order', async () => {
  const day = (date, ...entries) => entries.map(([id, time]) => ({ id, date: { dateTime: `${date}T${time}:00` } }))
  const reads = []
  const host = dayPlanHarness(
    async ({ date }) => ({ date, window: { end: { dateTime: '2026-11-11T02:00:00' } } }),
    async ({ dateTime }) => {
      reads.push(dateTime)
      return dateTime.startsWith('2026-11-10')
        ? day('2026-11-10', [2, '22:00'], [1, '09:00'])
        : [...day('2026-11-10', [2, '22:00']), ...day('2026-11-11', [3, '01:00'])]
    },
  )
  const props = { date: '2026-11-10', zoneId: 'UTC', horizonDays: 7 }
  host.render(props)
  await settle()
  const state = host.render(props)
  assert.deepEqual(reads, ['2026-11-10T12:00:00', '2026-11-11T12:00:00'])
  assert.deepEqual(Array.from(state.schedules, (schedule) => schedule.id), [1, 2, 3])
})

/* ---------------------------------------------------------------- */
/* PlanPage markup.                                                  */
/* ---------------------------------------------------------------- */

let report
const links = []
const opened = []
const listPresence = (items, getKey) =>
  (items ?? []).map((item) => ({ key: String(getKey(item)), item, phase: 'present' }))
const planPage = load('features/planner/pages/PlanPage.tsx', {
  react: React,
  'react/jsx-runtime': require('react/jsx-runtime'),
  dayjs,
  'react-router-dom': {
    Link: ({ to, children, className, onClick }) => {
      links.push({ to, onClick })
      return React.createElement('a', { href: to, className }, children)
    },
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
  '@shared/routing/RouteSurface': { useRouteSurfaceNavigation: () => ({ open: (path) => opened.push(path) }) },
  '@shared/routing/viewTransitionNavigation': { tabLinkClick: () => () => {} },
  '@shared/routing/linkClick': linkClick,
  '@shared/motion/useListPresence': { useListPresence: listPresence, presenceProps: () => ({}) },
  '@shared/motion/usePresence': {
    usePresence: (value) => ({ mounted: Boolean(value), closing: false, value: value || undefined }),
  },
  '@shared/motion/useTweenedNumber': { useTweenedNumber: (value) => value },
  '@shared/motion/tokens': { MOTION_FLASH_MS: 1200, prefersReducedMotion: () => false },
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
  '../utils/planData': planData,
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
  assert.match(html, /role="alert"><div class="status-panel status-panel--error">서버가 보낸 메시지<\/div>/)
})

test('a refresh keeps the proposal mounted and marks it busy; a failed refresh keeps it with the message', () => {
  let html = renderPlan({ plan, planKey: 'k1', isLoading: true })
  assert.match(html, /class="plan-page__result" aria-busy="true"/)
  assert.match(html, /블록 2/)
  assert.doesNotMatch(html, /status-panel--loading/)
  html = renderPlan({ plan, planKey: 'k1', error: '다시 불러오기 실패 메시지' })
  assert.match(html, /plan-page__refresh-error" role="alert">다시 불러오기 실패 메시지<\/p>/)
  assert.match(html, /블록 3/)
})

test('the proposal cannot be approved while it is being reloaded', () => {
  const button = (html) => html.match(/<button type="button" class="plan-page__apply"[^>]*>[^<]*<\/button>/)[0]
  let html = renderPlan({ plan, planKey: 'k1' })
  assert.doesNotMatch(button(html), /disabled/)
  html = renderPlan({ plan, planKey: 'k1', isLoading: true, isRefreshing: true })
  assert.match(button(html), /disabled=""/)
  assert.match(button(html), /제안을 확인하는 중\.\.\./)
})

test('unplaced tasks open the task surface instead of swapping the page behind it', () => {
  links.length = 0
  const html = renderPlan({ plan, planKey: 'k1' })
  assert.match(html, /<a href="\/app\/tasks\/7" class="plan-page__unplaced-title">못 넣은 작업<\/a>/)
  const link = links.find(({ to }) => to === '/app/tasks/7')
  let prevented = false
  link.onClick({ button: 0, defaultPrevented: false, preventDefault: () => { prevented = true } })
  assert.equal(prevented, true)
  assert.deepEqual(opened, ['/app/tasks/7'])
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
