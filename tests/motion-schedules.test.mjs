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

// Motion and flicker rules for the schedules area (docs/motion/README.md; flicker audit Data A1-A5, Pages 3, Mutations A4-A5).

const source = (path) => readFileSync(new URL('../src/' + path, import.meta.url), 'utf8')
const load = (path, dependencies, globals = {}) => {
  const output = ts.transpileModule(source(path), {
    fileName: path,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  const module = { exports: {} }
  vm.runInNewContext(output, {
    module, exports: module.exports, Error, setTimeout, clearTimeout, queueMicrotask, ...globals,
    require: requireFrom(dependencies),
  })
  return module.exports
}
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const settle = () => new Promise((resolve) => setImmediate(resolve))
const plain = (value) => JSON.parse(JSON.stringify(value))
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
// ScheduleCard actions: optimistic state, per-card lock (audit Mutations A4, A5)
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
  h.response().reject(apiError('서버가 거절했어요', 400))
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
  assert.equal(opened.schedule.title, '목록에서')
  assert.equal(h.reads(), 1, 'the cached copy is shown while it is read again')
  h.response().resolve({ id: 8, title: '서버에서', version: 4 })
  await settle()
  assert.equal(h.render().schedule.title, '서버에서')
  h.cleanup()
})

test('a newer cached copy wins over an older read; an invalid id is an error, not a loading line', async () => {
  const h = detailHarness({ id: 8, title: '다른 화면에서 시작함', version: 5 })
  h.render()
  h.response().resolve({ id: 8, title: '늦게 온 읽기', version: 4 })
  await settle()
  assert.equal(h.render().schedule.title, '다른 화면에서 시작함')
  const invalid = h.render(undefined, 'abc')
  assert.equal(invalid.isLoading, false)
  assert.equal(invalid.schedule, null)
  assert.equal(invalid.error, '일정 ID가 유효하지 않습니다.')
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
  // A list read older than the cached copy (Today seeding a slow response, say) is ignored.
  const newer = render().schedulesById
  render().setSchedule({ ...schedule, version: 2, state: 'IN_PROGRESS' })
  assert.equal(render().schedulesById, newer, 'an older revision never replaces a newer one')
  assert.equal(render().schedulesById[3].version, 3)
})

// ---------------------------------------------------------------------------
// Schedules tab and card markup (audit Pages 3A-3D, Mutations A4-A5)
// ---------------------------------------------------------------------------

// A function stands for a module's default export.
const markup = (path, dependencies) =>
  load(path, {
    react: React,
    'react/jsx-runtime': require('react/jsx-runtime'),
    ...Object.fromEntries(
      Object.entries({ '@shared/components/common/WorkspaceIcon': () => null, ...dependencies })
        .map(([name, value]) => [name, typeof value === 'function' ? { default: value } : value]),
    ),
  }, { console: { error() {}, warn() {} } }).default
const day = (id, dateTime, extra = {}) => ({
  id,
  title: `일정 ${id}`,
  version: 1,
  state: 'NOT_STARTED',
  date: { dateTime, zoneId: 'UTC' },
  allowedActions: { edit: true },
  ...extra,
})

const tabHarness = () => {
  const h = {
    list: null,
    presence: { presenceMap: {}, error: null, refetch: () => h.refetched.push('presence') },
    overdue: { hasOverdue: false },
    refetched: [],
    dispatched: [],
    updates: [],
    toasts: [],
    commits: {},
    drag: null,
    updated: null,
  }
  const page = markup('features/schedules/pages/tab/SchedulesTabPage.tsx', {
    'react-router-dom': {
      Link: ({ to, children, className }) => React.createElement('a', { href: to, className }, children),
      useSearchParams: () => [new URLSearchParams(), () => {}],
    },
    '../../hooks/useScheduleViewState.ts': () => ({
      currentWeekStart: dayjs('2026-11-09'),
      selectedDate: dayjs('2026-11-10'),
      selectedDateLabel: '11월 10일',
      selectedDateKey: '2026-11-10',
      goToWeek() {},
      selectDate() {},
    }),
    '../../components/WeeklyDateStrip.tsx': () => null,
    '../../components/MonthCalendar': () => null,
    '../../hooks/useMonthlySchedules': () => ({ summaryByDate: {}, isLoading: false, error: null, refetch: () => h.refetched.push('month') }),
    '../../components/OverdueBanner.tsx': () => React.createElement('p', null, '지난 일정'),
    '../../hooks/useWeeklySchedulePresence.ts': () => h.presence,
    '../../hooks/useOverdueSchedulesSummary.ts': () => ({ summary: h.overdue, refetch: () => h.refetched.push('overdue') }),
    '../../components/ScheduleCard.tsx': ({ schedule }) => React.createElement('article', null, schedule.title),
    '../../hooks/useScheduleList.ts': () => h.list,
    '../../hooks/useScheduleAudience': () => ({ audience: 'mine', setAudience() {}, shared: false }),
    '@shared/components/common/StatusPanel': ({ variant, title, description }) =>
      React.createElement('div', { className: `status-panel status-panel--${variant}` }, title, description),
    '@shared/routing/RouteSurface': { useRouteSurfaceNavigation: () => ({ open() {} }) },
    '../../api/schedules.ts': {
      deleteSchedule: async () => {},
      updateSchedule: async (id, payload) => {
        h.updates.push([id, payload])
        return h.updated
      },
    },
    '@features/statistics/hooks/useWeeklyStatistics': () => ({
      current: null, isLoading: false, isRefreshing: false, error: null, refetch: () => h.refetched.push('stats'),
    }),
    '@shared/utils/statisticsTransform': { formatMinutesToTime: (minutes) => `${minutes}분` },
    './SchedulesTabPage.css': {},
    '@shared/utils/datetime': {
      addDays: (date, offset) => dayjs(date.dateTime).add(offset, 'day'),
      getTodayWithOffset: () => dayjs('2026-11-10'),
      toApiDateTimeWithZone: (value) => ({ dateTime: value.format('YYYY-MM-DDTHH:mm:ss'), zoneId: 'UTC' }),
      toDateKey: (value) => (typeof value.format === 'function' ? value.format('YYYY-MM-DD') : value.dateTime.slice(0, 10)),
      toDisplayDayjs: (value) => dayjs(typeof value === 'string' ? value : value.dateTime),
    },
    '@shared/utils/dateKey': { parseDateKey: () => null },
    '@contexts/ToastContext': { useToast: () => ({ addToast: (...args) => h.toasts.push(args) }) },
    '@contexts/ScheduleCacheContext': {
      useScheduleCache: () => ({ setSchedule() {}, setActiveSchedule() {}, activeScheduleId: null, schedulesById: {} }),
    },
    '@contexts/TimePreferencesContext': { useTimePreferences: () => ({ offsetMinutes: 0 }) },
    '@shared/utils/events': { dispatchScheduleChanged: (detail) => h.dispatched.push(detail) },
    '@features/trash': { useTrashUndo: () => ({ offerScheduleUndo() {} }) },
    '../../hooks/useScheduleDrag': (options) => {
      h.drag = options
      return { edgeTarget: null, draggingScheduleId: null, getItemHandlers: () => ({}), containerTouchHandlers: {} }
    },
    '../../components/ScheduleTimeHandle': ({ title, onCommit }) => {
      h.commits[title] = onCommit
      return null
    },
    '@features/recurrence/components/RecurrenceScopeDialog': { useRecurrenceScope: () => ({ dialog: null, ask: async () => 'THIS' }) },
    '@features/recurrence/utils/seriesMutations': { confirmAndDeleteSeries() {}, previewSeriesDelete() {} },
    '@features/recurrence/utils/recurrenceRules': { isBeyondGeneration: () => false },
    '@features/spaces/store': { useSpaces: () => ({ memberId: 1, selectedSpace: null, selectedProjectId: null }) },
    '@features/spaces/conflicts': { CONFLICT_RELOADED: '', isEditConflict: () => false },
    '@features/spaces/scope': {
      audienceSchedules: (schedules) => ({ visible: schedules, hidden: 0 }),
      scheduleMineParam: () => undefined,
    },
    '@shared/motion': {
      MOTION_DISTANCE_PX: 8,
      MOTION_EASE: 'ease',
      MOTION_ENTER_MS: 1,
      MOTION_STAGGER_MS: 1,
      prefersReducedMotion: () => true,
      presenceProps: () => ({}),
      useListPresence: (items, getKey) => (items ?? []).map((item) => ({ key: String(getKey(item)), item, phase: 'present' })),
      usePresence: (value) => ({ mounted: Boolean(value), closing: false, value: value || undefined }),
      useChangedWhileMounted: () => false,
      useTweenedNumber: (value) => value,
    },
  })
  h.render = (list) => {
    h.list = {
      schedules: list.data ?? [],
      isLoading: false,
      isRefreshing: false,
      error: null,
      refetch: () => h.refetched.push('day'),
      setData: (update) => { h.dayUpdate = update },
      ...list,
    }
    return renderToStaticMarkup(React.createElement(page))
  }
  return h
}

test('the schedules tab keeps the day list through a refresh and through failures that leave rows', () => {
  const h = tabHarness()
  const rows = [day(1, '2026-11-10T09:00:00')]
  h.presence = { ...h.presence, error: '주간 일정을 불러오지 못했어요.' }
  let html = h.render({ data: rows, isRefreshing: true, error: '일정을 불러오지 못했어요.' })
  assert.match(html, /class="schedules-tab__list" aria-busy="true"/)
  assert.match(html, /<article>일정 1<\/article>/)
  assert.doesNotMatch(html, /status-panel/, 'a refresh, a failed refresh or the week dots never blank the rows')
  html = h.render({ data: undefined, error: '서버가 보낸 이유' })
  assert.match(html, /status-panel--error">일정을 불러오지 못했어요서버가 보낸 이유/, 'only a day without rows shows the error panel')
  html = h.render({ data: undefined, isLoading: true })
  assert.match(html, /status-panel--loading/)
  assert.doesNotMatch(html, /schedules-tab__overdue/)
  h.overdue = { hasOverdue: true, count: 1, earliestDate: '2026-11-08' }
  assert.match(h.render({ data: rows }), /<div class="schedules-tab__overdue"><p>지난 일정<\/p><\/div>/)
})

test('moving or shifting a schedule dispatches one change and refetches nothing by hand', async () => {
  const h = tabHarness()
  const morning = day(1, '2026-11-10T09:00:00')
  const late = day(2, '2026-11-10T23:30:00')
  h.render({ data: [morning, late] })

  h.updated = { ...morning, version: 2, date: { dateTime: '2026-11-11T09:00:00', zoneId: 'UTC' } }
  await h.drag.onMove(morning, 1)
  assert.deepEqual(plain(h.updates.at(-1)), [1, { date: { dateTime: '2026-11-11T09:00:00', zoneId: 'UTC' }, expectedVersion: 1 }])
  assert.deepEqual(plain(h.dispatched).map(({ reason, previousDateKey }) => [reason, previousDateKey]), [['moved', '2026-11-10']])
  assert.deepEqual(Array.from(h.dayUpdate([morning, late]), ({ id }) => id), [2], 'the moved card leaves this day at once')

  h.updated = { ...morning, version: 3, date: { dateTime: '2026-11-10T09:30:00', zoneId: 'UTC' } }
  h.commits['일정 1'](30)
  await settle()
  assert.deepEqual(Array.from(h.dayUpdate([morning, late])), [h.updated, late], 'a shift within the day keeps the card in place')

  h.updated = { ...late, version: 2, date: { dateTime: '2026-11-11T00:00:00', zoneId: 'UTC' } }
  h.commits['일정 2'](30)
  await settle()
  assert.deepEqual(Array.from(h.dayUpdate([morning, late])), [morning], 'a shift past midnight takes the card off this day')

  assert.equal(h.dispatched.length, 3)
  assert.deepEqual(h.refetched, [], 'the change event refreshes every view; nothing refetches by hand')
})

const cardHarness = () => {
  const h = { actions: null, cache: {}, changed: false }
  const mark = markup('features/schedules/components/ScheduleCompletionMark.tsx', {
    '@shared/components/motion/CompletionCheck': ({ checked, disabled, label }) =>
      React.createElement('input', { type: 'checkbox', checked, disabled, 'aria-label': label, readOnly: true }),
  })
  const card = markup('features/schedules/components/ScheduleCard.tsx', {
    './ScheduleCard.css': {},
    './ScheduleState.css': {},
    '@features/recurrence/components/RecurrenceRuleFields.css': {},
    '@constants/schedules': {
      scheduleTypeLabel: {},
      stateIcon: { NOT_STARTED: 'circle', IN_PROGRESS: 'play', SUSPENDED: 'pause', COMPLETED: 'check' },
      stateLabel: { NOT_STARTED: '미시작', IN_PROGRESS: '진행 중', SUSPENDED: '일시정지', COMPLETED: '완료' },
    },
    '@shared/utils/isoDuration': { formatIsoDurationLabel: () => null },
    '../hooks/useScheduleActions': () => h.actions,
    './ScheduleCompletionMark': mark,
    'react-router-dom': { useLocation: () => ({ pathname: '/app/schedules' }) },
    '@contexts/ScheduleCacheContext': { useScheduleCache: () => ({ schedulesById: h.cache }) },
    '@shared/motion': {
      usePresence: (value) => ({ mounted: Boolean(value), closing: false, value }),
      MOTION_FAST_MS: 120,
      useChangedWhileMounted: () => h.changed,
    },
    '@features/spaces/cardPath': { cardPath: () => null },
    '@features/spaces/SpacePath': () => null,
    '@features/spaces/scope': { routeScope: () => null },
    '@features/spaces/store': { useSpaces: () => ({ selectedSpaceId: null, selectedProjectId: null, spaces: [], projects: [] }) },
  })
  h.render = (actions, schedule = day(5, '2026-11-10T09:00:00')) => {
    h.actions = { canComplete: true, canCancel: false, isMutating: false, isLocked: false, lastError: null, ...actions }
    return renderToStaticMarkup(React.createElement(card, { schedule, onOpenDetail() {} }))
  }
  return h
}

test('a schedule card shows the state its actions report, completed before the save lands', () => {
  const h = cardHarness()
  // Completed on screen: the mark mounts unchecked and draws its tick over the next frames.
  h.changed = true
  const saving = h.render({ currentState: 'COMPLETED', isMutating: true })
  assert.match(saving, /class="schedule-card schedule-state--completed is-completed"/)
  assert.match(saving, /aria-busy="true"/)
  assert.match(saving, /<span class="motion-strike" data-done="true">일정 5<\/span>/)
  // The mark is drawn while the completion saves and is not dimmed by it.
  assert.match(saving, /<input type="checkbox" aria-label="완료 상태" readOnly=""\/>/)
  assert.doesNotMatch(saving, /schedule-card__quick-complete/)
  h.changed = false
  const settled = h.render({ currentState: 'COMPLETED', canCancel: false })
  assert.match(settled, /<input type="checkbox" disabled="" aria-label="완료 상태" readOnly="" checked=""\/>/, 'without permission to reopen, the mark is disabled')
  const open = h.render({ currentState: 'NOT_STARTED' })
  assert.match(open, /<button type="button" class="schedule-card__quick-complete" aria-label="즉시 완료">/)
  assert.doesNotMatch(open, /motion-strike" data-done/)
})

const playerHarness = () => {
  const h = { actions: null, active: { id: 4, title: '집중', state: 'IN_PROGRESS' } }
  let last
  const player = markup('features/schedules/components/MiniPlayerBar.tsx', {
    '../hooks/useActiveSchedule.ts': () => h.active,
    '../hooks/useScheduleActions.ts': () => h.actions,
    '@contexts/ScheduleCacheContext': { useScheduleCache: () => ({ activeScheduleId: 4 }) },
    './MiniPlayerBar.css': {},
    './ScheduleState.css': {},
    '@constants/schedules': {
      stateIcon: { IN_PROGRESS: 'play', SUSPENDED: 'pause', COMPLETED: 'check' },
      stateLabel: { IN_PROGRESS: '진행 중', SUSPENDED: '일시정지', COMPLETED: '완료' },
    },
    '@shared/routing/RouteSurface': { useRouteSurfaceNavigation: () => ({ open() {} }) },
    '@shared/motion': {
      useChangedWhileMounted: () => false,
      // Keeps the last value through its exit, like the real hook.
      usePresence: (value) => {
        if (value) last = value
        return value ? { mounted: true, closing: false, value } : { mounted: Boolean(last), closing: Boolean(last), value: last }
      },
    },
  })
  h.render = (actions) => {
    h.actions = { currentState: 'IN_PROGRESS', canPause: true, canStart: false, canComplete: true, canCancel: true, isMutating: false, lastError: null, ...actions }
    return renderToStaticMarkup(React.createElement(player))
  }
  return h
}

test('the mini player disables controls by permission only and never dims while it saves', () => {
  const h = playerHarness()
  const disabled = (html) => [...html.matchAll(/<button class="mini-player__button[^"]*"[^>]*?( disabled="")?[^>]*aria-label="([^"]+)"/g)]
    .filter(([, flag]) => flag)
    .map(([, , label]) => label)
  assert.deepEqual(disabled(h.render({})), [])
  assert.deepEqual(disabled(h.render({ canComplete: false, canCancel: false })), ['완료', '취소하고 미시작으로'])
  // Pausing: the cached permissions still belong to the running state until the save lands.
  const saving = h.render({ currentState: 'SUSPENDED', canStart: false, canComplete: false, canCancel: false, isMutating: true })
  assert.deepEqual(disabled(saving), [])
  assert.match(saving, /aria-busy="true"/)
  // A completed schedule slides the bar away instead of removing it at once.
  h.active = { ...h.active, state: 'COMPLETED' }
  const leaving = h.render({ currentState: 'COMPLETED' })
  assert.match(leaving, /<div class="mini-player-wrapper" inert=""><aside class="mini-player schedule-state--completed"[^>]*data-state="closing">/)
  assert.match(leaving, /집중/)
})
