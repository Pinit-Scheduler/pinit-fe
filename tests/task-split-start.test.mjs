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
test('횟수를 다 썼다고 보이면 요약을 다시 읽어 한 번 더 정한다(자정을 넘긴 낡은 요약)', async () => {
  const spent = summary({ quota: { limit: 3, used: 3, remaining: 0, resetsAt: '2026-11-17T15:00:00Z' } })
  let reads = 0
  const renewed = await flow.decideStart(task(), spent, true, async () => { reads++; return summary() })
  assert.equal(reads, 1)
  assert.equal(renewed.decision.kind, 'confirm')
  assert.equal(renewed.fresh.quota.remaining, 2)
  // 다시 읽어도 다 썼으면 그대로 막고, 읽지 못하면 받은 요약대로 막는다.
  assert.equal((await flow.decideStart(task(), spent, true, async () => spent)).decision.kind, 'blocked')
  const offline = await flow.decideStart(task(), spent, true, async () => { throw new Error('offline') })
  assert.equal(offline.decision.kind, 'blocked')
  assert.equal(offline.fresh, null)
  // 막히지 않으면 다시 읽지 않는다.
  const plain = await flow.decideStart(task(), summary(), true, async () => { reads++; return summary() })
  assert.equal(plain.decision.kind, 'confirm')
  assert.equal(reads, 1)
})

// 앱 셸의 시작 호스트를 훅처럼 돌린다(요약 훅과 API는 가짜).
const host = async ({ held, fresh }) => {
  const { hookRunner, settle } = await import('./support/hooks.mjs')
  const jsxRuntime = await import('react/jsx-runtime')
  const runner = hookRunner()
  const source = readFileSync(new URL('../src/features/task-split/components/SplitStartHost.tsx', import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    fileName: 'SplitStartHost.tsx',
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  })
  const toasts = [], refetches = [], seeded = [], reads = [], asks = []
  let current = held
  const startStore = load('../src/features/task-split/splitStartStore.ts')
  const module = { exports: {} }
  vm.runInNewContext(outputText, {
    module,
    exports: module.exports,
    console: { error() {} },
    require: requireFrom({
      react: runner.react,
      'react/jsx-runtime': jsxRuntime,
      'react-router-dom': { useNavigate: () => () => {} },
      '@contexts/ToastContext': { useToast: () => ({ addToast: (...toast) => toasts.push(toast) }) },
      '@shared/components/common/confirm': { askConfirm: async (ask) => { asks.push(ask); return false } },
      '@shared/utils/events': { dispatchTaskChanged: () => {} },
      '../api/splitRequests': {
        fetchSplitSummary: () => { reads.push(1); return fresh.promise },
        saveSplitConsent: async () => ({}),
        submitSplitRequest: async () => ({}),
      },
      '../hooks/useSplitSummary': {
        useSplitSummary: () => ({
          summary: current,
          refetch: () => refetches.push(1),
          setSummary: (next) => { seeded.push(next); current = next },
        }),
      },
      '../splitStartStore': startStore,
      '../utils/splitLabels': labels,
      '../utils/splitPaths': paths,
      '../utils/splitStartFlow': flow,
      './SplitConsentDialog': { default: () => null },
      '../task-split.css': {},
    }),
  })
  const Host = module.exports.default
  runner.render(() => Host())
  return { startStore, toasts, refetches, seeded, reads, asks, settle, render: () => runner.render(() => Host()) }
}
const deferredValue = () => {
  let resolve
  const promise = new Promise((r) => { resolve = r })
  return { promise, resolve }
}
test('시작 호스트: 횟수가 없어 보여 다시 읽은 요약은 캐시에 넣고 한 번 더 읽지 않는다', async () => {
  const spent = summary({ quota: { limit: 3, used: 3, remaining: 0, resetsAt: '2026-11-17T15:00:00Z' } })
  const fresh = deferredValue()
  const h = await host({ held: spent, fresh })
  h.startStore.requestSplitStart(task())
  fresh.resolve(summary())
  await h.settle()
  assert.equal(h.reads.length, 1)
  assert.equal(h.seeded.length, 1)
  assert.equal(h.seeded[0].quota.remaining, 2)
  assert.equal(h.refetches.length, 0)
  assert.equal(h.asks.length, 1, '다시 읽은 요약으로 확인 창을 연다')
})
test('시작 호스트: 막힌 길에서 두 번 누르면 알림은 하나다', async () => {
  const spent = summary({ quota: { limit: 3, used: 3, remaining: 0, resetsAt: '2026-11-17T15:00:00Z' } })
  const fresh = deferredValue()
  const h = await host({ held: spent, fresh })
  h.startStore.requestSplitStart(task())
  h.render()
  h.startStore.requestSplitStart(task())
  fresh.resolve(spent)
  await h.settle()
  assert.equal(h.reads.length, 1)
  assert.equal(h.toasts.length, 1)
  assert.equal(h.toasts[0][0], '오늘 쪼개기 횟수를 다 썼어요. 자정에 다시 채워져요.')
  // 끝난 뒤에는 다시 받는다.
  h.render()
  h.startStore.requestSplitStart(task())
  await h.settle()
  assert.equal(h.toasts.length, 2)
})
