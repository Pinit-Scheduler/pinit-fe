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
  vm.runInNewContext(outputText, { module, exports: module.exports, Math })
  return module.exports
}

const shift = loadModule('../src/features/schedules/utils/timeShift.ts')
const at = (time) => dayjs(`2026-10-27T${time}:00`)

test('vertical drag snaps to 30-minute steps, down is later', () => {
  assert.equal(shift.stepsFromDelta(27), 0)
  assert.equal(shift.stepsFromDelta(28), 1)
  assert.equal(shift.stepsFromDelta(-60), -2)
  assert.ok(Object.is(shift.stepsFromDelta(-3), 0))
})

test('the start time stays inside the same day', () => {
  assert.equal(shift.shiftWithinDay(at('09:00'), 90).format('HH:mm'), '10:30')
  assert.equal(shift.shiftWithinDay(at('00:30'), -120).format('YYYY-MM-DD HH:mm'), '2026-10-27 00:00')
  assert.equal(shift.shiftWithinDay(at('22:00'), 180).format('YYYY-MM-DD HH:mm'), '2026-10-27 23:30')
  assert.equal(shift.appliedShiftMinutes(at('23:00'), 120), 30)
})

test('the shift label reads in hours and minutes', () => {
  assert.equal(shift.formatShift(0), '그대로')
  assert.equal(shift.formatShift(90), '+1시간 30분')
  assert.equal(shift.formatShift(-30), '−30분')
  assert.equal(shift.formatShift(120), '+2시간')
})
