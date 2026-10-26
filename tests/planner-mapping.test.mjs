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
const mapping = loadModule('../src/features/planner/utils/planMapping.ts')

// vm 컨텍스트의 객체는 다른 realm이라 deepStrictEqual 전에 평범한 값으로 옮긴다.
const plain = (value) => JSON.parse(JSON.stringify(value))

test('ISO-8601 durations from the server parse to whole minutes', () => {
  const cases = {
    PT45M: 45,
    PT1H: 60,
    PT1H30M: 90,
    PT24H: 1440,
    PT0S: 0,
    PT90S: 1,
    'PT1H0M30S': 60,
    P1D: 1440,
    P1DT2H: 1560,
    pt15m: 15,
  }
  for (const [value, minutes] of Object.entries(cases)) {
    assert.equal(duration.parseIsoDurationMinutes(value), minutes, value)
  }
  for (const invalid of ['', 'P', 'PT', '45', '01:00:00', 'PT-5M', 'P1W', null, undefined]) {
    assert.equal(duration.parseIsoDurationMinutes(invalid), null, String(invalid))
  }
})

test('minutes format to ISO-8601 for requests and to Korean labels for display', () => {
  assert.equal(duration.minutesToIsoDuration(0), 'PT0S')
  assert.equal(duration.minutesToIsoDuration(45), 'PT45M')
  assert.equal(duration.minutesToIsoDuration(60), 'PT1H')
  assert.equal(duration.minutesToIsoDuration(90), 'PT1H30M')
  assert.equal(duration.minutesToIsoDuration(1440), 'PT24H')
  for (const minutes of [5, 15, 45, 90, 125, 1440]) {
    assert.equal(duration.parseIsoDurationMinutes(duration.minutesToIsoDuration(minutes)), minutes, 'round trip')
  }

  assert.equal(duration.formatMinutesLabel(0), '0분')
  assert.equal(duration.formatMinutesLabel(45), '45분')
  assert.equal(duration.formatMinutesLabel(120), '2시간')
  assert.equal(duration.formatMinutesLabel(90), '1시간 30분')
  assert.equal(duration.formatIsoDurationLabel('PT3H'), '3시간')
  assert.equal(duration.formatIsoDurationLabel('nope'), null)
})

test('duration inputs follow the server range and treat blank as "not entered"', () => {
  assert.deepEqual(plain(duration.parseDurationInput('')), { kind: 'empty' })
  assert.deepEqual(plain(duration.parseDurationInput('  ')), { kind: 'empty' })
  assert.deepEqual(plain(duration.parseDurationInput('45')), { kind: 'value', minutes: 45 })
  assert.deepEqual(plain(duration.parseDurationInput('5')), { kind: 'value', minutes: 5 })
  assert.deepEqual(plain(duration.parseDurationInput('1440')), { kind: 'value', minutes: 1440 })
  assert.deepEqual(plain(duration.parseDurationInput('0', { zeroIsEmpty: true })), { kind: 'empty' })
  for (const invalid of ['0', '4', '1441', '1.5', '-5', 'abc']) {
    assert.equal(duration.parseDurationInput(invalid).kind, 'invalid', invalid)
  }
})

test('every UnplacedReason and BlockRejection reason has a Korean label', () => {
  const unplaced = ['NO_FITTING_SLOT', 'DAILY_OBJECTIVE_EXCEEDED', 'PREDECESSOR_NOT_PLACED']
  const rejections = [
    'TASK_NOT_FOUND', 'TASK_COMPLETED', 'TASK_ALREADY_SCHEDULED', 'DUPLICATE_TASK', 'STARTS_IN_PAST',
    'OVERLAPS_BLOCK', 'OVERLAPS_SCHEDULE', 'PREDECESSOR_ENDS_AFTER_START', 'PREDECESSOR_NOT_SCHEDULED',
  ]
  assert.deepEqual(Object.keys(mapping.UNPLACED_REASON_LABEL).sort(), [...unplaced].sort())
  assert.deepEqual(Object.keys(mapping.BLOCK_REJECTION_LABEL).sort(), [...rejections].sort())

  const hangul = /[가-힣]/
  for (const reason of unplaced) {
    const label = mapping.unplacedReasonLabel(reason)
    assert.match(label, hangul, reason)
    assert.ok(!label.includes(reason), `${reason} label is not the raw code`)
  }
  for (const reason of rejections) {
    const label = mapping.blockRejectionLabel(reason)
    assert.match(label, hangul, reason)
    assert.ok(!label.includes(reason), `${reason} label is not the raw code`)
  }
  assert.equal(new Set(rejections.map(mapping.blockRejectionLabel)).size, rejections.length, 'labels are distinct')

  // 서버가 나중에 사유를 늘려도 화면이 깨지지 않고 코드를 보여 준다.
  assert.match(mapping.unplacedReasonLabel('NEW_REASON'), /NEW_REASON/)
  assert.match(mapping.blockRejectionLabel('NEW_REASON'), /NEW_REASON/)
  assert.match(mapping.blockRejectionLabel('toString'), /toString/, 'prototype keys are not labels')
})

test('a 409 body maps each rejection back to the block the user submitted', () => {
  const body = {
    status: 409,
    error: 'Conflict',
    message: 'Plan rejected, no schedule was created: ...',
    errors: [],
    rejections: [
      { blockIndex: 0, taskId: 7, reason: 'OVERLAPS_BLOCK', detail: 'overlaps block 1 (task 8) 2026-10-28T09:30–2026-10-28T10:30' },
      { blockIndex: 1, taskId: 8, reason: 'OVERLAPS_BLOCK', detail: 'overlaps block 0 (task 7)' },
      { blockIndex: 1, taskId: 8, reason: 'STARTS_IN_PAST' },
      { blockIndex: 2, taskId: 9, reason: 'TASK_ALREADY_SCHEDULED', detail: '  ' },
      { blockIndex: 'x', reason: 'TASK_COMPLETED' },
      null,
    ],
  }
  const rejections = mapping.parsePlanRejections(body)
  assert.equal(rejections.length, 4, 'malformed entries are skipped')

  const byTask = plain(mapping.mapRejectionsToBlocks(rejections, [7, 8, 9]))
  assert.deepEqual(Object.keys(byTask).sort(), ['7', '8', '9'])
  assert.deepEqual(byTask[7], [{
    reason: 'OVERLAPS_BLOCK',
    message: mapping.BLOCK_REJECTION_LABEL.OVERLAPS_BLOCK,
    detail: 'overlaps block 1 (task 8) 2026-10-28T09:30–2026-10-28T10:30',
  }])
  assert.deepEqual(byTask[8].map((issue) => issue.reason), ['OVERLAPS_BLOCK', 'STARTS_IN_PAST'])
  assert.deepEqual(byTask[9], [{ reason: 'TASK_ALREADY_SCHEDULED', message: mapping.BLOCK_REJECTION_LABEL.TASK_ALREADY_SCHEDULED }])

  // 위치와 작업 ID가 어긋나면 응답의 작업 ID를 믿는다.
  const mismatched = plain(mapping.mapRejectionsToBlocks([{ blockIndex: 0, taskId: 9, reason: 'TASK_COMPLETED' }], [7, 9]))
  assert.deepEqual(Object.keys(mismatched), ['9'])

  assert.equal(mapping.parsePlanRejections({ status: 409, message: 'Conflict' }), null, 'plain 409 is not a plan rejection')
  assert.equal(mapping.parsePlanRejections('Conflict'), null)
  assert.equal(mapping.parsePlanRejections(null), null)
})

test('client-side selection checks catch past starts and [start, end) overlaps only', () => {
  const at = (hh, mm = 0) => Date.UTC(2026, 9, 28, hh, mm)
  const blocks = [
    { taskId: 1, title: 'A', startMs: at(9), endMs: at(10) },
    { taskId: 2, title: 'B', startMs: at(10), endMs: at(11) }, // A와 맞닿음: 겹침 아님
    { taskId: 3, title: 'C', startMs: at(10, 30), endMs: at(11, 30) }, // B와 겹침
    { taskId: 4, title: 'D', startMs: at(7), endMs: at(8) }, // 지난 시각
    { taskId: 5, title: 'E', startMs: null, endMs: null },
    { taskId: 6, title: 'F', startMs: at(13), endMs: at(14) }, // 기존 일정과 겹침
  ]
  const obstacles = [
    { title: '회의', startMs: at(13, 30), endMs: at(14, 30) },
    { title: '점심', startMs: at(12), endMs: at(13) }, // F와 맞닿음
  ]
  const issues = plain(mapping.validatePlanSelection(blocks, obstacles, at(8, 30)))

  assert.equal(issues[1], undefined)
  assert.deepEqual(issues[2].map((i) => i.reason), ['OVERLAPS_BLOCK'])
  assert.match(issues[2][0].message, /"C"/)
  assert.deepEqual(issues[3].map((i) => i.reason), ['OVERLAPS_BLOCK'])
  assert.match(issues[3][0].message, /"B"/)
  assert.deepEqual(issues[4].map((i) => i.reason), ['STARTS_IN_PAST'])
  assert.equal(issues[5].length, 1)
  assert.equal(issues[5][0].reason, undefined)
  assert.deepEqual(issues[6].map((i) => i.reason), ['OVERLAPS_SCHEDULE'])
  assert.match(issues[6][0].message, /회의/)

  assert.deepEqual(plain(mapping.validatePlanSelection([], obstacles, at(8))), {})
})

test('date keys from the URL are accepted only when they are real calendar dates', () => {
  const dateKey = loadModule('../src/shared/utils/dateKey.ts')
  assert.deepEqual(plain(dateKey.parseDateKey('2026-10-27')), { year: 2026, month: 10, day: 27 })
  assert.deepEqual(plain(dateKey.parseDateKey('2028-02-29')), { year: 2028, month: 2, day: 29 })
  for (const invalid of ['2026-02-29', '2026-13-01', '2026-10-32', '2026-1-5', '20261027', '2026-10-27T00:00', '', null, undefined]) {
    assert.equal(dateKey.parseDateKey(invalid), null, String(invalid))
  }
})
