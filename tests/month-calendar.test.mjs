import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import dayjs from 'dayjs'

const loadModule = (relativePath) => {
  const { outputText } = ts.transpileModule(readFileSync(new URL(relativePath, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  const module = { exports: {} }
  vm.runInNewContext(outputText, { module, exports: module.exports, Set })
  return module.exports
}

const grid = loadModule('../src/features/schedules/utils/monthGrid.ts')
const keys = (days) => days.map((day) => day.format('YYYY-MM-DD'))

test('the grid starts on the Monday of the week holding the 1st', () => {
  // 2026-10-01 is a Thursday.
  assert.equal(grid.monthGridStart(dayjs('2026-10-15')).format('YYYY-MM-DD'), '2026-09-28')
  // 2026-06-01 is a Monday.
  assert.equal(grid.monthGridStart(dayjs('2026-06-20')).format('YYYY-MM-DD'), '2026-06-01')
})

test('the grid covers whole weeks through the last day of the month', () => {
  const october = grid.monthGridDays(dayjs('2026-10-01'))
  assert.equal(october.length, 35)
  assert.equal(keys(october).at(-1), '2026-11-01')
  // 2026-08 runs Sat 1st to Mon 31st, so it needs six weeks.
  assert.equal(grid.monthWeekStarts(dayjs('2026-08-10')).length, 6)
  // 2027-02 runs Mon 1st to Sun 28th: exactly four weeks.
  assert.equal(grid.monthGridDays(dayjs('2027-02-01')).length, 28)
})

test('schedules fetched twice across week boundaries are counted once per day', () => {
  const items = [
    { id: 1, state: 'COMPLETED', day: '2026-10-27' },
    { id: 2, state: 'NOT_STARTED', day: '2026-10-27' },
    { id: 1, state: 'COMPLETED', day: '2026-10-27' },
    { id: 3, state: 'IN_PROGRESS', day: '2026-10-28' },
  ]
  const summary = JSON.parse(JSON.stringify(grid.summarizeByDate(items, (item) => item.day)))
  assert.deepEqual(summary, { '2026-10-27': { total: 2, completed: 1 }, '2026-10-28': { total: 1, completed: 0 } })
})

test('the day label says how many schedules are left', () => {
  assert.equal(grid.describeDay('10월 27일', undefined), '10월 27일, 일정 없음')
  assert.equal(grid.describeDay('10월 27일', { total: 3, completed: 1 }), '10월 27일, 일정 3개, 남은 일정 2개')
  assert.equal(grid.describeDay('10월 27일', { total: 2, completed: 2 }), '10월 27일, 일정 2개 모두 완료')
})
