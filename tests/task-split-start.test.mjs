import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { apiError, requireFrom } from './support/errors.mjs'

const load = (relativePath, dependencies = {}) => {
  const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  const module = { exports: {} }
  vm.runInNewContext(outputText, {
    module,
    exports: module.exports,
    require: requireFrom(dependencies),
  })
  return module.exports
}

const unavailable = load('../src/features/spaces/unavailable.ts')
const splitErrors = load('../src/features/task-split/api/splitErrors.ts')
const labels = load('../src/features/task-split/utils/splitLabels.ts', {
  '@features/spaces/unavailable': unavailable,
})
const paths = load('../src/features/task-split/utils/splitPaths.ts')
const flow = load('../src/features/task-split/utils/splitStartFlow.ts', {
  '../api/splitErrors': splitErrors,
  './splitLabels': labels,
  './splitPaths': paths,
})
const store = load('../src/features/task-split/splitStartStore.ts')

const summary = (over = {}) => ({ available: true, consent: { currentVersion: '1', consented: true, provider: 'Anthropic' },
  quota: { limit: 3, used: 1, remaining: 2, resetsAt: '2026-11-17T15:00:00Z' }, archiveCount: 0, ...over })
const lock = (over) => ({ stage: 'PROCESSING', mine: true, requestId: 9, requestStatus: 'QUEUED', requesterNickname: null, ...over })
const task = (lockValue = null) => ({ id: 7, split: { recommended: true, canRequest: !lockValue, cannotRequestReasons: [], lock: lockValue } })
test('이미 맡긴 작업은 그 요청이 있는 화면으로 간다', () => {
  assert.equal(flow.startDecision(task(lock()), summary(), true).to, '/app/tasks/splits')
  const ready = lock({ stage: 'PROPOSAL_READY', requestStatus: 'READY' })
  assert.equal(flow.startDecision(task(ready), summary(), true).to, '/app/tasks/splits/9')
  assert.equal(flow.startDecision(task(ready), summary(), false).to, '/app/tasks/splits')
  assert.equal(flow.startDecision(task(lock({ mine: false, requestId: null })), summary(), true).kind, 'ignore')
})
test('요약이 없거나 접수가 꺼졌으면 아무 일도 하지 않는다', () => {
  assert.equal(flow.startDecision(task(), null, true).kind, 'ignore')
  assert.equal(flow.startDecision(task(), summary({ available: false }), true).kind, 'ignore')
})
test('횟수가 없으면 확인 창 대신 알리고, 처음이면 동의 창, 아니면 확인 창', () => {
  const none = flow.startDecision(task(), summary({ quota: { limit: 3, used: 3, remaining: 0, resetsAt: '' } }), true)
  assert.equal(none.kind, 'blocked')
  assert.equal(none.message, '오늘 쪼개기 횟수를 다 썼어요. 자정에 다시 채워져요.')
  assert.equal(flow.startDecision(task(), summary({ consent: { currentVersion: '1', consented: false, provider: 'Anthropic' } }), true).kind, 'consent')
  const confirm = flow.startDecision(task(), summary(), true)
  assert.equal(confirm.kind, 'confirm')
  assert.equal(confirm.ask.body, '오늘 3번 중 1번을 써요. 맡기고 나면 1번 남아요.')
})
test('두 번째 접수가 내 요청으로 거부되면 성공으로 다룬다', () => {
  const mine = apiError('이미 이 작업의 쪼개기 요청이 진행 중이에요.', 409, { code: 'SPLIT_ALREADY_IN_PROGRESS', split: { requestId: 31 } })
  assert.equal(flow.submitFailureOf(mine).kind, 'already-mine')
  const other = apiError('김서연님이 쪼개는 중이라 바꿀 수 없어요.', 409, { code: 'SPLIT_ALREADY_IN_PROGRESS', split: { requesterNickname: '김서연', lockStage: 'PROCESSING' } })
  assert.equal(flow.submitFailureOf(other).message, '김서연님이 쪼개는 중이라 바꿀 수 없어요.')
  assert.equal(flow.submitFailureOf(apiError('먼저 동의해 주세요.', 409, { code: 'SPLIT_CONSENT_REQUIRED', split: { currentDisclosureVersion: '1' } })).kind, 'consent')
  assert.match(flow.submitFailureOf(new Error('offline')).message, /^쪼개기를 맡기지 못했어요\./)
})
test('시작 요청 저장소는 마지막 요청 하나만 들고 있다', () => {
  let calls = 0
  const stop = store.subscribeSplitStart(() => calls++)
  store.requestSplitStart({ id: 7 })
  store.requestSplitStart({ id: 8 })
  assert.equal(store.currentSplitStart().id, 8)
  store.clearSplitStart()
  assert.equal(store.currentSplitStart(), null)
  stop()
  assert.equal(calls, 3)
})
