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

const labels = loadModule('../src/features/trash/utils/trashLabels.ts')

test('restoring a task says how many dependency links could not come back (ADR-0024 §13)', () => {
  assert.equal(labels.restoreTaskMessage(0), '작업을 되돌렸어요.')
  assert.equal(labels.restoreTaskMessage(2), '작업을 되돌렸어요. 선후관계 2개는 복구하지 못했어요.')
})

test('the purge countdown shows whole days left and "soon" on the last day', () => {
  assert.equal(labels.purgeDaysLabel(29.6), '29일 뒤 삭제')
  assert.equal(labels.purgeDaysLabel(1), '1일 뒤 삭제')
  assert.equal(labels.purgeDaysLabel(0), '곧 삭제')
  assert.equal(labels.purgeDaysLabel(-1), '곧 삭제')
})

test('the toast keeps an undo action and a longer duration option', () => {
  const source = readFileSync(new URL('../src/shared/contexts/ToastContext.tsx', import.meta.url), 'utf8')
  assert.match(source, /action\?: ToastAction/)
  assert.match(source, /options\?\.durationMs \?\? 3000/)
  const undo = readFileSync(new URL('../src/features/trash/hooks/useTrashUndo.ts', import.meta.url), 'utf8')
  assert.match(undo, /label: '되돌리기'/)
})
