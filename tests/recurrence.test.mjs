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

const plain = (value) => JSON.parse(JSON.stringify(value))
const rules = loadModule('../src/features/recurrence/utils/recurrenceRules.ts')

test('the default rule repeats weekly on the start day', () => {
  // 2026-11-02 is a Monday.
  assert.deepEqual(plain(rules.defaultRuleDraft('2026-11-02')), {
    freq: 'WEEKLY', interval: 1, days: ['MONDAY'], dayOfMonth: 2, startDate: '2026-11-02', end: 'NONE', until: '', count: null,
  })
  assert.equal(rules.dayOfWeekOf('2026-11-08'), 'SUNDAY')
})

test('the server body carries only the fields of the frequency and the chosen end', () => {
  const weekly = { ...rules.defaultRuleDraft('2026-11-02'), days: ['FRIDAY', 'MONDAY', 'MONDAY'], end: 'COUNT', count: 10 }
  assert.deepEqual(plain(rules.toRule(weekly)), {
    freq: 'WEEKLY', interval: 1, days: ['MONDAY', 'FRIDAY'], startDate: '2026-11-02', until: null, count: 10,
  })
  const monthly = { ...rules.defaultRuleDraft('2026-11-02'), freq: 'MONTHLY', dayOfMonth: 31, end: 'UNTIL', until: '2027-03-31' }
  assert.deepEqual(plain(rules.toRule(monthly)), {
    freq: 'MONTHLY', interval: 1, dayOfMonth: 31, startDate: '2026-11-02', until: '2027-03-31', count: null,
  })
  assert.deepEqual(plain(rules.toRuleDraft(rules.toRule(weekly))), { ...plain(weekly), days: ['MONDAY', 'FRIDAY'] })
})

test('validation mirrors the server ranges', () => {
  const base = rules.defaultRuleDraft('2026-11-02')
  assert.deepEqual(plain(rules.validateRuleDraft(base, '2026-11-02')), {})
  assert.deepEqual(Object.keys(rules.validateRuleDraft({ ...base, interval: 0, days: [] })), ['interval', 'days'])
  assert.deepEqual(Object.keys(rules.validateRuleDraft({ ...base, interval: 100 })), ['interval'])
  assert.deepEqual(Object.keys(rules.validateRuleDraft({ ...base, freq: 'MONTHLY', dayOfMonth: 32 })), ['dayOfMonth'])
  assert.deepEqual(Object.keys(rules.validateRuleDraft(base, '2026-11-03')), ['startDate'])
  assert.deepEqual(Object.keys(rules.validateRuleDraft({ ...base, end: 'UNTIL', until: '2026-11-01' })), ['until'])
  assert.deepEqual(Object.keys(rules.validateRuleDraft({ ...base, end: 'UNTIL', until: '2028-11-03' })), ['until'])
  assert.deepEqual(plain(rules.validateRuleDraft({ ...base, end: 'UNTIL', until: '2028-11-02' })), {})
  assert.deepEqual(Object.keys(rules.validateRuleDraft({ ...base, end: 'COUNT', count: 366 })), ['count'])
  assert.deepEqual(Object.keys(rules.validateRuleDraft({ ...base, startDate: '2026-02-30' })), ['startDate'])
})

test('rules read as one short line', () => {
  assert.equal(rules.describeRule({ freq: 'WEEKLY', interval: 1, days: ['FRIDAY', 'MONDAY', 'WEDNESDAY'], startDate: '2026-11-02', count: 10 }), '매주 월·수·금, 10회')
  assert.equal(rules.describeRule({ freq: 'WEEKLY', interval: 2, days: ['TUESDAY'], startDate: '2026-11-02' }), '2주마다 화')
  assert.equal(rules.describeRule({ freq: 'DAILY', interval: 1, startDate: '2026-11-02', until: '2026-12-31' }), '매일, 2026-12-31까지')
  assert.equal(rules.describeRule({ freq: 'MONTHLY', interval: 1, dayOfMonth: 31, startDate: '2026-11-02' }), '매월 31일(없는 달은 건너뜀)')
  assert.equal(rules.describeRule({ freq: 'MONTHLY', interval: 3, dayOfMonth: 15, startDate: '2026-11-02' }), '3개월마다 15일')
})

test('impact messages warn about overwritten one-off edits', () => {
  assert.equal(rules.editImpactMessage({ patched: 0, deleted: 2, created: 3, overwrittenIndividualEdits: 1 }),
    '회차 2개를 지워요, 회차 3개를 새로 만들어요. 하나씩 옮기거나 고친 회차 1개가 반복 규칙대로 바뀌어요.')
  assert.equal(rules.editImpactMessage({ patched: 4, deleted: 0, created: 0, overwrittenIndividualEdits: 0 }), '회차 4개를 고쳐요.')
  assert.equal(rules.editImpactMessage({ patched: 0, deleted: 0, created: 0, overwrittenIndividualEdits: 0 }), null)
  assert.equal(rules.deleteImpactMessage({ deleted: 3, protected: 1 }), '회차 3개를 지워요. 시작했거나 끝났거나 지난 회차 1개는 남아요. 범위로 지운 회차는 휴지통에 남지 않아요.')
})

test('a series edit carries only what changed and never the date', () => {
  const before = { title: '주간 회의', description: '팀', startTime: '10:00', plannedDurationMinutes: 60, scheduleType: 'ADMIN_TASK' }
  assert.deepEqual(plain(rules.fixedChanges(before, { ...before })), {})
  assert.deepEqual(plain(rules.fixedChanges(before, { ...before, startTime: '14:00', plannedDurationMinutes: 90 })),
    { fixed: { startTime: '14:00', plannedDuration: 'PT1H30M' } })
  assert.deepEqual(plain(rules.fixedChanges(before, { ...before, title: '주간 싱크', plannedDurationMinutes: null })), { title: '주간 싱크' })
  const task = { title: '운동', description: '헬스장', importance: 5, difficulty: 3, expectedDurationMinutes: 60 }
  assert.deepEqual(plain(rules.flexibleChanges(task, { ...task, importance: 8, expectedDurationMinutes: 0 })),
    { flexible: { importance: 8, expectedDuration: 'PT0S' } })
})

test('the weekly view knows when it looks past the generated range', () => {
  assert.equal(rules.isBeyondGeneration('2027-01-31', '2026-11-02'), false)
  assert.equal(rules.isBeyondGeneration('2027-02-01', '2026-11-02'), true)
  assert.deepEqual(plain(rules.mapRecurrenceServerErrors({ errors: [{ field: 'rule.days', reason: 'x' }, { field: 'rule.days', reason: 'y' }] })),
    { 'rule.days': 'x' })
  assert.deepEqual(plain(rules.mapRecurrenceServerErrors(null)), {})
})

test('the scope sheet says what each choice changes or deletes', () => {
  const edit = plain(rules.scopeOptions('edit'))
  const remove = plain(rules.scopeOptions('delete'))
  assert.deepEqual(edit.map((option) => option.scope), ['THIS', 'FOLLOWING', 'ALL'])
  assert.deepEqual(remove.map((option) => option.scope), ['THIS', 'FOLLOWING', 'ALL'])
  assert.ok(edit.every((option) => option.description.includes('바꿔요')))
  assert.ok(remove.every((option) => option.description.includes('지워요') && !option.description.includes('바꿔요')))
  assert.match(remove[0].description, /다시 생기지 않아요/)
  assert.match(remove[0].description, /휴지통/)
  assert.ok(remove.slice(1).every((option) => option.description.includes('휴지통에 남지 않음')))
  assert.match(remove[1].description, /전날 끝나요/)
  assert.match(remove[2].description, /반복을 끝내요/)
  assert.equal(rules.scopeQuestion('delete', '주간 회의'), '반복 회차 "주간 회의"를 어디까지 지울까요?')
  assert.equal(rules.scopeQuestion('edit', '운동'), '반복 회차 "운동"을 어디까지 바꿀까요?')
})
