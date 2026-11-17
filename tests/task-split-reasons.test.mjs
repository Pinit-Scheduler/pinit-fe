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

test('잠겨서 꺼진 동작의 이유 문구', () => {
  const { unavailableText } = loadModule('../src/features/spaces/unavailable.ts')
  assert.equal(unavailableText('SPLIT_IN_PROGRESS', []), '쪼개기 요청이 진행 중이라 할 수 없어요.')
})

test('하루 계획 승인이 잠긴 원본을 거부한 사유 문구', () => {
  const { blockRejectionLabel } = loadModule('../src/features/planner/utils/planMapping.ts')
  assert.equal(blockRejectionLabel('TASK_LOCKED_BY_SPLIT'), '쪼개기 요청이 진행 중인 작업이라 배치할 수 없어요.')
})
