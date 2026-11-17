import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadModules, setup } from './support/mocks.mjs'

// 개발용 목업이 쪼개기 요청(/v2/task-splits)과 작업 잠금을 서버(pinit-monolith TaskSplitController)처럼 답하는지 본다.
test('요약과 보관함은 보이는 요청만 센다', async () => {
  const { api, split } = setup()
  const summary = await api('/v2/task-splits/summary')
  assert.equal(summary.status, 200)
  assert.equal(summary.body.available, true)
  assert.equal(JSON.stringify(summary.body.consent), '{"currentVersion":"1","consented":false,"provider":"Anthropic"}')
  assert.equal(summary.body.quota.limit, 3)
  assert.equal(summary.body.quota.remaining, 2)
  assert.equal(summary.body.archiveCount, 7)
  const inbox = await api('/v2/task-splits')
  const ids = inbox.body.items.map((item) => item.requestId)
  const f = split.mockSplitFixtures
  assert.equal(ids.length, 7)
  for (const hidden of ['expired', 'applied', 'discarded', 'cancelled', 'otherProcessing', 'otherReady'])
    assert.equal(ids.includes(f[hidden].requestId), false, hidden)
  const admin = inbox.body.items.find((item) => item.requestId === f.adminOnly.requestId)
  assert.equal(admin.canApply, false)
  assert.equal(admin.cannotApplyReason, 'ADMIN_ONLY')
  assert.equal(inbox.body.items.find((item) => item.requestId === f.violation.requestId).violationRemaining, true)
})
test('작업 응답이 잠금과 맡길 수 있는지를 싣는다', async () => {
  const { api, split } = setup()
  const f = split.mockSplitFixtures
  const task = async (key) => (await api(`/v2/workspace/tasks/${f[key].taskId}`)).body
  const ready = await task('ready')
  assert.equal(JSON.stringify(ready.split.lock), JSON.stringify({ stage: 'PROPOSAL_READY', mine: true, requestId: f.ready.requestId, requestStatus: 'READY', requesterNickname: null }))
  assert.equal(ready.split.canRequest, false)
  assert.equal(ready.split.cannotRequestReasons.at(-1), 'SPLIT_IN_PROGRESS')
  for (const action of ['edit', 'delete', 'complete', 'schedule']) assert.equal(ready.allowedActions[action], false, action)
  assert.equal(ready.unavailableReasons.edit, 'SPLIT_IN_PROGRESS')
  assert.equal(JSON.stringify((await task('otherProcessing')).split.lock), JSON.stringify({ stage: 'PROCESSING', mine: false, requestId: null, requestStatus: null, requesterNickname: '김서연' }))
  const free = await task('free')
  assert.equal(JSON.stringify(free.split), '{"recommended":true,"canRequest":true,"cannotRequestReasons":[],"lock":null}')
  assert.equal(JSON.stringify((await task('linked')).split.cannotRequestReasons), '["HAS_LINKED_SCHEDULE"]')
  assert.equal((await task('expired')).split.lock, null)
})
test('접수는 동의, 대상, 잠금, 한도 순서로 거부한다', async () => {
  const { api, split } = setup()
  const f = split.mockSplitFixtures
  const submit = (taskId) => api('/v2/task-splits', 'POST', { taskId })
  const first = await submit(f.free.taskId)
  assert.equal(first.status, 409)
  assert.equal(first.body.code, 'SPLIT_CONSENT_REQUIRED')
  assert.equal(first.body.split.currentDisclosureVersion, '1')
  assert.equal((await api('/v2/task-splits/consent', 'PUT', { disclosureVersion: '0' })).body.code, 'SPLIT_CONSENT_OUTDATED')
  assert.equal((await api('/v2/task-splits/consent', 'PUT', { disclosureVersion: '1' })).status, 200)
  const linked = await submit(f.linked.taskId)
  assert.equal(linked.status, 422)
  assert.equal(JSON.stringify(linked.body.split.reasons), '["HAS_LINKED_SCHEDULE"]')
  const other = await submit(f.otherProcessing.taskId)
  assert.equal(other.body.code, 'SPLIT_ALREADY_IN_PROGRESS')
  assert.equal(other.body.split.requesterNickname, '김서연')
  assert.equal(other.body.split.lockStage, 'PROCESSING')
  const ok = await submit(f.free.taskId)
  assert.equal(ok.status, 201)
  assert.equal(ok.body.request.status, 'QUEUED')
  assert.equal(ok.body.quota.remaining, 1)
  const again = await submit(f.free.taskId)
  assert.equal(again.status, 409)
  assert.equal(again.body.split.requestId, ok.body.request.requestId)
  split.mockSplitSettings.used = 3
  const full = await submit(f.discarded.taskId)
  assert.equal(full.status, 429)
  assert.equal(full.body.split.quotaLimit, 3)
  assert.equal(typeof full.body.split.quotaResetsAt, 'string')
  split.mockSplitSettings.available = false
  assert.equal((await submit(f.discarded.taskId)).status, 503)
})
test('취소와 버리기는 상태에 맞을 때만 받는다', async () => {
  const { api, split } = setup()
  const f = split.mockSplitFixtures
  const post = (key, action) => api(`/v2/task-splits/${f[key].requestId}/${action}`, 'POST')
  const cancelled = await post('queued', 'cancel')
  assert.equal(cancelled.body.request.status, 'CANCELLED')
  assert.equal((await api(`/v2/workspace/tasks/${f.queued.taskId}`)).body.split.lock, null)
  assert.equal((await post('queued', 'cancel')).status, 200)
  const wrong = await post('ready', 'cancel')
  assert.equal(wrong.status, 409)
  assert.equal(wrong.body.code, 'SPLIT_REQUEST_STATE_CHANGED')
  assert.equal(wrong.body.split.currentStatus, 'READY')
  assert.equal((await post('running', 'discard')).body.split.currentStatus, 'RUNNING')
  const discarded = await post('ready', 'discard')
  assert.equal(discarded.body.undoable, true)
  assert.equal(discarded.body.request.status, 'DISCARDED')
  assert.equal((await post('failed', 'discard')).body.undoable, false)
  assert.equal((await post('otherReady', 'discard')).status, 404)
  assert.equal((await api('/v2/task-splits/999999/cancel', 'POST')).body.code, 'SPLIT_REQUEST_NOT_FOUND')
})
test('잠긴 작업을 바꾸는 명령은 409로 거부된다', async () => {
  const { api, split } = setup()
  const f = split.mockSplitFixtures
  const before = (await api(`/v2/workspace/tasks/${f.ready.taskId}`)).body
  const refused = await api(`/v2/workspace/tasks/${f.ready.taskId}?expectedVersion=${before.version}`, 'DELETE')
  assert.equal(refused.status, 409)
  assert.equal(refused.body.code, 'TASK_LOCKED_BY_SPLIT')
  assert.equal(refused.body.split.requestId, f.ready.requestId)
  assert.equal(refused.body.split.lockStage, 'PROPOSAL_READY')
  assert.equal(refused.body.message, '쪼개기 제안을 정리한 뒤 바꿔 주세요.')
})
test('처리가 끝나면 준비됨이 되고 변경 신호가 남는다', async () => {
  const { api, split, state } = setup()
  const f = split.mockSplitFixtures
  const before = state.latestChangeId()
  split.finishMockSplit(f.queued.requestId, 'READY')
  const item = (await api('/v2/task-splits')).body.items.find((i) => i.requestId === f.queued.requestId)
  assert.equal(item.status, 'READY')
  assert.equal(typeof item.expiresAt, 'string')
  assert.ok(state.latestChangeId() > before)
})

// 제안 상세(S5)와 초안 검사(S6). 검사 규칙과 문구는 서버 `SplitDraftCheck`·`SplitErrorMessages`를 따른다.
const check = loadModules()('src/mocks/taskSplitCheck.ts')
const piece = (key, over = {}) => ({ key, title: key, description: '설명', minutes: 60, difficulty: 3, dueDate: '2026-11-20', after: [], selected: true, ...over })
const run = (pieces, over = {}) => check.computeSplitCheck({ pieces, storedExclusions: {}, factors: { 3: 1, 5: 1.2 }, originalDueDate: '2026-11-25', today: '2026-11-17', adminOnly: false, ...over })
const of = (result, key) => result.pieces.find((p) => p.key === key)
test('보정 후 시간과 4시간 판정', () => {
  const r = run([piece('a', { minutes: 236 }), piece('b', { minutes: 200, difficulty: 5 }), piece('c', { minutes: 61, difficulty: 5 })])
  assert.equal(of(r, 'a').shownMinutes, 236)
  assert.equal(of(r, 'a').over, false)
  assert.equal(of(r, 'b').shownMinutes, 240)
  assert.equal(of(r, 'b').over, true)
  assert.equal(of(r, 'c').shownMinutes, 75)
  assert.equal(r.overCount, 1)
  assert.equal(r.totalMinutes, 236 + 240 + 75)
})
test('뺀 조각을 건너뛰어 잇고 후보에 알린다', () => {
  const r = run([piece('a'), piece('x', { after: ['a'], selected: false }), piece('b', { after: ['x'] })])
  assert.equal(JSON.stringify(of(r, 'b').before), '["a"]')
  assert.equal(of(r, 'b').stage, 1)
  assert.equal(of(r, 'x').stage, null)
  assert.equal(of(r, 'b').orderChoices.find((c) => c.key === 'a').link, 'VIA_EXCLUDED')
  const choice = of(r, 'a').orderChoices.find((c) => c.key === 'b')
  assert.equal(choice.link, 'NONE')
  assert.equal(choice.blocked, true)
  assert.equal(r.selectedCount, 2)
})
test('마감 순서가 어긋나면 두 조각 모두에 오류가 붙고 만들 수 없다', () => {
  const r = run([piece('a', { dueDate: '2026-11-22' }), piece('b', { after: ['a'], dueDate: '2026-11-20' })])
  assert.equal(JSON.stringify(of(r, 'a').errors), '[{"field":"dueDate","message":"다음 조각 \\"b\\"(11/20)보다 늦어요."}]')
  assert.equal(JSON.stringify(of(r, 'b').errors), '[{"field":"dueDate","message":"이전 조각 \\"a\\"(11/22)보다 빨라요."}]')
  assert.equal(r.problemCount, 2)
  assert.equal(r.canApply, false)
  assert.equal(r.cannotApplyReason, 'HAS_PROBLEMS')
})
test('자기 마감에 오류가 있는 조각과의 마감 순서는 따지지 않는다', () => {
  // 원본 마감(11/25)이 지난 뒤 a→b→c(11/23, 11/24, 11/25)에서 a만 원본 마감으로 고친 경우
  const r = run([
    piece('a', { dueDate: '2026-11-25' }),
    piece('b', { after: ['a'], dueDate: '2026-11-24' }),
    piece('c', { after: ['b'], dueDate: '2026-11-25' }),
  ], { today: '2026-11-26', action: { type: 'CONFIRM', key: 'a' } })
  assert.equal(JSON.stringify(of(r, 'a').errors), '[]')
  assert.equal(JSON.stringify(of(r, 'b').errors), '[{"field":"dueDate","message":"원본 마감이 지나 모든 마감은 원본 마감이어야 해요."}]')
  assert.equal(JSON.stringify(of(r, 'c').errors), '[]')
  assert.equal(r.accepted, true)
  const late = run([piece('a', { dueDate: '2026-11-30' }), piece('b', { after: ['a'], dueDate: '2026-11-20' })])
  assert.equal(JSON.stringify(of(late, 'b').errors), '[]')
})
test('되풀이하는 제목은 20자에서 자르고 없는 제목은 비운다', () => {
  const long = '가'.repeat(25)
  const r = run([piece('a', { title: long }), piece('b', { after: ['a'], title: null }), piece('c')])
  assert.equal(of(r, 'c').orderChoices.find((c) => c.key === 'a').title, `${'가'.repeat(20)}…`)
  assert.equal(of(r, 'c').orderChoices.find((c) => c.key === 'b').title, '')
  const ordered = run([piece('a', { title: long, dueDate: '2026-11-22' }), piece('b', { after: ['a'], title: null })])
  assert.equal(of(ordered, 'b').errors.find((e) => e.field === 'dueDate').message, `이전 조각 "${'가'.repeat(20)}…"(11/22)보다 빨라요.`)
  assert.equal(of(ordered, 'a').errors.find((e) => e.field === 'dueDate').message, '다음 조각 ""(11/20)보다 늦어요.')
})
test('순서 칸 오류는 뺀 조각에도 붙고 고칠 곳으로 센다', () => {
  const r = run([piece('a'), piece('x', { selected: false, after: ['y'] }), piece('y', { selected: false, after: ['x'], title: '' })])
  assert.equal(of(r, 'x').errors[0].field, 'after')
  assert.equal(of(r, 'x').errors[0].message, '이전 조각을 따라가면 이 조각으로 돌아와요. 순서를 고쳐 주세요.')
  assert.equal(of(r, 'y').errors.length, 1)
  assert.equal(JSON.stringify(of(r, 'x').orderChoices), '[]')
  assert.equal(r.problemCount, 2)
  assert.equal(of(run([piece('a', { after: ['ghost'] })]), 'a').errors[0].message, '없는 조각은 이전 조각으로 고를 수 없어요.')
})
test('확인은 그 조각에 오류가 없을 때만 받아들이고, 빼기는 늘 받아들인다', () => {
  assert.equal(run([piece('a', { title: '' })], { action: { type: 'CONFIRM', key: 'a' } }).accepted, false)
  assert.equal(run([piece('a')], { action: { type: 'CONFIRM', key: 'a' } }).accepted, true)
  assert.equal(run([piece('a', { selected: false })], { action: { type: 'EXCLUDE', key: 'a' } }).accepted, true)
  assert.equal(run([piece('a')]).accepted, null)
})
test('만들 조각이 없는 이유와 겹침 경고', () => {
  const stored = { storedExclusions: { a: { reason: 'DUPLICATES_OPEN', evidenceTaskId: 1, evidenceTitle: '온보딩 문구 다듬기' } } }
  assert.equal(run([piece('a', { selected: false })], stored).emptyReason, 'ALL_EXCLUDED_BY_AI')
  const mixed = run([piece('a', { selected: false }), piece('b', { selected: false })], stored)
  assert.equal(mixed.emptyReason, 'ALL_REMOVED_BY_MEMBER')
  assert.equal(mixed.cannotApplyReason, 'NOTHING_SELECTED')
  assert.equal(of(run([piece('a')], stored), 'a').warnings[0].evidenceTitle, '온보딩 문구 다듬기')
  assert.equal(of(run([piece('a')]), 'a').warnings.length, 0)
  assert.equal(run([piece('a', { selected: false })], { adminOnly: true }).cannotApplyReason, 'ADMIN_ONLY')
})
test('오늘이 원본 마감을 지났으면 마감 한도는 둘 다 원본 마감이다', () => {
  const r = run([piece('a')], { today: '2026-11-26' })
  assert.equal(r.limits.dueMin, '2026-11-25')
  assert.equal(r.limits.dueMax, '2026-11-25')
  assert.equal(of(r, 'a').errors[0].message, '원본 마감이 지나 모든 마감은 원본 마감이어야 해요.')
  assert.equal(of(run([piece('a', { title: '' })]), 'a').errors[0].message, '제목은 1~20자로 입력해 주세요.')
})
test('제안 상세는 준비됨일 때만 제안과 첫 검사 결과를 준다', async () => {
  const { api, split } = setup()
  const f = split.mockSplitFixtures
  const ready = await api(`/v2/task-splits/${f.ready.requestId}`)
  assert.equal(ready.body.request.status, 'READY')
  assert.equal(ready.body.request.pieceCount, 5)
  assert.equal(ready.body.request.excludedCount, 2)
  assert.equal(ready.body.proposal.pieces.length, 7)
  assert.equal(ready.body.proposal.factors['5'], 1.2)
  assert.equal(ready.body.proposal.pieces.find((p) => p.key === 'x2').exclusion.reason, 'DUPLICATES_OPEN')
  assert.equal(ready.body.proposal.pieces.find((p) => p.key === 'a').exclusion, null)
  assert.equal(ready.body.check.selectedCount, 5)
  assert.equal(ready.body.check.canApply, true)
  assert.equal(ready.body.check.accepted, null)
  const expired = await api(`/v2/task-splits/${f.expired.requestId}`)
  assert.equal(expired.body.request.status, 'EXPIRED')
  assert.equal(expired.body.proposal, null)
  assert.equal((await api(`/v2/task-splits/${f.queued.requestId}`)).body.check, null)
  assert.equal((await api(`/v2/task-splits/${f.otherReady.requestId}`)).status, 404)
  assert.equal((await api(`/v2/task-splits/${f.adminOnly.requestId}`)).body.check.cannotApplyReason, 'ADMIN_ONLY')
  assert.equal((await api(`/v2/task-splits/${f.allExcluded.requestId}`)).body.check.emptyReason, 'ALL_EXCLUDED_BY_AI')
  assert.equal((await api(`/v2/task-splits/${f.violation.requestId}`)).body.check.overCount, 1)
})
test('검사는 저장하지 않고, 준비됨이 아니거나 조각이 다르면 거부한다', async () => {
  const { api, split } = setup()
  const f = split.mockSplitFixtures
  const { proposal } = (await api(`/v2/task-splits/${f.ready.requestId}`)).body
  const pieces = proposal.pieces.map(({ exclusion: _e, dueDateAdjusted: _d, ...p }) => (p.key === 'a' ? { ...p, selected: false } : p))
  const checked = await api(`/v2/task-splits/${f.ready.requestId}/check`, 'POST', { pieces, action: { type: 'EXCLUDE', key: 'a' } })
  assert.equal(checked.body.selectedCount, 4)
  assert.equal(checked.body.accepted, true)
  const back = pieces.map((p) => (p.key === 'x2' ? { ...p, selected: true } : p))
  const warned = await api(`/v2/task-splits/${f.ready.requestId}/check`, 'POST', { pieces: back, action: { type: 'INCLUDE', key: 'x2' } })
  assert.equal(warned.body.pieces.find((p) => p.key === 'x2').warnings[0].evidenceTitle, '온보딩 문구 다듬기')   // 저장된 근거로 정한다
  assert.equal((await api(`/v2/task-splits/${f.ready.requestId}`)).body.check.selectedCount, 5)
  const fewer = await api(`/v2/task-splits/${f.ready.requestId}/check`, 'POST', { pieces: pieces.slice(1) })
  assert.equal(fewer.status, 422)
  assert.equal(fewer.body.code, 'SPLIT_INVALID_PIECES')
  const late = await api(`/v2/task-splits/${f.expired.requestId}/check`, 'POST', { pieces: [] })
  assert.equal(late.status, 409)
  assert.equal(late.body.split.currentStatus, 'EXPIRED')
})
test('검사 본문의 모양 오류는 서버처럼 422와 400으로 나뉜다', async () => {
  const { api, split } = setup()
  const f = split.mockSplitFixtures
  const route = `/v2/task-splits/${f.ready.requestId}/check`
  const { proposal } = (await api(`/v2/task-splits/${f.ready.requestId}`)).body
  const pieces = proposal.pieces
  const missing = await api(route, 'POST', {})
  assert.equal(missing.status, 422)
  assert.equal(missing.body.message, '조각 구성이 제안과 달라요. 제안을 다시 열어 확인해 주세요.')
  assert.equal(missing.body.split, null)
  assert.equal((await api(route, 'POST', { pieces: [...pieces, pieces[0]] })).status, 422)
  const ghost = await api(route, 'POST', { pieces, action: { type: 'CONFIRM', key: 'ghost' } })
  assert.equal(ghost.status, 400)
  assert.equal(JSON.stringify(ghost.body), '{"code":"INVALID_REQUEST","message":"입력한 내용을 다시 확인해 주세요."}')
  assert.equal((await api(route, 'POST', { pieces, action: { type: 'MOVE', key: 'a' } })).status, 400)
  assert.equal((await api(route, 'POST', { pieces: pieces.map((p) => ({ ...p, selected: null })) })).status, 400)
  assert.equal((await api(route, 'POST', { pieces: pieces.map((p) => ({ ...p, after: null })) })).status, 400)
  assert.equal((await api('/v2/task-splits/999999/check', 'POST', { pieces })).status, 404)
})
test('처리가 끝나면 일반 제안이 함께 생기고 보관함의 조각 수가 제안을 따른다', async () => {
  const { api, split } = setup()
  const f = split.mockSplitFixtures
  split.finishMockSplit(f.queued.requestId, 'READY')
  const detail = (await api(`/v2/task-splits/${f.queued.requestId}`)).body
  assert.equal(detail.proposal.pieces.length, 3)
  assert.equal(detail.proposal.originalMinutes, 300)
  assert.equal(detail.check.canApply, true)
  const item = (await api('/v2/task-splits')).body.items.find((i) => i.requestId === f.queued.requestId)
  assert.equal(item.pieceCount, 3)
  assert.equal(item.excludedCount, 0)
})

// 만들기(S7)와 되돌리기(S10·S11). 만들기는 서버 `SplitApplyService`·`SplitApplyWriter`·`SplitInheritance`를,
// 되돌리기는 ADR-0035 §13과 합의한 계약(백엔드 X5 계획)을 따른다.
const open = async (api, id) => (await api(`/v2/task-splits/${id}`)).body.proposal.pieces
test('만들면 조각 작업이 생기고 원본은 휴지통으로 가며, 되돌리면 그대로 돌아온다', async () => {
  const { api, split } = setup()
  const f = split.mockSplitFixtures.ready
  const pieces = await open(api, f.requestId)
  const applied = await api(`/v2/task-splits/${f.requestId}/apply`, 'POST', { pieces })
  assert.equal(applied.status, 200)
  assert.equal(applied.body.request.status, 'APPLIED')
  assert.equal(applied.body.created.length, 5)
  assert.equal(applied.body.trashedTaskId, f.taskId)
  assert.equal((await api(`/v2/workspace/tasks/${f.taskId}`)).status, 404)
  const made = (await api(`/v2/workspace/tasks/${applied.body.created[0].taskId}`)).body
  assert.equal(made.task.title, '현재 온보딩 흐름 정리')
  assert.equal(made.split.lock, null)
  assert.equal((await api(`/v2/task-splits/${f.requestId}/apply`, 'POST', { pieces })).body.split.currentStatus, 'APPLIED')
  const undone = await api(`/v2/task-splits/${f.requestId}/undo-apply`, 'POST')
  assert.equal(undone.body.request.status, 'READY')
  assert.equal(undone.body.restoredTaskId, f.taskId)
  assert.equal(JSON.stringify(undone.body.notRestored), '[]')
  assert.equal((await api(`/v2/workspace/tasks/${applied.body.created[0].taskId}`)).status, 404)
  assert.equal((await api(`/v2/workspace/tasks/${f.taskId}`)).body.split.lock.stage, 'PROPOSAL_READY')
  const again = await api(`/v2/task-splits/${f.requestId}/undo-apply`, 'POST')
  assert.equal(again.status, 409)
  assert.equal(again.body.split.undoReason, 'STATE')
})
test('조각 문제로 거부할 때 검사 결과를 함께 준다', async () => {
  const { api, split } = setup()
  const f = split.mockSplitFixtures.ready
  const pieces = (await open(api, f.requestId)).map((p) => (p.key === 'a' ? { ...p, title: '' } : p))
  const refused = await api(`/v2/task-splits/${f.requestId}/apply`, 'POST', { pieces })
  assert.equal(refused.status, 422)
  assert.equal(refused.body.code, 'SPLIT_INVALID_PIECES')
  assert.equal(refused.body.split.check.problemCount, 1)
  assert.equal((await api(`/v2/task-splits/${f.requestId}`)).body.request.status, 'READY')
  const none = pieces.map((p) => ({ ...p, selected: false }))
  assert.equal((await api(`/v2/task-splits/${f.requestId}/apply`, 'POST', { pieces: none })).body.code, 'SPLIT_NOTHING_SELECTED')
})
test('권한을 잃은 요청과 미리 정한 거부', async () => {
  const { api, split, proposals } = setup()
  const f = split.mockSplitFixtures
  const admin = await api(`/v2/task-splits/${f.adminOnly.requestId}/apply`, 'POST', { pieces: await open(api, f.adminOnly.requestId) })
  assert.equal(admin.status, 422)
  assert.equal(JSON.stringify(admin.body.split.reasons), '["ADMIN_ONLY"]')
  const pieces = await open(api, f.ready.requestId)
  proposals.failNextMockApply('EXPIRED')
  assert.equal((await api(`/v2/task-splits/${f.ready.requestId}/apply`, 'POST', { pieces })).body.split.currentStatus, 'EXPIRED')
  proposals.failNextMockApply('UNEXPECTED')
  const odd = await api(`/v2/task-splits/${f.ready.requestId}/apply`, 'POST', { pieces })
  assert.equal(odd.status, 409)
  assert.equal(odd.body.code, 'STATE_CONFLICT')
  assert.equal((await api(`/v2/task-splits/${f.ready.requestId}/apply`, 'POST', { pieces })).status, 200)
})
test('버린 제안은 되돌릴 수 있고 실패 항목은 되돌릴 수 없다', async () => {
  const { api, split } = setup()
  const f = split.mockSplitFixtures
  await api(`/v2/task-splits/${f.ready.requestId}/discard`, 'POST')
  const undone = await api(`/v2/task-splits/${f.ready.requestId}/undo-discard`, 'POST')
  assert.equal(undone.body.request.status, 'READY')
  assert.equal((await api(`/v2/workspace/tasks/${f.ready.taskId}`)).body.split.lock.mine, true)
  await api(`/v2/task-splits/${f.failed.requestId}/discard`, 'POST')
  const refused = await api(`/v2/task-splits/${f.failed.requestId}/undo-discard`, 'POST')
  assert.equal(refused.status, 409)
  assert.equal(refused.body.code, 'SPLIT_UNDO_NOT_AVAILABLE')
  assert.equal(refused.body.split.undoReason, 'STATE')
})

/** 원본(ready)에 선행 둘(하나는 반복 회차)과 후행 하나를 건다. */
const withNeighbors = (load, split, workspace) => {
  const { mockTasks } = load('src/mocks/db.ts')
  const f = split.mockSplitFixtures.ready
  const make = (title) => workspace.mockWorkspaceRemote.createTask(title, { spaceId: -1, projectId: null, assigneeId: 1 }, 1).task.id
  const [before, recurring, after] = [make('앞 작업'), make('반복 앞 작업'), make('뒤 작업')]
  const task = (id) => mockTasks.find((t) => t.id === id)
  task(recurring).recurrence = { id: 9, rule: 'FREQ=DAILY' }
  task(f.taskId).previousTaskIds = [before, recurring]
  task(f.taskId).nextTaskIds = [after]
  task(before).nextTaskIds = [f.taskId]
  task(recurring).nextTaskIds = [f.taskId]
  task(after).previousTaskIds = [f.taskId]
  return { before, recurring, after, task }
}
test('만들기는 원본의 선후관계를 첫 조각과 마지막 조각에 넘기고 반복 회차는 넘기지 않는다', async () => {
  const { api, split, workspace, load, state } = setup()
  const f = split.mockSplitFixtures.ready
  const { before, recurring, after, task } = withNeighbors(load, split, workspace)
  const since = state.latestChangeId()
  // b를 빼면 c의 이전 조각은 a만 남는다
  const pieces = (await open(api, f.requestId)).map((p) => (p.key === 'b' ? { ...p, selected: false } : p))
  const applied = await api(`/v2/task-splits/${f.requestId}/apply`, 'POST', { pieces })
  assert.equal(applied.status, 200)
  const id = Object.fromEntries(applied.body.created.map((c) => [c.key, c.taskId]))
  assert.equal(JSON.stringify(applied.body.created.map((c) => c.key)), '["a","c","d","e"]')
  assert.equal(
    JSON.stringify(applied.body.createdEdges),
    JSON.stringify([
      { fromTaskId: id.a, toTaskId: id.c },
      { fromTaskId: id.c, toTaskId: id.d },
      { fromTaskId: id.d, toTaskId: id.e },
      { fromTaskId: before, toTaskId: id.a },
      { fromTaskId: id.e, toTaskId: after },
    ]),
  )
  assert.equal(JSON.stringify(applied.body.notInherited), JSON.stringify([{ taskId: recurring, direction: 'BEFORE', reason: 'RECURRING_TASK' }]))
  assert.equal(JSON.stringify(task(before).nextTaskIds), JSON.stringify([id.a]))
  assert.equal(JSON.stringify(task(after).previousTaskIds), JSON.stringify([id.e]))
  assert.equal(JSON.stringify(task(recurring).nextTaskIds), '[]')
  assert.equal(task(id.c).inboundDependencyCount, 1)
  const made = (await api(`/v2/workspace/tasks/${id.c}`)).body
  assert.equal(made.task.expectedDuration, 'PT2H30M')
  assert.equal(made.task.importance, 6)
  assert.equal(made.task.dueDate.zoneId, 'Asia/Seoul')
  assert.equal(made.assigneeId, 1)
  const changes = state.changesAfter(1, null, since).map((c) => `${c.action}:${c.resourceId}`)
  assert.equal(JSON.stringify(changes), JSON.stringify([...Object.values(id).map((t) => `CREATED:${t}`), `DELETED:${f.taskId}`]))
  // 되돌리면 조각과 그 간선이 사라지고 원본의 간선이 돌아온다. 반복 회차와 휴지통에 간 이웃의 간선은 돌려놓지 못한다
  // (서버 `TrashRestorePolicy`: 양 끝이 살아 있고 반복 회차가 아니어야 한다).
  const trash = load('src/mocks/trash.ts')
  trash.moveTaskToTrash(after, false)
  const since2 = state.latestChangeId()
  const undone = await api(`/v2/task-splits/${f.requestId}/undo-apply`, 'POST')
  assert.equal(undone.status, 200)
  assert.equal(undone.body.restoredEdgeCount, 1)
  assert.equal(JSON.stringify(undone.body.notRestored), JSON.stringify([{ taskId: recurring, direction: 'BEFORE' }, { taskId: after, direction: 'AFTER' }]))
  assert.equal(JSON.stringify(task(f.taskId).previousTaskIds), JSON.stringify([before]))
  assert.equal(JSON.stringify(task(before).nextTaskIds), JSON.stringify([f.taskId]))
  assert.equal(task(id.a), undefined)
  assert.equal(JSON.stringify(trash.trashedTaskOf(id.a)), 'null')
  const actions = state.changesAfter(1, null, since2).map((c) => `${c.action}:${c.resourceId}`)
  assert.equal(JSON.stringify(actions), JSON.stringify([...Object.values(id).map((t) => `PURGED:${t}`), `RESTORED:${f.taskId}`, `SPLIT_CHANGED:${f.taskId}`]))
})
test('만들기 되돌리기는 계약의 순서로 이유 하나를 낸다', async () => {
  const fresh = async () => {
    const ctx = setup()
    const f = ctx.split.mockSplitFixtures.ready
    const applied = await ctx.api(`/v2/task-splits/${f.requestId}/apply`, 'POST', { pieces: await open(ctx.api, f.requestId) })
    return { ...ctx, f, ids: applied.body.created.map((c) => c.taskId), undo: () => ctx.api(`/v2/task-splits/${f.requestId}/undo-apply`, 'POST') }
  }
  const reason = async (response) => {
    const { status, body } = await response
    assert.equal(status, 409)
    assert.equal(body.code, 'SPLIT_UNDO_NOT_AVAILABLE')
    assert.equal(body.message, '더 이상 되돌릴 수 없어요.')
    return body.split.undoReason
  }
  let ctx = await fresh()
  ctx.workspace.mockWorkspaceRemote.renameTask(ctx.ids[0], '바꾼 제목')
  ctx.split.mockSplitRequests.find((r) => r.requestId === ctx.f.requestId).expiresAt = new Date(Date.now() - 1000).toISOString()
  assert.equal(await reason(ctx.undo()), 'EXPIRED')
  ctx = await fresh()
  ctx.load('src/mocks/trash.ts').restoreTaskFromTrash(ctx.f.taskId)
  assert.equal(await reason(ctx.undo()), 'ORIGINAL_MISSING')
  ctx = await fresh()
  ctx.load('src/mocks/trash.ts').trashedTaskOf(ctx.f.taskId).task.title = '휴지통에서 바뀜'
  assert.equal(await reason(ctx.undo()), 'ORIGINAL_CHANGED')
  ctx = await fresh()
  ctx.workspace.mockWorkspaceRemote.renameTask(ctx.ids[0], '바꾼 제목')
  assert.equal(await reason(ctx.undo()), 'PIECES_CHANGED')
  ctx = await fresh()
  ctx.workspace.mockWorkspaceRemote.completeTask(ctx.ids[1])
  assert.equal(await reason(ctx.undo()), 'PIECES_CHANGED')
  ctx = await fresh()
  ctx.state.placementOf('task', ctx.ids[0]).assigneeId = null   // 담당자만 바뀐 조각은 그대로다
  assert.equal((await ctx.undo()).status, 200)
  assert.equal((await ctx.api('/v2/task-splits/999999/undo-apply', 'POST')).body.code, 'SPLIT_REQUEST_NOT_FOUND')
  assert.equal((await ctx.api(`/v2/task-splits/${ctx.split.mockSplitFixtures.otherReady.requestId}/undo-apply`, 'POST')).status, 404)
})
test('버리기 되돌리기는 계약의 순서로 이유 하나를 낸다', async () => {
  const fresh = async () => {
    const ctx = setup()
    const f = ctx.split.mockSplitFixtures.ready
    await ctx.api(`/v2/task-splits/${f.requestId}/discard`, 'POST')
    return { ...ctx, f, undo: () => ctx.api(`/v2/task-splits/${f.requestId}/undo-discard`, 'POST') }
  }
  let ctx = await fresh()
  ctx.split.mockSplitRequests.find((r) => r.requestId === ctx.f.requestId).expiresAt = new Date(Date.now() - 1000).toISOString()
  assert.equal((await ctx.undo()).body.split.undoReason, 'EXPIRED')
  ctx = await fresh()
  ctx.workspace.mockWorkspaceRemote.completeTask(ctx.f.taskId)
  const ineligible = await ctx.undo()
  assert.equal(ineligible.body.split.undoReason, 'ORIGINAL_NOT_ELIGIBLE')
  assert.equal(JSON.stringify(ineligible.body.split.reasons), '["TASK_COMPLETED"]')
  ctx = await fresh()
  ctx.load('src/mocks/trash.ts').moveTaskToTrash(ctx.f.taskId, false)
  assert.equal(JSON.stringify((await ctx.undo()).body.split.reasons), '["TASK_IN_TRASH"]')
  ctx = await fresh()
  ctx.workspace.mockWorkspaceRemote.renameTask(ctx.f.taskId, '바꾼 원본')
  assert.equal((await ctx.undo()).body.split.undoReason, 'ORIGINAL_CHANGED')
  ctx = await fresh()
  await ctx.api('/v2/task-splits/consent', 'PUT', { disclosureVersion: '1' })
  assert.equal((await ctx.api('/v2/task-splits', 'POST', { taskId: ctx.f.taskId })).status, 201)
  assert.equal((await ctx.undo()).body.split.undoReason, 'OTHER_REQUEST_EXISTS')
  ctx = await fresh()
  const before = ctx.state.latestChangeId()
  assert.equal((await ctx.undo()).status, 200)
  assert.equal(JSON.stringify(ctx.state.changesAfter(1, null, before).map((c) => c.action)), '["SPLIT_CHANGED"]')
})
test('fixture의 버림·적용됨 요청과 처리가 끝난 요청도 되돌릴 수 있다', async () => {
  const { api, split } = setup()
  const f = split.mockSplitFixtures
  const discarded = await api(`/v2/task-splits/${f.discarded.requestId}/undo-discard`, 'POST')
  assert.equal(discarded.status, 200)
  assert.equal(discarded.body.request.pieceCount, 3)
  assert.equal(discarded.body.request.excludedCount, 1)
  assert.equal((await api(`/v2/task-splits/${f.discarded.requestId}`)).body.check.canApply, true)
  const applied = await api(`/v2/task-splits/${f.applied.requestId}/undo-apply`, 'POST')
  assert.equal(applied.status, 200)
  assert.equal(applied.body.restoredTaskId, f.applied.taskId)
  const original = (await api(`/v2/workspace/tasks/${f.applied.taskId}`)).body
  assert.equal(original.task.title, '블로그 이전')
  assert.equal(original.split.lock.stage, 'PROPOSAL_READY')
  assert.equal((await api(`/v2/task-splits/${f.applied.requestId}`)).body.check.canApply, true)
  split.finishMockSplit(f.queued.requestId, 'READY')
  const pieces = await open(api, f.queued.requestId)
  assert.equal((await api(`/v2/task-splits/${f.queued.requestId}/apply`, 'POST', { pieces })).status, 200)
  assert.equal((await api(`/v2/task-splits/${f.queued.requestId}/undo-apply`, 'POST')).status, 200)
  await api(`/v2/task-splits/${f.queued.requestId}/discard`, 'POST')
  assert.equal((await api(`/v2/task-splits/${f.queued.requestId}/undo-discard`, 'POST')).status, 200)
})
test('만들기 본문의 모양 오류는 검사와 같이 422와 400으로 나뉜다', async () => {
  const { api, split } = setup()
  const f = split.mockSplitFixtures
  const route = `/v2/task-splits/${f.ready.requestId}/apply`
  const pieces = await open(api, f.ready.requestId)
  const fewer = await api(route, 'POST', { pieces: pieces.slice(1) })
  assert.equal(fewer.status, 422)
  assert.equal(fewer.body.split, null)
  assert.equal((await api(route, 'POST', { pieces: pieces.map((p) => ({ ...p, after: null })) })).status, 400)
  assert.equal((await api('/v2/task-splits/999999/apply', 'POST', { pieces })).status, 404)
  assert.equal((await api(`/v2/task-splits/${f.expired.requestId}/apply`, 'POST', { pieces })).body.split.currentStatus, 'EXPIRED')
  const late = pieces.map((p) => (p.key === 'a' ? { ...p, minutes: 600 } : p))   // 4시간 넘는 조각은 막지 않는다
  assert.equal((await api(route, 'POST', { pieces: late, action: { type: 'MOVE', key: 'ghost' } })).status, 200)
})
test('공간 접근은 남고 삭제 권한만 잃으면 만들기 되돌리기는 PERMISSION이다', async () => {
  const { api, split, workspace, state } = setup()
  const taskId = workspace.mockWorkspaceRemote.createTask('팀 위키 개편', { spaceId: 2, projectId: 21, assigneeId: 1, dueInDays: 9 }, 1).task.id
  await api('/v2/task-splits/consent', 'PUT', { disclosureVersion: '1' })
  const requestId = (await api('/v2/task-splits', 'POST', { taskId })).body.request.requestId
  split.finishMockSplit(requestId, 'READY')
  assert.equal((await api(`/v2/task-splits/${requestId}/apply`, 'POST', { pieces: await open(api, requestId) })).status, 200)
  state.findSpace(2).members.find((m) => m.memberId === 1).role = 'MEMBER'
  const refused = await api(`/v2/task-splits/${requestId}/undo-apply`, 'POST')
  assert.equal(refused.status, 409)
  assert.equal(refused.body.split.undoReason, 'PERMISSION')
})
test('만들기를 되돌리면 보관함과 요약의 수가 만들기 전으로 돌아온다', async () => {
  const { api, split } = setup()
  const f = split.mockSplitFixtures.ready
  const counts = async () => {
    const inbox = (await api('/v2/task-splits')).body.items
    return JSON.stringify({
      archiveCount: (await api('/v2/task-splits/summary')).body.archiveCount,
      ids: inbox.map((i) => i.requestId),
      item: inbox.find((i) => i.requestId === f.requestId),
    })
  }
  const before = await counts()
  await api(`/v2/task-splits/${f.requestId}/apply`, 'POST', { pieces: await open(api, f.requestId) })
  assert.notEqual(await counts(), before)
  assert.equal((await api(`/v2/task-splits/${f.requestId}/undo-apply`, 'POST')).status, 200)
  assert.equal(await counts(), before)
})
test('같은 시간을 다르게 적은 조각은 바뀐 조각이 아니다', async () => {
  const { api, split, load } = setup()
  const { mockTasks } = load('src/mocks/db.ts')
  const f = split.mockSplitFixtures.ready
  const applied = await api(`/v2/task-splits/${f.requestId}/apply`, 'POST', { pieces: await open(api, f.requestId) })
  const c = mockTasks.find((t) => t.id === applied.body.created.find((p) => p.key === 'c').taskId)
  assert.equal(c.expectedDuration, 'PT2H30M')
  c.expectedDuration = 'PT150M'
  assert.equal((await api(`/v2/task-splits/${f.requestId}/undo-apply`, 'POST')).status, 200)
})
test('만료 시각이 없는 요청의 되돌리기는 STATE다', async () => {
  const { api, split } = setup()
  const f = split.mockSplitFixtures
  const request = (key) => split.mockSplitRequests.find((r) => r.requestId === f[key].requestId)
  await api(`/v2/task-splits/${f.ready.requestId}/apply`, 'POST', { pieces: await open(api, f.ready.requestId) })
  request('ready').expiresAt = null
  assert.equal((await api(`/v2/task-splits/${f.ready.requestId}/undo-apply`, 'POST')).body.split.undoReason, 'STATE')
  await api(`/v2/task-splits/${f.violation.requestId}/discard`, 'POST')
  request('violation').expiresAt = null
  assert.equal((await api(`/v2/task-splits/${f.violation.requestId}/undo-discard`, 'POST')).body.split.undoReason, 'STATE')
})
test('검사와 만들기는 같은 본문 판정을 쓴다', async () => {
  const { api, split } = setup()
  const f = split.mockSplitFixtures.ready
  const pieces = await open(api, f.requestId)
  for (const action of ['check', 'apply']) {
    const route = `/v2/task-splits/${f.requestId}/${action}`
    assert.equal((await api(route, 'POST', {})).status, 422, action)
    assert.equal((await api(route, 'POST', { pieces: null })).status, 422, action)
    assert.equal((await api(route, 'POST', { pieces: [null, ...pieces.slice(1)] })).status, 422, action)
    assert.equal((await api(route, 'POST', { pieces: pieces.map((p) => ({ ...p, selected: null })) })).status, 400, action)
    assert.equal((await api(route, 'POST', { pieces: pieces.map((p) => ({ ...p, after: [1] })) })).status, 400, action)
  }
})

// 서버 코드와 대조하며 맞춘 곳(BE 계약 대조).
test('연결 일정은 요청하는 회원 본인의 일정만 본다(서버 findAllByOwnerIdAndTaskIdIn(actor, …))', async () => {
  const { api, split, load } = setup()
  const f = split.mockSplitFixtures
  const { mockSchedules } = load('src/mocks/db.ts')
  mockSchedules.push({ ...mockSchedules.find((s) => s.taskId === f.linked.taskId), id: 99_001, ownerId: 2, taskId: f.free.taskId })
  const free = (await api(`/v2/workspace/tasks/${f.free.taskId}`)).body
  assert.equal(JSON.stringify(free.split.cannotRequestReasons), '[]')
  assert.equal(free.split.canRequest, true)
})
test('한도로 거부된 접수는 만료된 제안을 만료로 바꿔 두지 않는다(서버는 한 트랜잭션이라 함께 되돌린다)', async () => {
  const { api, split, state } = setup()
  const f = split.mockSplitFixtures
  await api('/v2/task-splits/consent', 'PUT', { disclosureVersion: '1' })
  split.mockSplitSettings.used = split.mockSplitSettings.limit
  const before = state.latestChangeId()
  const full = await api('/v2/task-splits', 'POST', { taskId: f.expired.taskId })
  assert.equal(full.status, 429)
  assert.equal(split.mockSplitRequests.find((r) => r.requestId === f.expired.requestId).status, 'READY')
  assert.equal(state.latestChangeId(), before)
})
test('fixture에 적은 조각 수는 만들어 둔 제안의 수와 같다', async () => {
  const { api, split } = setup()
  const f = split.mockSplitFixtures
  const counts = async () =>
    JSON.stringify((await api('/v2/task-splits')).body.items.map((i) => [i.requestId, i.pieceCount, i.excludedCount]))
  const before = await counts()
  for (const key of ['ready', 'violation', 'adminOnly', 'allExcluded']) await api(`/v2/task-splits/${f[key].requestId}`)
  assert.equal(await counts(), before)
  // 보관함에 없는 준비됨 fixture(만료, 다른 참여자)도 저장된 수가 제안과 같다.
  for (const key of ['expired', 'otherReady', 'discarded']) {
    const request = split.mockSplitRequests.find((r) => r.requestId === f[key].requestId)
    const item = split.itemOf(request)
    assert.equal(`${key}:${item.pieceCount}/${item.excludedCount}`, `${key}:${request.pieceCount}/${request.excludedCount}`)
  }
})
test('위반이 남은 채 준비된 요청의 일반 제안에는 4시간 이상인 조각이 있다', async () => {
  const { api, split } = setup()
  const f = split.mockSplitFixtures
  split.finishMockSplit(f.queued.requestId, 'READY_WITH_VIOLATION')
  const detail = (await api(`/v2/task-splits/${f.queued.requestId}`)).body
  assert.equal(detail.request.violationRemaining, true)
  assert.equal(detail.proposal.violationRemaining, true)
  assert.ok(detail.check.overCount >= 1, `overCount ${detail.check.overCount}`)
  split.finishMockSplit(f.running.requestId, 'READY')
  assert.equal((await api(`/v2/task-splits/${f.running.requestId}`)).body.check.overCount, 0)
})
test('되풀이하는 제목은 한도 자리가 서로게이트 쌍의 가운데면 그 글자 앞에서 자른다', () => {
  const title = `${'가'.repeat(19)}😀끝`
  const r = run([piece('a', { title }), piece('c')])
  assert.equal(of(r, 'c').orderChoices.find((c) => c.key === 'a').title, `${'가'.repeat(19)}…`)
})
test('빈 글인지는 Java isBlank처럼 본다: NBSP만 있는 제목·설명은 비어 있지 않다', () => {
  const nbsp = run([piece('a', { title: ' ', description: '  ' })])
  assert.equal(JSON.stringify(of(nbsp, 'a').errors), '[]')
  const blank = run([piece('a', { title: ' \t　', description: '\n ' })])
  assert.equal(JSON.stringify(of(blank, 'a').errors.map((e) => e.field)), '["title","description"]')
  // JS trim은 BOM을 지우지만 Java isWhitespace는 BOM을 공백으로 보지 않는다.
  assert.equal(JSON.stringify(of(run([piece('a', { title: '﻿' })]), 'a').errors), '[]')
})
test('칸 오류의 문구와 순서는 서버 SplitDraftCheck와 같다(제목, 설명, 시간, 난이도, 마감, 이전 조각)', () => {
  const r = run([piece('a', { title: '', description: '', minutes: 4, difficulty: 4, dueDate: null, after: ['zz'] })])
  assert.equal(
    JSON.stringify(of(r, 'a').errors),
    JSON.stringify([
      { field: 'title', message: '제목은 1~20자로 입력해 주세요.' },
      { field: 'description', message: '설명은 1~2,000자로 입력해 주세요.' },
      { field: 'minutes', message: '예상 시간은 5분~24시간으로 넣어 주세요.' },
      { field: 'difficulty', message: '난이도는 1, 2, 3, 5, 8, 13, 21 중에서 골라 주세요.' },
      { field: 'dueDate', message: '마감 날짜를 넣어 주세요.' },
      { field: 'after', message: '없는 조각은 이전 조각으로 고를 수 없어요.' },
    ]),
  )
  assert.equal(of(run([piece('a', { minutes: 1441 })]), 'a').errors[0].message, '예상 시간은 5분~24시간으로 넣어 주세요.')
  assert.equal(of(run([piece('a', { description: 'x'.repeat(2001) })]), 'a').errors[0].field, 'description')
  assert.equal(of(run([piece('a', { dueDate: '2026-11-16' })]), 'a').errors[0].message, '이미 지난 날짜예요. 오늘 이후로 넣어 주세요.')
  assert.equal(of(run([piece('a', { dueDate: '2026-11-26' })]), 'a').errors[0].message, '원본 마감(11/25)보다 늦을 수 없어요.')
  assert.equal(of(run([piece('a', { dueDate: '2026-11-31' })]), 'a').errors[0].message, '마감 날짜를 넣어 주세요.')
  const cycle = run([piece('a', { after: ['b'] }), piece('b', { after: ['a'] })])
  assert.equal(of(cycle, 'a').errors[0].message, '이전 조각을 따라가면 이 조각으로 돌아와요. 순서를 고쳐 주세요.')
})
