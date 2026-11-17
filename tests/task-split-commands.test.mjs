import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { apiError, requireFrom } from './support/errors.mjs'
import { hookRunner, settle } from './support/hooks.mjs'

const load = (relativePath, dependencies = {}, globals = {}) => {
  const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  const module = { exports: {} }
  vm.runInNewContext(outputText, {
    module,
    exports: module.exports,
    console: { error() {} },
    AbortController,
    require: requireFrom(dependencies),
    ...globals,
  })
  return module.exports
}

const splitErrors = load('../src/features/task-split/api/splitErrors.ts')
const labels = load('../src/features/task-split/utils/splitLabels.ts')

const harness = ({ answer = true, api = {} } = {}) => {
  const toasts = [], events = [], asks = [], calls = []
  const requests = {
    cancelSplitRequest: async (id) => { calls.push(['cancel', id]); return { request: { requestId: id, taskId: 7 } } },
    discardSplitRequest: async (id) => { calls.push(['discard', id]); return { request: { requestId: id, taskId: 7 }, undoable: true } },
    fetchSplitInbox: async () => ({ quota: {}, items: [{ requestId: 31, violationRemaining: true, status: 'READY' }] }),
    ...api,
  }
  const { useSplitCommands } = load('../src/features/task-split/hooks/useSplitCommands.ts', {
    react: { useCallback: (fn) => fn },
    '@contexts/ToastContext': { useToast: () => ({ addToast: (...toast) => toasts.push(toast) }) },
    '@shared/utils/events': { dispatchTaskChanged: (detail) => events.push(detail) },
    '@shared/components/common/confirm': { askConfirm: async (ask) => { asks.push(ask); return answer } },
    '../api/splitRequests': requests,
    '../api/splitErrors': splitErrors,
    '../utils/splitLabels': labels,
  })
  return { commands: useSplitCommands(), toasts, events, asks, calls }
}
test('취소는 확인받은 뒤 보내고 화면을 다시 읽게 한다', async () => {
  const h = harness()
  assert.equal(await h.commands.cancel(31), true)
  assert.equal(h.asks[0].body, '취소해도 횟수는 돌아오지 않아요.')
  assert.equal(JSON.stringify(h.calls), '[["cancel",31]]')
  assert.equal(h.toasts[0][0], '쪼개기 요청을 취소했어요.')
  assert.equal(h.events[0].taskId, 7)
})
test('확인 창에서 그만두면 아무것도 보내지 않는다', async () => {
  const h = harness({ answer: false })
  assert.equal(await h.commands.cancel(31), false)
  assert.equal(await h.commands.discard({ requestId: 31, status: 'READY', violationRemaining: false }), false)
  assert.equal(h.calls.length, 0)
  assert.equal(h.toasts.length, 0)
})
test('위반이 남은 제안은 다른 문구로 묻고, 모르면 보관함에서 찾는다', async () => {
  const known = harness()
  await known.commands.discard({ requestId: 31, status: 'READY', violationRemaining: false })
  assert.equal(known.asks[0].body, '이미 쓴 횟수는 돌아오지 않아요. 원본 작업은 그대로 남아요.')
  const looked = harness()
  await looked.commands.discard({ requestId: 31 })
  assert.equal(looked.asks[0].body, '횟수는 이미 돌려 드렸어요. 이 제안을 버릴까요?')
  assert.equal(looked.toasts[0][0], '제안을 버렸어요.')
  const failedLookup = harness({ api: { fetchSplitInbox: async () => { throw new Error('offline') } } })
  await failedLookup.commands.discard({ requestId: 31 })
  assert.equal(failedLookup.asks[0].body, '이미 쓴 횟수는 돌아오지 않아요. 원본 작업은 그대로 남아요.')
})
test('실패 항목은 묻지 않고 버리고 토스트도 없다', async () => {
  const h = harness()
  assert.equal(await h.commands.discard({ requestId: 40, status: 'FAILED' }), true)
  assert.equal(h.asks.length, 0)
  assert.equal(h.toasts.length, 0)
  assert.equal(h.events.length, 1)
})
test('확인하는 사이 상태가 바뀌면 서버 문구를 보이고 다시 읽는다', async () => {
  const changed = apiError('요청의 상태가 바뀌어 처리할 수 없어요. 최신 상태를 확인해 주세요.', 409, { code: 'SPLIT_REQUEST_STATE_CHANGED', split: { currentStatus: 'READY' } })
  const h = harness({ api: { cancelSplitRequest: async () => { throw changed } } })
  assert.equal(await h.commands.cancel(31), false)
  assert.equal(h.toasts[0][0], '요청의 상태가 바뀌어 처리할 수 없어요. 최신 상태를 확인해 주세요.')
  assert.equal(h.toasts[0][1], 'error')
  assert.equal(h.events[0].reason, 'split')
})
test('응답이 없으면 화면 문장으로 알리고 다시 읽지 않는다', async () => {
  const h = harness({ api: { discardSplitRequest: async () => { throw new Error('offline') } } })
  assert.equal(await h.commands.discard({ requestId: 40, status: 'FAILED' }), false)
  assert.match(h.toasts[0][0], /^제안을 버리지 못했어요\./)
  assert.equal(h.events.length, 0)
})

// 실제 useRevalidatingQuery와 새 query store 위에서 요약 훅을 돌린다. 토스트 모듈은 주지 않으므로 훅이 부르면 실패한다.
const summaryHarness = (fetchSplitSummary) => {
  const runner = hookRunner()
  const window = new EventTarget()
  const globals = { window, CustomEvent, queueMicrotask, setTimeout, clearTimeout, Error }
  const events = load('../src/shared/utils/events.ts', {}, globals)
  const { createQueryStore } = load('../src/shared/utils/queryStore.ts', {}, globals)
  const query = load('../src/shared/hooks/useRevalidatingQuery.ts', {
    react: runner.react,
    '@shared/api/authTokens': { getAccessToken: () => 'token', getTokenSubject: () => 'member-1' },
    '@shared/utils/events': events,
    '@shared/utils/queryStore': { queryStore: createQueryStore() },
  }, globals)
  const hooks = load('../src/features/task-split/hooks/useSplitSummary.ts', {
    '@shared/hooks/useRevalidatingQuery': query,
    '../api/splitRequests': { fetchSplitSummary },
  }, globals)
  return { hooks, render: () => runner.render(() => hooks.useSplitSummary()), unmount: runner.unmount }
}
const summary = { available: true, consent: { currentVersion: '1', consented: true, provider: 'Anthropic' },
  quota: { limit: 3, used: 0, remaining: 3, resetsAt: '2026-11-17T15:00:00Z' }, archiveCount: 0 }

test('요약을 읽으면 그 값을 준다', async () => {
  const h = summaryHarness(async () => summary)
  assert.equal(h.hooks.SPLIT_SUMMARY_KEY, 'task-split/summary')
  assert.equal(h.render().summary, null)
  await settle()
  assert.equal(h.render().summary.quota.remaining, 3)
  h.unmount()
})
test('요약을 읽지 못하면 summary는 null이고 오류를 알리지 않는다', async () => {
  let reads = 0
  const h = summaryHarness(async () => { reads++; throw new Error('offline') })
  h.render()
  await settle()
  const result = h.render()
  assert.equal(reads, 1)
  assert.equal(result.summary, null)
  assert.deepEqual(Object.keys(result).sort(), ['refetch', 'summary'])
  h.unmount()
})
