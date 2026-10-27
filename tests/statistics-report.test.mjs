import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const loadModule = (relativePath, dependencies = {}) => {
  const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  const module = { exports: {} }
  vm.runInNewContext(outputText, {
    module,
    exports: module.exports,
    require: (name) => {
      assert.ok(name in dependencies, `Unexpected dependency: ${name}`)
      return dependencies[name]
    },
  })
  return module.exports
}

const duration = loadModule('../src/shared/utils/isoDuration.ts')
const report = loadModule('../src/features/statistics/utils/reportView.ts', {
  '@shared/utils/isoDuration': duration,
})

const plain = (value) => JSON.parse(JSON.stringify(value))

test('rates print as whole percents and completion lines say when nothing was planned', () => {
  assert.equal(report.formatRate(0.67), '67%')
  assert.equal(report.formatRate(1), '100%')
  assert.equal(report.formatRate(0), '0%')
  assert.equal(report.formatRate(null), '-')
  assert.equal(report.completionLine(20, 30, 0.67), '완료 20 / 30건 (67%)')
  assert.equal(report.completionLine(0, 0, null), '일정 없음')
})

test('every schedule type has a label, quick tasks included', () => {
  assert.deepEqual(plain(report.SCHEDULE_TYPE_LABEL), {
    DEEP_WORK: '집중 작업',
    ADMIN_TASK: '행정 작업',
    QUICK_TASK: '빠른 작업',
  })
})

test('months move across year boundaries', () => {
  assert.equal(report.monthStartOf('2026-10-27'), '2026-10-01')
  assert.equal(report.shiftMonth('2026-01-01', -1), '2025-12-01')
  assert.equal(report.shiftMonth('2026-12-01', 1), '2027-01-01')
  assert.equal(report.shiftMonth('2026-10-01', -13), '2025-09-01')
  assert.equal(report.monthLabel('2026-03-01'), '2026년 3월')
})

test('trend bars scale to the longest period and keep the server completion rate', () => {
  const bars = report.trendBars('WEEK', [
    { start: '2026-10-12', current: false, schedules: { elapsed: 'PT0S', completionRate: null } },
    { start: '2026-10-19', current: false, schedules: { elapsed: 'PT2H', completionRate: 0.5 } },
    { start: '2026-10-26', current: true, schedules: { elapsed: 'PT1H', completionRate: 1 } },
  ])
  assert.deepEqual(plain(bars), [
    { start: '2026-10-12', label: '10/12', minutes: 0, ratio: 0, completionRate: null, current: false },
    { start: '2026-10-19', label: '10/19', minutes: 120, ratio: 1, completionRate: 0.5, current: false },
    { start: '2026-10-26', label: '10/26', minutes: 60, ratio: 0.5, completionRate: 1, current: true },
  ])
  assert.equal(report.trendBars('MONTH', [
    { start: '2026-10-01', current: true, schedules: { elapsed: 'PT0S', completionRate: null } },
  ])[0].label, '10월')
})

test('streak lines count occurrences and pending today invites keeping the streak', () => {
  const base = { currentStreak: 3, longestStreak: 5, pendingToday: true, completedCount: 9, missedCount: 2 }
  assert.equal(report.streakLine(base), '3회 연속 (최장 5회)')
  assert.equal(report.pendingTodayLine(base), '오늘 하면 4회 연속이에요')
  assert.equal(report.streakLine({ ...base, currentStreak: 0 }), '연속 기록 없음 (최장 5회)')
  assert.equal(report.pendingTodayLine({ ...base, currentStreak: 0 }), '오늘 회차가 남아 있어요')
  assert.equal(report.pendingTodayLine({ ...base, pendingToday: false }), null)
  assert.equal(
    report.streakLine({ currentStreak: 0, longestStreak: 0, pendingToday: true, completedCount: 0, missedCount: 0 }),
    '아직 기록 없음',
  )
})
