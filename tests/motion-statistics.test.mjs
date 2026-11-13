import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import React from 'react'
import * as jsxRuntime from 'react/jsx-runtime'
import { renderToStaticMarkup } from 'react-dom/server'
import dayjs from 'dayjs'
import isoWeek from 'dayjs/plugin/isoWeek.js'
import timezone from 'dayjs/plugin/timezone.js'
import utc from 'dayjs/plugin/utc.js'
import { requireFrom } from './support/errors.mjs'

const plain = (value) => JSON.parse(JSON.stringify(value))
const read = (path) => readFileSync(new URL('../src/features/statistics/' + path, import.meta.url), 'utf8')

const load = (path, dependencies = {}, globals = {}) => {
  const { outputText } = ts.transpileModule(read(path), {
    fileName: path,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  })
  const module = { exports: {} }
  vm.runInNewContext(outputText, {
    module,
    exports: module.exports,
    Error,
    JSON,
    Math,
    Number,
    Object,
    console: { warn() {}, error() {}, log() {} },
    require: requireFrom(dependencies),
    ...globals,
  })
  return module.exports
}

/**
 * A tiny stand-in for React's useState, enough to run hooks that set state during render
 * (React re-runs the component at once in that case). Each `render` call is one commit.
 */
const hookRunner = () => {
  const slots = []
  let index = 0
  let dirty = false
  const react = {
    useState(initial) {
      const slot = index++
      if (!(slot in slots)) slots[slot] = typeof initial === 'function' ? initial() : initial
      return [
        slots[slot],
        (next) => {
          slots[slot] = typeof next === 'function' ? next(slots[slot]) : next
          dirty = true
        },
      ]
    },
    useRef: (value) => ({ current: value }),
    useEffect() {},
  }
  const render = (hook) => {
    let result
    for (let pass = 0; pass < 10; pass++) {
      index = 0
      dirty = false
      result = hook()
      if (!dirty) return result
    }
    throw new Error('render loop')
  }
  return { react, render }
}

const motionTokens = load('../../shared/motion/tokens.ts')
const motionStub = {
  ...motionTokens,
  playRise: load('../../shared/motion/playRise.ts', { './tokens': motionTokens }).playRise,
}

// ---------------------------------------------------------------------------
// Chart geometry: bars and the donut move by transform and stroke-dashoffset
// ---------------------------------------------------------------------------

const chart = load('utils/chartMotion.ts')

test('a bar is pushed out of its track by the share it does not fill', () => {
  assert.equal(chart.barHiddenPercent(1), 0)
  assert.equal(chart.barHiddenPercent(0), 100)
  assert.equal(chart.barHiddenPercent(0.25), 75)
  assert.equal(chart.barHiddenPercent(1 / 3), 66.7)
  assert.equal(chart.barHiddenPercent(1.4), 0, 'a ratio above 1 fills the track')
  assert.equal(chart.barHiddenPercent(-2), 100)
  assert.equal(chart.barHiddenPercent(Number.NaN), 100, 'no value draws no bar')
})

test('day columns keep the old 3px floor and scale to the longest day', () => {
  assert.equal(chart.columnRatio(60, 120, 3 / 130), 0.5)
  assert.equal(chart.columnRatio(1, 1000, 3 / 130), 3 / 130)
  assert.equal(chart.columnRatio(0, 120, 3 / 130), 3 / 130)
  assert.equal(chart.columnRatio(120, 0), 0)
})

test('the donut draws the allocated share under the deep-work share', () => {
  assert.deepEqual(plain(chart.donutOffsets(40, 25)), { deep: 60, allocated: 35 })
  assert.deepEqual(plain(chart.donutOffsets(0, 0)), { deep: 100, allocated: 100 })
  assert.deepEqual(plain(chart.donutOffsets(80, 40)), { deep: 20, allocated: 0 }, 'never past a full ring')
})

test('moving to an earlier period comes in from the left', () => {
  assert.equal(chart.periodDirection('2026-11-09', '2026-11-02'), -1)
  assert.equal(chart.periodDirection('2026-10-01', '2026-11-01'), 1)
  assert.equal(chart.periodDirection('2026-11-09', '2026-11-09'), 0)
})

// ---------------------------------------------------------------------------
// useReport: cached per key, one refetch per change batch, the old API kept
// ---------------------------------------------------------------------------

const reportHook = (query) => {
  const calls = []
  const { default: useReport } = load('hooks/useReport.ts', {
    '@shared/hooks/useRevalidatingQuery': {
      default: (key, fetcher, options) => {
        calls.push({ key, fetcher, options })
        return { refetch: () => 'refetched', ...query }
      },
    },
  })
  return { useReport, calls }
}

const entry = (patch = {}) => ({
  data: undefined,
  error: null,
  isInitialLoading: false,
  isRefreshing: false,
  isFetching: false,
  ...patch,
})

test('useReport reads through the shared query cache under a report/ key', async () => {
  const { useReport, calls } = reportHook(entry({ data: { n: 1 } }))
  const result = useReport(() => Promise.resolve({ n: 2 }), 'period:WEEK:2026-11-09')
  assert.equal(calls[0].key, 'report/period:WEEK:2026-11-09')
  assert.deepEqual([...calls[0].options.invalidateOn].sort(), ['schedule', 'task'])
  assert.deepEqual(plain(await calls[0].fetcher(new AbortController().signal)), { n: 2 })
  assert.deepEqual(plain(result.data), { n: 1 })
  assert.equal(result.reload(), 'refetched')
})

test('useReport keeps the hub contract: null data, the same error text, loading while fetching', () => {
  const { useReport, calls } = reportHook(entry({ isInitialLoading: true, isFetching: true }))
  const first = useReport(() => Promise.resolve(null), 'summary:null', '흐름을 불러오지 못했어요.')
  assert.equal(first.data, null)
  assert.equal(first.isLoading, true)
  assert.equal(calls[0].options.errorMessage, '흐름을 불러오지 못했어요.', 'each section names what failed; the query adds the server text or the retry hint')

  const empty = reportHook(entry({ data: null })).useReport(() => Promise.resolve(null), 'summary:null')
  assert.equal(empty.data, null, 'a loaded null stays null')
  assert.equal(empty.isLoading, false)
})

test('a retry without data shows loading instead of the last failure', () => {
  const retrying = reportHook(entry({ error: '실패', isFetching: true })).useReport(
    () => Promise.resolve(1),
    'trend:WEEK:',
  )
  assert.equal(retrying.error, null)
  assert.equal(retrying.isLoading, true)

  const failedRefresh = reportHook(entry({ data: 3, error: '실패', isRefreshing: true, isFetching: true }))
    .useReport(() => Promise.resolve(1), 'trend:WEEK:')
  assert.equal(failedRefresh.error, '실패', 'with data on screen the failure is reported inline')
  assert.equal(failedRefresh.data, 3)
  assert.equal(failedRefresh.isRefreshing, true)
})

// ---------------------------------------------------------------------------
// Holding the frame while another period loads
// ---------------------------------------------------------------------------

const motionHooks = () => {
  const runner = hookRunner()
  const hooks = load('hooks/useReportMotion.ts', { react: runner.react, '@shared/motion': motionStub })
  return { ...hooks, render: runner.render }
}

test('a period switch keeps the last frame, flagged as held, until the new data arrives', () => {
  const { useHeldValue, render } = motionHooks()
  assert.deepEqual(plain(render(() => useHeldValue(null))), { shown: null, held: false }, 'a first load holds nothing')
  const week1 = { start: '2026-11-02' }
  assert.deepEqual(plain(render(() => useHeldValue(week1))), { shown: week1, held: false })
  assert.deepEqual(plain(render(() => useHeldValue(null))), { shown: week1, held: true })
  const week2 = { start: '2026-10-26' }
  assert.deepEqual(plain(render(() => useHeldValue(week2))), { shown: week2, held: false })
  assert.deepEqual(plain(render(() => useHeldValue(null))), { shown: week2, held: true }, 'it holds the latest frame')
})

test('a change fade plays on a real change, not when the value first appears', () => {
  // Refs and effects that persist across renders, like React's, for one mounted component.
  const refs = []
  const effects = []
  let index = 0
  let effectIndex = 0
  const react = {
    useState: (initial) => [initial, () => {}],
    useRef(value) {
      const slot = index++
      if (!(slot in refs)) refs[slot] = { current: value }
      return refs[slot]
    },
    useEffect(run, deps) {
      const slot = effectIndex++
      const prev = effects[slot]
      if (prev && deps && deps.every((dep, i) => Object.is(dep, prev[i]))) return
      effects[slot] = deps
      run()
    },
  }
  const { useChangeFade } = load('hooks/useReportMotion.ts', { react, '@shared/motion': motionStub })
  const played = []
  const element = { animate: (frames) => { played.push(frames[0]); return { cancel() {} } } }
  const render = (dep, direction) => {
    index = 0
    effectIndex = 0
    const ref = useChangeFade(dep, direction)
    ref.current = element
  }
  render(null)
  render(false)
  assert.equal(played.length, 0, 'null to a value is the first appearance, which .report-reveal handles')
  render(true)
  assert.equal(played.length, 1, 'an empty list becoming filled fades once')
  render(true)
  assert.equal(played.length, 1, 'the same value does not replay')
  render('2026-11-02', 1)
  assert.equal(played.length, 2)
})

// Source check kept: which rules may start a chart keyframe is a CSS property, with no runtime here.
test('chart entrance keyframes play only inside a reveal, so a cached render does not refill the bars', () => {
  const css = cssFilesForEntrance.map(read).join('\n')
  for (const name of ['stats-bar-rise', 'stats-bar-slide', 'stats-ring-draw']) {
    // Each rule is "selector { body }"; find the rules whose animation names this keyframe.
    const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
    const uses = rules.filter(([, , body]) => body.includes('animation:') && body.includes(name))
    assert.ok(uses.length > 0, `${name} is used`)
    for (const [, selector] of uses) assert.match(selector, /\.report-reveal\s/, `${name} runs outside .report-reveal: ${selector.trim()}`)
  }
})

// ---------------------------------------------------------------------------
// useWeeklyStatistics keeps its API for the schedules tab
// ---------------------------------------------------------------------------

test('weekly statistics come from the query cache per week and refetch on schedule changes', async () => {
  const calls = []
  const requests = []
  const time = (label) => ({ dateTime: label, zoneId: 'Asia/Seoul' })
  const base = { label: 'w', subtract: () => ({ label: 'w-1' }) }
  const { default: useWeeklyStatistics } = load(
    'hooks/useWeeklyStatistics.ts',
    {
      react: { useMemo: (fn) => fn() },
      '../api/statistics': {
        fetchWeeklyStatistics: async ({ time: t }) => {
          requests.push(t.dateTime)
          if (t.dateTime === 'w-1') throw new Error('previous down')
          return { total: 90 }
        },
      },
      '@shared/utils/statisticsTransform': { toWeeklyStatisticsView: (r) => ({ totalMinutes: r.total }) },
      '@shared/utils/datetime': {
        getTodayWithOffset: () => base,
        toApiDateTimeWithZone: (value) => time(value.label),
      },
      '@contexts/TimePreferencesContext': { useTimePreferences: () => ({ offsetMinutes: 540 }) },
      '@shared/hooks/useRevalidatingQuery': {
        default: (key, fetcher, options) => {
          calls.push({ key, fetcher, options })
          return {
            data: { current: { totalMinutes: 30 }, previous: null },
            error: null,
            isInitialLoading: false,
            isRefreshing: true,
            refetch: () => 'refetched',
          }
        },
      },
    },
  )
  const result = useWeeklyStatistics({ weekStart: base })
  assert.equal(calls[0].key, 'weekly-statistics/' + JSON.stringify(time('w')))
  assert.deepEqual([...calls[0].options.invalidateOn], ['schedule'])
  assert.deepEqual(plain(result), {
    current: { totalMinutes: 30 },
    previous: null,
    isLoading: false,
    isRefreshing: true,
    error: null,
  })
  assert.equal(result.refetch(), 'refetched')
  const pair = await calls[0].fetcher(new AbortController().signal)
  assert.deepEqual(plain(pair), { current: { totalMinutes: 90 }, previous: null }, 'a failed previous week is tolerated')
  assert.deepEqual(requests, ['w', 'w-1'])
  assert.equal(calls[0].options.errorMessage('x'), '통계를 불러오지 못했어요. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.')
})

// ---------------------------------------------------------------------------
// Styles: only transform, opacity, color and stroke move; no remount fades
// ---------------------------------------------------------------------------

const cssFiles = [
  ...readdirSync(new URL('../src/features/statistics/components/', import.meta.url))
    .filter((name) => name.endsWith('.css'))
    .map((name) => 'components/' + name),
  'pages/StatisticsTabPage.css',
]
const cssFilesForEntrance = ['components/ReportSections.css', 'components/DonutChart.css']
const shared = ['motion-fade-in', 'motion-fade-out', 'motion-rise-in', 'motion-rise-out', 'motion-drop-in',
  'motion-sheet-in', 'motion-sheet-out', 'modalFadeIn', 'modalSlideUp', 'fadeIn', 'fadeSlideIn']

// Source check kept: CSS never runs in these tests, so the motion contract is read from the stylesheets.
test('statistics styles never animate size or use catch-all transitions', () => {
  for (const path of cssFiles) {
    const css = read(path)
    assert.doesNotMatch(css, /transition:\s*all\b/, path)
    for (const block of css.match(/transition(?:-property)?:[^;]+;/g) ?? [])
      assert.doesNotMatch(block, /\b(width|height|top|left|margin|flex-grow)\b/, `${path}: ${block}`)
    for (const name of shared) assert.doesNotMatch(css, new RegExp(`@keyframes\\s+${name}\\b`), `${path} redefines ${name}`)
    assert.doesNotMatch(css, /fadeSlideIn|stats-transition/, `${path} keeps a remount fade`)
    assert.doesNotMatch(css, /\d+ms\s+ease\b/, `${path} uses a raw duration instead of the tokens`)
  }
})

// ---------------------------------------------------------------------------
// Sections: their own cache keys, my schedules across spaces, bars by transform
// ---------------------------------------------------------------------------

dayjs.extend(utc)
dayjs.extend(timezone)
dayjs.extend(isoWeek)

/** Renders a section with a stub useReport that records each read and answers with `report`. */
const renderSection = (path, props, { report = {}, api = {}, utils = {} } = {}) => {
  const reads = []
  const element = (Component, sectionProps = {}) => React.createElement(Component, sectionProps)
  const { default: Section } = load(path, {
    react: React,
    'react/jsx-runtime': jsxRuntime,
    dayjs: { default: dayjs },
    '../hooks/useReport': {
      default: (fetcher, key) => {
        reads.push({ fetcher, key })
        return { data: undefined, error: null, isLoading: true, isRefreshing: false, reload() {}, ...report }
      },
    },
    '../hooks/useReportMotion': {
      useHeldValue: (data) => ({ shown: data ?? null, held: false }),
      useChangeFade: () => ({ current: null }),
    },
    '@shared/motion': { useArrival: () => false, useListPresence: () => [], presenceProps: () => ({}) },
    '@contexts/TimePreferencesContext': { useTimePreferences: () => ({ zoneId: 'Asia/Seoul' }) },
    '../api/report': {},
    '@features/schedules/api/schedules': {},
    '../utils/chartMotion': chart,
    '../utils/reportView': {},
    '../utils/planComparison': {},
    '@shared/utils/isoDuration': {},
    '@shared/utils/statisticsTransform': {},
    '@shared/utils/datetime': {},
    './StatisticCard': { default: () => null },
    './DonutChart': { default: () => null },
    './SpaceTimeSection': { default: () => null },
    '@shared/components/motion/TweenedNumber': { default: () => null },
    '@shared/components/common/WorkspaceIcon': { default: () => null },
    'react-router-dom': { Link: () => null },
    './ReportSections.css': {},
    './PlanComparisonSection.css': {},
    ...api,
    ...utils,
  })
  const markup = renderToStaticMarkup(element(Section, props))
  return { reads, markup }
}

const sections = {
  period: 'components/PeriodSummarySection.tsx',
  trend: 'components/TrendSection.tsx',
  plan: 'components/PlanComparisonSection.tsx',
  recurrence: 'components/RecurrenceStatsSection.tsx',
}

test('every statistics section caches under its own key, and per period where it has one', () => {
  const keyOf = (path, props) => renderSection(path, props).reads[0].key
  const week = { unit: 'WEEK', start: '2026-11-09' }
  const keys = [
    keyOf(sections.period, week),
    keyOf(sections.trend, { unit: 'WEEK' }),
    keyOf(sections.plan, week),
    keyOf(sections.recurrence, {}),
  ]
  assert.equal(new Set(keys).size, keys.length, keys.join(', '))
  const lastWeek = { unit: 'WEEK', start: '2026-11-02' }
  assert.notEqual(keyOf(sections.period, lastWeek), keys[0])
  assert.notEqual(keyOf(sections.plan, lastWeek), keys[2])
  assert.notEqual(keyOf(sections.plan, { unit: 'MONTH', start: '2026-11-01' }), keyOf(sections.plan, { unit: 'WEEK', start: '2026-11-01' }))
  assert.notEqual(keyOf(sections.trend, { unit: 'MONTH' }), keys[1])
})

test('the plan comparison section asks for my schedules across spaces', async () => {
  const weekly = []
  const { reads } = renderSection(sections.plan, { unit: 'WEEK', start: '2026-11-09' }, {
    api: {
      '../api/report': { fetchPeriodStatistics: async () => ({}) },
      '@features/schedules/api/schedules': {
        fetchWeeklySchedules: async (anchor, options) => {
          weekly.push(options)
          return []
        },
      },
    },
    utils: {
      '../utils/planComparison': { summarizePlans: () => ({}) },
      '@shared/utils/datetime': { toDateKey: () => '' },
      '@shared/utils/isoDuration': { parseIsoDurationMinutes: () => null },
    },
  })
  await reads[0].fetcher()
  assert.ok(weekly.length > 0)
  for (const options of weekly) assert.deepEqual(plain(options), { allSpaces: true, mine: true })
})

test('trend bars move by transform, never by an inline width or height', () => {
  const bars = [
    { label: '11/02', minutes: 60, ratio: 0.5, completionRate: 0.5, current: false },
    { label: '11/09', minutes: 120, ratio: 1, completionRate: 1, current: true },
  ]
  const { markup } = renderSection(sections.trend, { unit: 'WEEK' }, {
    report: { data: { periods: [] }, isLoading: false },
    utils: {
      '../utils/reportView': { trendBars: () => bars, formatRate: (value) => `${value * 100}%` },
      '@shared/utils/statisticsTransform': { formatMinutesToTime: (minutes) => `${minutes}분` },
    },
  })
  const styles = [...markup.matchAll(/class="trend-chart__bar[^"]*" style="([^"]*)"/g)].map((match) => match[1])
  assert.deepEqual(styles, ['transform:translateY(50%)', 'transform:translateY(0%)'])
  assert.doesNotMatch(markup, /style="[^"]*\b(width|height):/)
})
