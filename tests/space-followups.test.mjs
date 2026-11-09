import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const plain = (value) => JSON.parse(JSON.stringify(value))
function load(path, dependencies = {}, globals = {}) {
  const source = readFileSync(
    new URL('../src/' + path, import.meta.url),
    'utf8',
  )
  const output = ts.transpileModule(source, {
    fileName: path,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText
  const module = { exports: {} }
  vm.runInNewContext(output, {
    module,
    exports: module.exports,
    URL,
    URLSearchParams,
    AbortController,
    TextDecoder,
    setTimeout,
    clearTimeout,
    console: { error() {} },
    require: (name) => {
      assert.ok(name in dependencies, 'Unexpected dependency ' + name)
      return dependencies[name]
    },
    ...globals,
  })
  return module.exports
}

test('space marks are stable per id and neutral for personal spaces', () => {
  const { spaceMark, SPACE_MARKS } = load('features/spaces/marks.ts')
  assert.deepEqual([...SPACE_MARKS], ['#3e8391', '#9165b0', '#a77d35', '#43886b', '#ad6280'])
  assert.equal(spaceMark({ id: 31, personal: false }), '#9165b0')
  assert.equal(spaceMark({ id: 35, personal: false }), '#3e8391')
  assert.equal(spaceMark({ id: -4, personal: true }), null)
  assert.equal(spaceMark({ id: -7, personal: false }), '#a77d35')
})

test('the bar switcher names the space, and the project only on scoped lists', () => {
  const { switcherLabel } = load('features/spaces/scope.ts')
  const space = { name: '핀잇 개선' }, project = { name: '작업 카드 개선' }
  assert.equal(switcherLabel('selected', space, project, false), '핀잇 개선 › 작업 카드 개선')
  assert.equal(switcherLabel('all', space, project, false), '핀잇 개선')
  assert.equal(switcherLabel('selected', null, null, true), '스페이스 불러오는 중')
  assert.equal(switcherLabel('selected', null, null, false), '스페이스 선택')
})

test('the sheet lists live projects of the chosen space only', () => {
  const { sheetProjects } = load('features/spaces/scope.ts')
  const projects = [
    { id: 1, spaceId: 31, name: '작업 카드 개선', deleted: false },
    { id: 2, spaceId: 31, name: '지난 프로젝트', deleted: true },
    { id: 3, spaceId: 44, name: '11월 대회 준비', deleted: false },
    { id: 4, spaceId: 31, name: '온보딩 안내 정리', deleted: false },
  ]
  assert.deepEqual(plain(sheetProjects(projects, 31).map((p) => p.id)), [1, 4])
  assert.deepEqual(plain(sheetProjects(projects, null)), [])
})

test('unavailable copy comes from the server reason, not from roles', () => {
  const { unavailableText, adminNames } = load('features/spaces/unavailable.ts')
  assert.equal(unavailableText('ADMIN_ONLY', ['서연']), '관리자 서연님만 할 수 있어요.')
  assert.equal(unavailableText('ADMIN_ONLY', ['서연', '도현']), '관리자 서연·도현님만 할 수 있어요.')
  assert.equal(unavailableText('ADMIN_ONLY', []), '관리자만 할 수 있어요.')
  assert.equal(unavailableText('SPACE_DELETED', []), '휴지통에 있는 스페이스라 할 수 없어요.')
  assert.equal(unavailableText('SCHEDULE_RUNNING', ['서연']), '진행 중이거나 멈춘 일정은 삭제할 수 없어요.')
  assert.equal(unavailableText(undefined, ['서연']), '지금은 할 수 없어요.')
  assert.deepEqual(adminNames([
    { memberId: 1, nickname: '서연', role: 'ADMIN' },
    { memberId: 2, nickname: '나', role: 'MEMBER' },
  ]), ['서연'])
})
