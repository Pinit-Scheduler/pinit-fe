import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const load = (relativePath, dependencies = {}) => {
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

// ApiError는 httpClient가 만든다. 여기서는 같은 모양(name·status·data)만 흉내 낸다.
const apiError = (message, status, data) =>
  Object.assign(new Error(message), { name: 'ApiError', status, data })

const setup = () => {
  const requests = []
  const api = load('../src/features/task-split/api/splitRequests.ts', {
    '@shared/api/config': { buildApiUrl: (path, version) => `https://api.test/${version}${path}` },
    '@shared/api/httpClient': { httpClient: async (url, options = {}) => { requests.push({ url, options }); return {} } },
  })
  return { api, requests }
}

test('요청·보관함 호출의 경로, 메서드, 본문', async () => {
  const { api, requests } = setup()
  const signal = new AbortController().signal
  await api.fetchSplitSummary(signal)
  await api.saveSplitConsent('1')
  await api.submitSplitRequest(7)
  await api.fetchSplitInbox()
  await api.cancelSplitRequest(31)
  await api.discardSplitRequest(31)
  const [summary, consent, submit, inbox, cancel, discard] = requests
  assert.equal(summary.url, 'https://api.test/v2/task-splits/summary')
  assert.equal(summary.options.method, undefined)
  assert.equal(summary.options.signal, signal)
  assert.equal(consent.url, 'https://api.test/v2/task-splits/consent')
  assert.equal(consent.options.method, 'PUT')
  assert.equal(JSON.stringify(consent.options.json), '{"disclosureVersion":"1"}')
  assert.equal(submit.url, 'https://api.test/v2/task-splits')
  assert.equal(submit.options.method, 'POST')
  assert.equal(JSON.stringify(submit.options.json), '{"taskId":7}')
  assert.equal(inbox.url, 'https://api.test/v2/task-splits')
  assert.equal(inbox.options.method, undefined)
  assert.equal(cancel.url, 'https://api.test/v2/task-splits/31/cancel')
  assert.equal(cancel.options.method, 'POST')
  assert.equal(discard.url, 'https://api.test/v2/task-splits/31/discard')
  assert.equal(discard.options.method, 'POST')
})

test('쪼개기 오류만 읽고 나머지는 null', () => {
  const { splitErrorOf, isLockedBySplit } = load('../src/features/task-split/api/splitErrors.ts')
  const mine = apiError('이미 이 작업의 쪼개기 요청이 진행 중이에요.', 409, { code: 'SPLIT_ALREADY_IN_PROGRESS', split: { requestId: 31, requesterNickname: null } })
  assert.equal(splitErrorOf(mine).code, 'SPLIT_ALREADY_IN_PROGRESS')
  assert.equal(splitErrorOf(mine).status, 409)
  assert.equal(splitErrorOf(mine).split.requestId, 31)
  const locked = apiError('쪼개기 제안을 정리한 뒤 바꿔 주세요.', 409, { code: 'TASK_LOCKED_BY_SPLIT' })
  assert.equal(JSON.stringify(splitErrorOf(locked).split), '{}')
  assert.equal(isLockedBySplit(locked), true)
  assert.equal(isLockedBySplit(mine), false)
  assert.equal(splitErrorOf(apiError('다른 참여자가 먼저 수정했어요.', 409, { code: 'VERSION_CONFLICT' })), null)
  assert.equal(splitErrorOf(apiError('서버 오류', 500, null)), null)
  assert.equal(splitErrorOf(new Error('네트워크')), null)
})

const setupProposals = () => {
  const requests = []
  const dependencies = {
    '@shared/api/config': { buildApiUrl: (path, version) => `https://api.test/${version}${path}` },
    '@shared/api/httpClient': { httpClient: async (url, options = {}) => { requests.push({ url, options }); return {} } },
  }
  const proposals = load('../src/features/task-split/api/splitProposals.ts', dependencies)
  const undo = load('../src/features/task-split/api/splitUndo.ts', dependencies)
  return { proposals, undo, requests }
}

test('제안·검사·만들기·되돌리기 호출의 경로와 본문', async () => {
  const { proposals, undo, requests } = setupProposals()
  const pieces = [{ key: 'a', title: '정리', description: '설명', minutes: 60, difficulty: 3, dueDate: '2026-11-18', after: [], selected: true }]
  const held = pieces.map((piece) => ({ ...piece, dueDateAdjusted: false, exclusion: { reason: 'DUPLICATES_OPEN', evidenceTaskId: 1, evidenceTitle: '근거' } }))
  await proposals.fetchSplitDetail(31)
  await proposals.checkSplitDraft(31, { pieces: held, action: { type: 'EXCLUDE', key: 'a' } })
  await proposals.applySplit(31, held)
  await undo.undoSplitApply(31)
  await undo.undoSplitDiscard(31)
  assert.equal(requests[0].url, 'https://api.test/v2/task-splits/31')
  assert.equal(requests[0].options.method, undefined)
  assert.equal(requests[1].url, 'https://api.test/v2/task-splits/31/check')
  assert.equal(requests[1].options.method, 'POST')
  assert.equal(JSON.stringify(requests[1].options.json), JSON.stringify({ pieces, action: { type: 'EXCLUDE', key: 'a' } }))   // 여덟 칸만 나간다
  assert.equal(requests[2].url, 'https://api.test/v2/task-splits/31/apply')
  assert.equal(JSON.stringify(requests[2].options.json), JSON.stringify({ pieces }))
  assert.equal(requests[3].url, 'https://api.test/v2/task-splits/31/undo-apply')
  assert.equal(requests[3].options.method, 'POST')
  assert.equal(requests[3].options.json, undefined)
  assert.equal(requests[4].url, 'https://api.test/v2/task-splits/31/undo-discard')
  assert.equal(requests[4].options.method, 'POST')
  assert.equal(requests[4].options.json, undefined)
})

test('검사 호출은 action이 없으면 본문에 싣지 않고 signal을 넘기지 않는다', async () => {
  const { proposals, requests } = setupProposals()
  const signal = new AbortController().signal
  await proposals.fetchSplitDetail(5, signal)
  await proposals.checkSplitDraft(5, { pieces: [] })
  assert.equal(requests[0].options.signal, signal)
  assert.equal(JSON.stringify(requests[1].options.json), '{"pieces":[]}')
})

test('거부에 실린 검사 결과만 꺼낸다', () => {
  const { splitCheckOf } = load('../src/features/task-split/api/splitErrors.ts')
  const withCheck = apiError('조각을 확인해 주세요.', 422, { code: 'SPLIT_INVALID_PIECES', split: { check: { pieces: [], problemCount: 1 } } })
  assert.equal(splitCheckOf(withCheck).problemCount, 1)
  assert.equal(splitCheckOf(apiError('조각 구성이 제안과 달라요.', 422, { code: 'SPLIT_INVALID_PIECES', split: {} })), null)
  assert.equal(splitCheckOf(apiError('x', 422, { code: 'SPLIT_INVALID_PIECES', split: { check: { pieces: 'no' } } })), null)
  assert.equal(splitCheckOf(apiError('x', 422, { code: 'SPLIT_INVALID_PIECES', split: { check: null } })), null)
  assert.equal(splitCheckOf(new Error('offline')), null)
})
