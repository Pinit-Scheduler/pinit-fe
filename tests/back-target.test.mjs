import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const load = (relativePath) => {
  const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  const module = { exports: {} }
  vm.runInNewContext(outputText, { module, exports: module.exports })
  return module.exports
}

const { backTarget } = load('../src/shared/routing/backTarget.ts')

test('앱 안에 돌아갈 history가 있으면 뒤로 간다', () => {
  for (const path of ['/app/settings/onboarding', '/app/tasks/splits', '/app/tasks/splits/123', '/app/tasks/7', '/app/plan'])
    assert.equal(backTarget(path, 2), null)
})

test('딥링크로 연 화면은 상위 화면으로 바꿔 간다', () => {
  for (const idx of [undefined, 0]) {
    assert.equal(backTarget('/app/settings/onboarding', idx), '/app/settings')
    assert.equal(backTarget('/app/tasks/splits', idx), '/app/tasks')
    assert.equal(backTarget('/app/tasks/splits/123', idx), '/app/tasks/splits')
  }
})

test('돌아갈 곳을 정하지 않은 화면은 history가 없어도 뒤로 간다', () => {
  for (const path of ['/app/tasks/7', '/app/plan', '/app/settings', '/app/tasks/splits/abc'])
    assert.equal(backTarget(path, 0), null)
})
