import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const loadModule = (relativePath) => {
  const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  const module = { exports: {} }
  vm.runInNewContext(outputText, { module, exports: module.exports })
  return module.exports
}

const plain = (value) => JSON.parse(JSON.stringify(value))
const search = loadModule('../src/features/tasks/utils/taskSearch.ts')
const filters = (overrides) => ({ ...plain(search.DEFAULT_FILTERS), ...overrides })

test('the default filters send no parameters, like the plain list', () => {
  assert.deepEqual(plain(search.toSearchParams(filters({}), '2026-10-28')), [])
  assert.equal(search.isDefaultFilters(filters({})), true)
  assert.equal(search.activeFilterCount(filters({})), 0)
})

test('text is trimmed and capped at 50 characters', () => {
  assert.deepEqual(plain(search.toSearchParams(filters({ query: '  보고서  ' }), '2026-10-28')), [['q', '보고서']])
  const long = search.toSearchParams(filters({ query: 'x'.repeat(60) }), '2026-10-28')
  assert.equal(long[0][1].length, 50)
})

test('overdue means incomplete tasks due before today', () => {
  assert.deepEqual(plain(search.toSearchParams(filters({ deadline: 'OVERDUE' }), '2026-11-01')), [
    ['status', 'OPEN'],
    ['deadlineTo', '2026-10-31'],
  ])
  // A status the user picked is kept.
  assert.deepEqual(plain(search.toSearchParams(filters({ deadline: 'OVERDUE', status: 'BLOCKED' }), '2026-11-01')), [
    ['status', 'BLOCKED'],
    ['deadlineTo', '2026-10-31'],
  ])
})

test('this week runs Monday to Sunday around today', () => {
  // 2026-10-28 is a Wednesday; 2026-11-01 is a Sunday.
  assert.deepEqual(plain(search.weekRangeOf('2026-10-28')), { from: '2026-10-26', to: '2026-11-01' })
  assert.deepEqual(plain(search.weekRangeOf('2026-11-01')), { from: '2026-10-26', to: '2026-11-01' })
  assert.deepEqual(plain(search.toSearchParams(filters({ deadline: 'TODAY' }), '2026-10-28')), [
    ['deadlineFrom', '2026-10-28'],
    ['deadlineTo', '2026-10-28'],
  ])
})

test('custom ranges are swapped when reversed and may be open-ended', () => {
  assert.deepEqual(
    plain(search.toSearchParams(filters({ deadline: 'CUSTOM', deadlineFrom: '2026-11-05', deadlineTo: '2026-11-01' }), '2026-10-28')),
    [['deadlineFrom', '2026-11-01'], ['deadlineTo', '2026-11-05']],
  )
  assert.deepEqual(plain(search.toSearchParams(filters({ deadline: 'CUSTOM', deadlineFrom: '2026-11-05' }), '2026-10-28')), [
    ['deadlineFrom', '2026-11-05'],
  ])
  assert.equal(search.activeFilterCount(filters({ deadline: 'CUSTOM' })), 0)
})

test('importance, difficulty, tags and sort map to their parameters', () => {
  const params = search.toSearchParams(
    filters({ status: 'READY', importanceMin: 7, difficultyMax: 5, tagIds: [3, 9], sort: 'IMPORTANCE_DESC' }),
    '2026-10-28',
  )
  assert.deepEqual(plain(params), [
    ['status', 'READY'],
    ['importanceMin', '7'],
    ['difficultyMax', '5'],
    ['tagIds', '3'],
    ['tagIds', '9'],
    ['sort', 'IMPORTANCE_DESC'],
  ])
  assert.equal(search.activeFilterCount(filters({ status: 'READY', importanceMin: 7, difficultyMax: 5, tagIds: [3] })), 4)
  // The widest values are no filter.
  assert.deepEqual(plain(search.toSearchParams(filters({ importanceMin: 1, difficultyMax: 21 }), '2026-10-28')), [])
})

test('stored filters are validated when restored', () => {
  assert.deepEqual(plain(search.restoreFilters(null)), plain(search.DEFAULT_FILTERS))
  assert.deepEqual(plain(search.restoreFilters('not json')), plain(search.DEFAULT_FILTERS))
  const restored = search.restoreFilters(JSON.stringify({ status: 'NOPE', sort: 'TITLE_ASC', tagIds: [1, 'x', 2.5, 4], deadlineFrom: '11/01' }))
  assert.equal(restored.status, 'CURRENT')
  assert.equal(restored.sort, 'TITLE_ASC')
  assert.deepEqual(plain(restored.tagIds), [1, 4])
  assert.equal(restored.deadlineFrom, '')
})

test('pages are merged without duplicates', () => {
  assert.deepEqual(plain(search.mergePage([{ id: 1 }, { id: 2 }], [{ id: 2 }, { id: 3 }])), [{ id: 1 }, { id: 2 }, { id: 3 }])
})
