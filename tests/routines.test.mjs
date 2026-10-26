import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const loadModule = (relativePath, dependencies = {}, globals = {}) => {
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
    ...globals,
  })
  return module.exports
}

const plain = (value) => JSON.parse(JSON.stringify(value))

const isoDuration = loadModule('../src/shared/utils/isoDuration.ts')
const rules = loadModule('../src/features/routines/utils/routineRules.ts', { '@shared/utils/isoDuration': isoDuration })
const mapping = loadModule('../src/features/planner/utils/planMapping.ts')
const storage = loadModule('../src/shared/utils/safeStorage.ts')

const ALL = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']
const WEEKDAYS = ALL.slice(0, 5)
let seq = 0
const draft = (overrides = {}) => ({
  key: `k${seq++}`,
  kind: 'LUNCH',
  label: '',
  startTime: '12:00',
  durationMinutes: 60,
  days: [...ALL],
  ...overrides,
})
const preset = (kind) => draft({ kind, startTime: rules.KIND_PRESET[kind].startTime, durationMinutes: rules.KIND_PRESET[kind].durationMinutes })

test('the four presets are valid together, including sleep across midnight', () => {
  const drafts = ['BREAKFAST', 'LUNCH', 'DINNER', 'SLEEP'].map(preset)
  assert.deepEqual(plain(rules.validateRoutineDrafts(drafts)), { byIndex: {}, general: [] })
  assert.deepEqual(plain(rules.KIND_PRESET.SLEEP), { startTime: '23:30', durationMinutes: 450 })
})

test('field rules mirror the server: label, clock, 5m–16h, at least one day, at most 20', () => {
  const drafts = [
    draft({ kind: 'CUSTOM', label: '   ' }),
    draft({ kind: 'CUSTOM', label: '가'.repeat(21), startTime: '01:00' }),
    draft({ startTime: '24:00', days: ['MONDAY'] }),
    draft({ durationMinutes: 4, startTime: '03:00', days: ['TUESDAY'] }),
    draft({ durationMinutes: 961, startTime: '04:00', days: [] }),
    draft({ durationMinutes: null, startTime: '05:00', days: ['WEDNESDAY'] }),
  ]
  const { byIndex, general } = plain(rules.validateRoutineDrafts(drafts))
  assert.deepEqual(byIndex[0].map((i) => i.field), ['label'])
  assert.deepEqual(byIndex[1].map((i) => i.field), ['label'])
  assert.deepEqual(byIndex[2].map((i) => i.field), ['startTime'])
  assert.deepEqual(byIndex[3].map((i) => i.field), ['duration'])
  assert.deepEqual(byIndex[4].map((i) => i.field), ['duration', 'days'])
  assert.deepEqual(byIndex[5].map((i) => i.field), ['duration'])
  assert.deepEqual(general, [])

  const boundaries = [draft({ durationMinutes: 5, startTime: '00:00' }), draft({ kind: 'SLEEP', durationMinutes: 960, startTime: '00:05' })]
  assert.deepEqual(plain(rules.validateRoutineDrafts(boundaries)).byIndex, {}, '5m and 16h are allowed')

  const many = Array.from({ length: 21 }, (_, i) => draft({ startTime: `${String(i).padStart(2, '0')}:00`, durationMinutes: 30 }))
  assert.equal(plain(rules.validateRoutineDrafts(many)).general.length, 1)
})

test('overlap is checked on the cyclic week, touching is fine, Sunday night wraps into Monday', () => {
  // 평일 점심과 주말 점심은 요일이 달라 겹치지 않는다.
  const split = [draft({ days: WEEKDAYS }), draft({ startTime: '13:00', days: ['SATURDAY', 'SUNDAY'] })]
  assert.deepEqual(plain(rules.validateRoutineDrafts(split)).byIndex, {})

  // 맞닿음: 12:00–13:00 과 13:00–14:00
  const touching = [draft(), draft({ kind: 'CUSTOM', label: '산책', startTime: '13:00' })]
  assert.deepEqual(plain(rules.validateRoutineDrafts(touching)).byIndex, {})

  // 겹침은 양쪽 항목에 상대 이름과 요일을 붙인다.
  const clash = [draft(), draft({ kind: 'CUSTOM', label: '산책', startTime: '12:30', days: ['WEDNESDAY'] })]
  const issues = plain(rules.validateRoutineDrafts(clash)).byIndex
  assert.match(issues[0][0].message, /수요일 "산책"/)
  assert.match(issues[1][0].message, /수요일 "점심"/)

  // 일요일 23:00부터 9시간 수면은 월요일 07:30 아침과 겹친다(주가 순환한다).
  const wrap = [draft({ kind: 'SLEEP', startTime: '23:00', durationMinutes: 540, days: ['SUNDAY'] }), draft({ kind: 'BREAKFAST', startTime: '07:30', durationMinutes: 30, days: ['MONDAY'] })]
  const wrapIssues = plain(rules.validateRoutineDrafts(wrap)).byIndex
  assert.equal(wrapIssues[0].length, 1)
  assert.equal(wrapIssues[1].length, 1)

  // 매일 23:30 수면 7시간 30분은 다음 날 07:00에 끝나므로 07:00 아침과 맞닿을 뿐이다.
  const sleepThenBreakfast = [preset('SLEEP'), draft({ kind: 'BREAKFAST', startTime: '07:00', durationMinutes: 30 })]
  assert.deepEqual(plain(rules.validateRoutineDrafts(sleepThenBreakfast)).byIndex, {})
})

test('drafts convert to the PUT body and back', () => {
  const input = plain(rules.toRoutineInput(draft({ kind: 'SLEEP', label: '  ', startTime: '23:30', durationMinutes: 450, days: ['SUNDAY', 'MONDAY'] })))
  assert.deepEqual(input, { kind: 'SLEEP', label: null, startTime: '23:30', duration: 'PT7H30M', days: ['MONDAY', 'SUNDAY'] })
  const custom = plain(rules.toRoutineInput(draft({ kind: 'CUSTOM', label: ' 운동 ' })))
  assert.equal(custom.label, '운동')

  const back = plain(rules.toRoutineDraft({ id: 3, kind: 'LUNCH', label: null, startTime: '12:00', duration: 'PT1H', days: ['FRIDAY', 'MONDAY'] }, 'x'))
  assert.deepEqual(back, { key: 'x', kind: 'LUNCH', label: '', startTime: '12:00', durationMinutes: 60, days: ['MONDAY', 'FRIDAY'] })
})

test('400 errors map back to the entry that was sent at that index', () => {
  const body = {
    status: 400,
    message: 'Validation failed for 3 field(s)',
    errors: [
      { field: 'routines[2].startTime', rejectedValue: '12:00:30', reason: '시작 시각은 분 단위여야 합니다.' },
      { field: 'routines[0]', rejectedValue: null, reason: 'routines[3]과 겹칩니다.' },
      { field: 'routines[1].label', rejectedValue: '', reason: '' },
      { field: 'routines', rejectedValue: null, reason: '생활 시간은 20개까지입니다.' },
    ],
  }
  const { byIndex, general } = plain(rules.mapRoutineServerErrors(body))
  assert.deepEqual(byIndex[2], [{ field: 'startTime', message: '시작 시각은 분 단위여야 합니다.' }])
  assert.deepEqual(byIndex[0], [{ message: 'routines[3]과 겹칩니다.' }])
  assert.deepEqual(byIndex[1], [{ field: 'label', message: '값을 확인해 주세요.' }])
  assert.deepEqual(general, ['생활 시간은 20개까지입니다.'])

  assert.deepEqual(plain(rules.mapRoutineServerErrors({ message: '잘못된 요청' })), { byIndex: {}, general: ['잘못된 요청'] })
  assert.deepEqual(plain(rules.mapRoutineServerErrors('oops')), { byIndex: {}, general: [] })
})

test('meal hints fire only inside common meal windows and only for unregistered meals', () => {
  const none = new Set()
  assert.equal(rules.mealHintFor(11 * 60, 12 * 60, none), 'LUNCH')
  assert.equal(rules.mealHintFor(13 * 60 + 30, 15 * 60, none), null, 'touching 13:30 is not lunch')
  assert.equal(rules.mealHintFor(10 * 60, 11 * 60 + 30, none), null)
  assert.equal(rules.mealHintFor(17 * 60, 18 * 60 + 10, none), 'DINNER')
  assert.equal(rules.mealHintFor(11 * 60, 12 * 60, new Set(['LUNCH'])), null)
  assert.equal(rules.mealHintFor(11 * 60, 19 * 60, new Set(['LUNCH'])), 'DINNER')
  assert.equal(rules.mealHintFor(24 * 60 + 12 * 60, 24 * 60 + 13 * 60, none), 'LUNCH', 'next-day part of the window')
})

test('routine overlaps on plan blocks are warnings only', () => {
  const at = (hh, mm = 0) => Date.UTC(2026, 9, 28, hh, mm)
  const blocks = [
    { taskId: 1, title: 'A', startMs: at(11, 30), endMs: at(12, 30) },
    { taskId: 2, title: 'B', startMs: at(13), endMs: at(14) },
    { taskId: 3, title: 'C', startMs: null, endMs: null },
  ]
  const issues = plain(mapping.findRoutineConflicts(blocks, [{ name: '점심', startMs: at(12), endMs: at(13) }]))
  assert.deepEqual(Object.keys(issues), ['1'])
  assert.equal(issues[1][0].severity, 'warning')
  assert.match(issues[1][0].message, /점심/)
})

test('nudge flags survive a throwing storage', () => {
  const values = new Map()
  const memory = { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) }
  assert.equal(storage.readFlag('a', memory), false)
  storage.writeFlag('a', memory)
  assert.equal(storage.readFlag('a', memory), true)

  const broken = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } }
  assert.equal(storage.readFlag('a', broken), false)
  assert.doesNotThrow(() => storage.writeFlag('a', broken))
  assert.equal(storage.readFlag('a', null), false)
})

test('"요일별로 다르게" uses unused days first, otherwise splits the weekend off', () => {
  assert.deepEqual(plain(rules.splitDaysForNewEntry([ALL])), { lastDays: WEEKDAYS, newDays: ['SATURDAY', 'SUNDAY'] })
  assert.deepEqual(plain(rules.splitDaysForNewEntry([WEEKDAYS])), { lastDays: null, newDays: ['SATURDAY', 'SUNDAY'] })
  assert.deepEqual(plain(rules.splitDaysForNewEntry([WEEKDAYS, ['SATURDAY', 'SUNDAY']])), { lastDays: null, newDays: [] })
})
