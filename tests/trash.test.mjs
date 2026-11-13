import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { requireFrom } from './support/errors.mjs'

const loadModule = (relativePath, dependencies = {}) => {
  const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  })
  const module = { exports: {} }
  vm.runInNewContext(outputText, {
    module,
    exports: module.exports,
    console: { error() {} },
    require: requireFrom(dependencies),
  })
  return module.exports
}

const labels = loadModule('../src/features/trash/utils/trashLabels.ts')

test('restoring a task says how many dependency links could not come back (ADR-0024 §13)', () => {
  assert.equal(labels.restoreTaskMessage(0), '작업을 되돌렸어요.')
  assert.equal(
    labels.restoreTaskMessage(2),
    '작업을 되돌렸어요. 선후관계 2개는 복구하지 못했어요.',
  )
})

test('the purge countdown shows whole days left and "soon" on the last day', () => {
  assert.equal(labels.purgeDaysLabel(29.6), '29일 뒤 삭제')
  assert.equal(labels.purgeDaysLabel(1), '1일 뒤 삭제')
  assert.equal(labels.purgeDaysLabel(0), '곧 삭제')
  assert.equal(labels.purgeDaysLabel(-1), '곧 삭제')
})

test('info toasts with an action stay longer, errors stay until dismissed', () => {
  const { toastDuration } = loadModule('../src/shared/utils/toastPolicy.ts')
  assert.equal(toastDuration('success'), 1500)
  assert.equal(toastDuration('error'), 0)
  assert.equal(toastDuration('info', { action: {} }), 6000)
  assert.equal(toastDuration('info', { durationMs: 10000 }), 10000)
})

const undoHarness = (api) => {
  const toasts = []
  const changes = []
  const { useTrashUndo } = loadModule('../src/features/trash/hooks/useTrashUndo.ts', {
    react: { useCallback: (fn) => fn },
    '@contexts/ToastContext': { useToast: () => ({ addToast: (...toast) => toasts.push(toast) }) },
    '@shared/utils/events': {
      dispatchTaskChanged: (...detail) => changes.push(['task', ...detail]),
      dispatchScheduleChanged: (detail) => changes.push(['schedule', detail]),
    },
    '../api/trash': api,
    '../utils/trashLabels': labels,
  })
  return { undo: useTrashUndo(), toasts, changes }
}

test('a deleted task offers undo for six seconds, and undoing it refreshes lists and reports lost links', async () => {
  let restored = 0
  const h = undoHarness({ restoreTask: async () => ({ skippedDependencies: 1 }) })
  h.undo.offerTaskUndo(7, () => restored++)
  const [message, type, options] = h.toasts[0]
  assert.deepEqual([message, type, options.durationMs, options.action.label], ['작업을 휴지통으로 옮겼어요.', 'success', 6000, '되돌리기'])
  options.action.onAction()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(restored, 1)
  assert.deepEqual(JSON.parse(JSON.stringify(h.changes)), [['task', 7, 'restore'], ['schedule', { reason: 'restore' }]])
  assert.deepEqual(h.toasts[1], ['작업을 되돌렸어요. 선후관계 1개는 복구하지 못했어요.', 'success'])
})

test('a failed schedule undo says where to try again', async () => {
  const h = undoHarness({ restoreSchedule: async () => { throw new TypeError('Failed to fetch') } })
  h.undo.offerScheduleUndo(3)
  h.toasts[0][2].action.onAction()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(h.toasts[1], ['일정을 되돌리지 못했어요. 인터넷 연결을 확인한 뒤 설정 → 휴지통에서 다시 시도해 주세요.', 'error'])
  assert.equal(h.changes.length, 0)
})
