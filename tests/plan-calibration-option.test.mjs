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
let report = { plan: null, schedules: [], isLoading: false, error: null }
const source = readFileSync(
  new URL('../src/features/planner/pages/PlanPage.tsx', import.meta.url),
  'utf8',
)
const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
    jsx: ts.JsxEmit.ReactJSX,
  },
})
const module = { exports: {} }
const planMotion = (() => {
  const { outputText: code } = ts.transpileModule(
    readFileSync(
      new URL('../src/features/planner/utils/planMotion.ts', import.meta.url),
      'utf8',
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  )
  const loaded = { exports: {} }
  vm.runInNewContext(code, { module: loaded, exports: loaded.exports, Set, Map })
  return loaded.exports
})()
const dependencies = {
  '../utils/planMotion': planMotion,
  'react-router-dom': {
    Link: ({ to, children }) =>
      React.createElement('a', { href: to }, children),
    useSearchParams: () => [new URLSearchParams(), () => {}],
  },
  '@contexts/TimePreferencesContext': {
    useTimePreferences: () => ({ zoneId: 'UTC', offsetMinutes: 0 }),
  },
  '@contexts/ToastContext': { useToast: () => ({ addToast: () => {} }) },
  '@contexts/ScheduleCacheContext': {
    useScheduleCache: () => ({ upsertSchedule: () => {} }),
  },
  '@constants/schedules': {
    scheduleTypeLabel: {
      DEEP_WORK: '집중 작업',
      QUICK_TASK: '빠른 일정',
      ADMIN_TASK: '행정 작업',
    },
  },
  '@shared/utils/datetime': { getTodayWithOffset: () => dayjs('2026-11-03') },
  '@shared/utils/safeStorage': { NUDGE_KEYS: {}, readFlag: () => false },
  '@features/calibration/utils/calibrationView': {
    hasUsableFactor: () => false,
  },
  '../utils/planMapping': {
    MAX_APPLY_BLOCKS: 100,
    validatePlanSelection: () => ({}),
    findRoutineConflicts: () => ({}),
  },
  '../hooks/useDayPlan': () => ({
    planKey: null,
    isInitialLoading: report.isLoading && !report.plan,
    ...report,
  }),
  '../components/DayReplanningPanel': () => null,
  '@shared/components/common/StatusPanel': ({ title, description }) =>
    React.createElement('div', null, title, description),
  '@shared/routing/RouteSurface': {
    useRouteSurfaceNavigation: () => ({ open: () => {} }),
  },
  '@shared/routing/viewTransitionNavigation': { tabLinkClick: () => () => {} },
  '@shared/motion/useListPresence': {
    useListPresence: (items, getKey) =>
      (items ?? []).map((item) => ({
        key: String(getKey(item)),
        item,
        phase: 'present',
      })),
    presenceProps: () => ({}),
  },
  '@shared/motion/usePresence': {
    usePresence: (value) => ({
      mounted: Boolean(value),
      closing: false,
      value: value || undefined,
    }),
  },
  '@shared/motion/useTweenedNumber': { useTweenedNumber: (value) => value },
  '@shared/motion/tokens': { prefersReducedMotion: () => false },
}
vm.runInNewContext(outputText, {
  module,
  exports: module.exports,
  console,
  require: (name) =>
    name === 'react' || name === 'react/jsx-runtime' || name === 'dayjs'
      ? require(name)
      : (dependencies[name] ?? {}),
})
const render = () =>
  renderToStaticMarkup(React.createElement(module.exports.default))

test('calibration option remains visible with no plan or usable history and never opts in automatically', () => {
  report = { plan: null, schedules: [], isLoading: false, error: null }
  const html = render()
  assert.match(html, /기록 기반 보정/)
  assert.match(html, /id="plan-calibration-enabled"/)
  assert.match(html, /설정 확인 중/)
  assert.match(html, /type="checkbox" disabled=""/)
  assert.doesNotMatch(html, /type="checkbox"[^>]*checked=""/)
  assert.match(html, /최근 90일의 유효한 실행 기록이 5개 이상/)
  assert.match(html, /입력한 예상 시간 자체는 바꾸지 않습니다/)
})

test('plan loading and errors do not hide the independent calibration setting', () => {
  for (const state of [
    { isLoading: true, error: null },
    { isLoading: false, error: '계획 조회 실패' },
  ]) {
    report = { plan: null, schedules: [], ...state }
    const html = render()
    assert.match(html, /기록 기반 보정/)
    assert.match(html, /plan-calibration-description/)
    assert.match(html, /편집 중인 제안이 새 제안으로/)
  }
})
