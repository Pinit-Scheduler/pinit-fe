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
  vm.runInNewContext(outputText, { module, exports: module.exports, require: requireFrom(dependencies) })
  return module.exports
}

const isoDuration = load('../src/shared/utils/isoDuration.ts')
const splitErrors = load('../src/features/task-split/api/splitErrors.ts')
const draft = load('../src/features/task-split/utils/splitDraft.ts')
const stash = load('../src/features/task-split/utils/draftStash.ts')
const screen = load('../src/features/task-split/utils/splitProposalScreen.ts', { '../api/splitErrors': splitErrors })
const labels = load('../src/features/task-split/utils/splitProposalLabels.ts', { '@shared/utils/isoDuration': isoDuration })

const check = (over = {}) => ({
  pieces: [], selectedCount: 0, totalMinutes: 0, overCount: 0, problemCount: 0, canApply: true,
  cannotApplyReason: null, emptyReason: null, accepted: null,
  limits: { titleMax: 20, descriptionMax: 200, minutesMin: 5, minutesMax: 1440, dueMin: '2026-11-17', dueMax: null },
  ...over,
})
const p = (key, over = {}) => ({ key, title: key, description: 'd', minutes: 60, difficulty: 3, dueDate: '2026-11-20', after: [], selected: true, ...over })
const info = (key, stage, over = {}) => ({ key, shownMinutes: 60, over: false, stage, before: [], errors: [], warnings: [], orderChoices: [], ...over })

test('빼기는 응답을 받으면 반영하고 기록을 쌓는다', () => {
  const start = draft.initDraft([p('a'), p('b')], check({ pieces: [info('a', 0), info('b', 0)], selectedCount: 2 }))
  const action = { type: 'EXCLUDE', key: 'a' }
  const next = draft.piecesAfter(start, action)
  assert.equal(next[0].selected, false)
  assert.equal(start.pieces[0].selected, true)
  const adopted = draft.adoptCheck(start, next, check({ pieces: [info('a', null), info('b', 0)], selectedCount: 1, accepted: true }), action)
  assert.equal(adopted.accepted, true)
  assert.equal(adopted.state.check.selectedCount, 1)
  assert.equal(adopted.state.history.length, 1)
  assert.equal(draft.undoLast(adopted.state).check.selectedCount, 2)
  assert.equal(draft.undoLast(adopted.state).history.length, 0)
  assert.equal(draft.undoLast(start), start)
})
test('넣기와 고치기는 그 조각만 바꾼다', () => {
  const start = draft.initDraft([p('a', { selected: false }), p('b')], check())
  const included = draft.piecesAfter(start, { type: 'INCLUDE', key: 'a' })
  assert.equal(included[0].selected, true)
  assert.equal(included[1], start.pieces[1])
  const edited = draft.piecesAfter(start, { type: 'CONFIRM', key: 'b' }, p('b', { title: '새 제목' }))
  assert.equal(edited[1].title, '새 제목')
  assert.equal(edited[0], start.pieces[0])
  assert.notEqual(edited, start.pieces)
  assert.equal(draft.piecesAfter(start, { type: 'CONFIRM', key: 'b' })[1].title, 'b')
})
test('확인이 거부되면 조각도 검사 결과도 바뀌지 않고 오류만 돌려준다', () => {
  const start = draft.initDraft([p('a')], check({ pieces: [info('a', 0)], selectedCount: 1 }))
  const action = { type: 'CONFIRM', key: 'a' }
  const next = draft.piecesAfter(start, action, p('a', { title: '' }))
  const refused = draft.adoptCheck(start, next, check({ accepted: false, pieces: [info('a', 0, { errors: [{ field: 'title', message: '제목은 1~20자로 입력해 주세요.' }] })] }), action)
  assert.equal(refused.accepted, false)
  assert.equal(refused.state, start)
  assert.equal(refused.errors[0].message, '제목은 1~20자로 입력해 주세요.')
})
test('받아들인 확인은 오류 없이 반영한다', () => {
  const start = draft.initDraft([p('a')], check({ pieces: [info('a', 0)], selectedCount: 1 }))
  const action = { type: 'CONFIRM', key: 'a' }
  const adopted = draft.adoptCheck(start, draft.piecesAfter(start, action, p('a', { title: '새' })), check({ accepted: true, pieces: [info('a', 0)] }), action)
  assert.equal(adopted.accepted, true)
  assert.equal(adopted.errors.length, 0)
  assert.equal(adopted.state.pieces[0].title, '새')
  assert.equal(adopted.state.history[0].pieces, start.pieces)
})
test('토스트의 되돌리기는 잡아 둔 모습으로 돌아가고 기록을 그 깊이로 자른다', () => {
  let state = draft.initDraft([p('a'), p('b'), p('c')], check({ selectedCount: 3 }))
  const step = (key, count) => {
    const action = { type: 'EXCLUDE', key }
    state = draft.adoptCheck(state, draft.piecesAfter(state, action), check({ selectedCount: count, accepted: true }), action).state
  }
  step('a', 2)
  const snapshot = { pieces: state.pieces, check: state.check }
  const depth = state.history.length
  step('b', 1)
  step('c', 0)
  const back = draft.restoreTo(state, snapshot, depth)
  assert.equal(back.check.selectedCount, 2)
  assert.equal(back.history.length, 1)
  assert.equal(draft.resetToFirst(state).check.selectedCount, 3)
  assert.equal(draft.resetToFirst(state).history.length, 0)
  const fresh = draft.initDraft([p('a')], check())
  assert.equal(draft.resetToFirst(fresh), fresh)
})
test('거부에 실린 검사 결과로 바꿔도 기록은 그대로다', () => {
  const start = draft.initDraft([p('a')], check({ selectedCount: 1 }))
  const replaced = draft.replaceCheck(start, check({ selectedCount: 1, problemCount: 1 }))
  assert.equal(replaced.check.problemCount, 1)
  assert.equal(replaced.history.length, 0)
  assert.equal(replaced.pieces, start.pieces)
})
test('단계 순서와 뺀 조각', () => {
  const state = draft.initDraft([p('c'), p('x', { selected: false }), p('a'), p('b')],
    check({ pieces: [info('c', 1), info('x', null), info('a', 0), info('b', 0)] }))
  const view = draft.viewOf(state)
  assert.equal(view.made.map((piece) => piece.key).join(), 'a,b,c')
  assert.equal(view.stages.map((stage) => stage.length).join(), '2,1')
  assert.equal(view.dropped[0].key, 'x')
  assert.equal(draft.infoOf(state.check, 'c').stage, 1)
  assert.equal(draft.infoOf(state.check, 'zzz'), undefined)
})
test('서버 단계 번호가 비어도 빈 단계를 만들지 않는다', () => {
  const state = draft.initDraft([p('a'), p('b')], check({ pieces: [info('a', 0), info('b', 2)] }))
  assert.equal(draft.viewOf(state).stages.map((stage) => stage.map((piece) => piece.key).join()).join('|'), 'a|b')
})
test('null인 필드가 빠진 채 와도 같게 다룬다', () => {
  const { stage: _stage, ...withoutStage } = info('x', null)
  const state = draft.initDraft([p('a'), p('x', { selected: false })], check({ pieces: [info('a', 0), withoutStage] }))
  assert.equal(draft.viewOf(state).made.map((piece) => piece.key).join(), 'a')
  const { accepted: _accepted, ...noAccepted } = check({ selectedCount: 1 })
  const action = { type: 'CONFIRM', key: 'a' }
  assert.equal(draft.adoptCheck(state, draft.piecesAfter(state, action, p('a')), noAccepted, action).accepted, true)
  assert.equal(screen.screenOfDetail({ request: { requestId: 31, status: 'EXPIRED' } }).kind, 'expired')
  assert.equal(screen.screenOfDetail({ request: { requestId: 31, status: 'READY' } }).kind, 'processed')
  assert.equal(labels.emptyText(undefined), '만들 조각이 없어요. 아래에서 조각을 다시 넣어 주세요.')
})
test('맡아 둔 조각은 한 번만 꺼낸다', () => {
  stash.stashDraft(31, [p('a')])
  assert.equal(stash.takeDraft(31)[0].key, 'a')
  assert.equal(stash.takeDraft(31), null)
  assert.equal(stash.takeDraft(99), null)
})

const detail = (status, over = {}) => ({ request: { requestId: 31, status }, proposal: null, check: null, ...over })
const notReady = (currentStatus) => apiError('준비되지 않았어요.', 409, { code: 'SPLIT_REQUEST_NOT_READY', split: { currentStatus } })

test('제안을 열었을 때의 화면', () => {
  const ready = detail('READY', { proposal: { pieces: [] }, check: check() })
  const opened = screen.screenOfDetail(ready)
  assert.equal(opened.kind, 'ready')
  assert.equal(opened.detail, ready)
  for (const status of ['QUEUED', 'RUNNING', 'FAILED']) assert.equal(screen.screenOfDetail(detail(status)).kind, 'to-inbox')
  for (const status of ['APPLIED', 'DISCARDED', 'CANCELLED', 'SOMETHING_NEW', 'READY']) assert.equal(screen.screenOfDetail(detail(status)).kind, 'processed')
  assert.equal(screen.screenOfDetail(detail('READY', { proposal: { pieces: [] } })).kind, 'processed')
  assert.equal(screen.screenOfDetail(detail('EXPIRED')).kind, 'expired')
  assert.equal(screen.screenOfError(apiError('없음', 404, { code: 'SPLIT_REQUEST_NOT_FOUND' })).kind, 'missing')
  assert.match(screen.screenOfError(new Error('offline')).message, /^제안을 불러오지 못했어요\./)
})
test('준비되지 않음 거부의 현재 상태', () => {
  assert.equal(screen.screenOfError(notReady('RUNNING')).kind, 'to-inbox')
  assert.equal(screen.screenOfError(notReady('EXPIRED')).kind, 'expired')
  assert.equal(screen.screenOfError(notReady('APPLIED')).kind, 'processed')
  assert.equal(screen.screenOfError(notReady('READY')).kind, 'reload')
  assert.equal(screen.screenOfError(notReady(null)).kind, 'processed')
  assert.equal(screen.screenOfError(apiError('준비되지 않았어요.', 409, { code: 'SPLIT_REQUEST_NOT_READY' })).kind, 'processed')
  assert.equal(screen.screenOfError(notReady('SOMETHING_NEW')).kind, 'processed')
  assert.equal(screen.applyRejectionOf(notReady('READY')).screen.kind, 'reload')
  assert.equal(screen.checkFailureOf(notReady('READY')).screen.kind, 'reload')
  assert.equal(screen.applyRejectionOf(notReady(undefined)).screen.kind, 'processed')
  assert.equal(screen.checkFailureOf(notReady(undefined)).screen.kind, 'processed')
})
test('만들기 거부의 갈래', () => {
  assert.equal(screen.applyRejectionOf(notReady('EXPIRED')).screen.kind, 'expired')
  assert.equal(screen.applyRejectionOf(notReady('APPLIED')).screen.kind, 'processed')
  assert.equal(screen.applyRejectionOf(apiError('없음', 404, { code: 'SPLIT_REQUEST_NOT_FOUND' })).screen.kind, 'missing')
  assert.equal(screen.applyRejectionOf(apiError('쪼갤 수 없어요.', 422, { code: 'SPLIT_NOT_ELIGIBLE', split: { reasons: ['ADMIN_ONLY'] } })).kind, 'admin-only')
  assert.equal(screen.applyRejectionOf(apiError('쪼갤 수 없어요.', 422, { code: 'SPLIT_NOT_ELIGIBLE', split: { reasons: ['TASK_DONE'] } })).kind, 'toast')
  const problems = screen.applyRejectionOf(apiError('확인', 422, { code: 'SPLIT_INVALID_PIECES', split: { check: check({ problemCount: 2 }) } }))
  assert.equal(problems.kind, 'problems')
  assert.equal(problems.check.problemCount, 2)
  const fixed = '만들지 못했어요. 아무것도 바뀌지 않았어요. 잠시 뒤 다시 시도해 주세요.'
  assert.equal(screen.applyRejectionOf(apiError('선후관계에 순환이 생겨 저장할 수 없어요.', 409, { code: 'STATE_CONFLICT' })).message, fixed)
  // 검사 결과 없는 조각 문제(키가 제안과 맞지 않음)는 다시 시도해도 같아 제안을 다시 읽는다.
  assert.equal(screen.applyRejectionOf(apiError('조각 구성이 제안과 달라요.', 422, { code: 'SPLIT_INVALID_PIECES', split: {} })).screen.kind, 'reload')
  assert.equal(screen.applyRejectionOf(apiError('요청을 읽을 수 없어요.', 400, { code: 'INVALID_REQUEST' })).message, fixed)
  assert.equal(screen.applyRejectionOf(apiError('아무것도 고르지 않았어요.', 422, { code: 'SPLIT_NOTHING_SELECTED' })).message, fixed)
  // 앱 코드 없는 5xx(게이트웨이)는 처리했는지 알 수 없다. 앱이 코드를 실어 답한 5xx는 거부다.
  assert.equal(screen.applyRejectionOf(apiError('서버 오류', 500, null)).kind, 'unknown')
  assert.equal(screen.applyRejectionOf(apiError('서버 오류', 500, { code: 'INTERNAL_SERVER_ERROR' })).message, fixed)
  const lost = screen.applyRejectionOf(new Error('Failed to fetch'))
  assert.equal(lost.kind, 'unknown')
  assert.match(lost.message, /^만들었는지 확인하지 못했어요\./)
  // 응답을 받은 뒤 계정 확인(assertCurrentActor)이 던지는 401은 만들어졌을 수도 있다.
  // httpClient는 계정 확인(assertCurrentActor)에서 던질 때 그때 받은 응답 상태를 answeredStatus로 남긴다.
  const afterResponse = (status, message = '계정이 변경되었어요. 최신 화면에서 다시 시도해 주세요.') =>
    Object.assign(apiError(message, 401), { answeredStatus: status })
  const actor = screen.applyRejectionOf(afterResponse(200))
  assert.equal(actor.kind, 'unknown')
  assert.equal(actor.message, '만들었는지 확인하지 못했어요. 계정이 변경되었어요. 최신 화면에서 다시 시도해 주세요.')
  assert.equal(screen.applyRejectionOf(afterResponse(201, '')).message, '만들었는지 확인하지 못했어요. 다시 시도해 주세요.')
  // 서버가 거부로 답했거나(4xx) 보내기 전에 막힌 401은 만들어지지 않았다.
  assert.equal(screen.applyRejectionOf(afterResponse(422)).message, fixed)
  assert.equal(screen.applyRejectionOf(apiError('로그인이 필요해요. 다시 로그인해 주세요.', 401)).message, fixed)
  assert.match(screen.checkFailureOf(new Error('offline')).message, /^조각을 확인하지 못했어요\./)
  assert.equal(screen.checkFailureOf(apiError('잘못', 400, { code: 'INVALID_REQUEST' })).message, '잘못')
  assert.equal(screen.checkFailureOf(notReady('EXPIRED')).screen.kind, 'expired')
  assert.equal(screen.checkFailureOf(apiError('없음', 404, { code: 'SPLIT_REQUEST_NOT_FOUND' })).screen.kind, 'missing')
})

const proposal = { originalTitle: '온보딩 개편 설계', originalMinutes: 480, originalDueDate: '2026-11-21', expiresAt: '2026-11-24T00:05:00Z',
  violationRemaining: false, factors: {}, pieces: [] }
const day = (value) => `day(${value})`

test('고정 문구', () => {
  assert.equal(labels.LOADING, '제안을 불러오는 중이에요.')
  assert.equal(labels.MISSING, '더 이상 볼 수 없는 제안이에요.')
  assert.equal(labels.PROCESSED, '이미 처리된 요청이에요.')
  assert.equal(labels.TO_INBOX, '보관함으로')
  assert.equal(labels.EXPIRED_TITLE, '보관 기간이 끝난 제안이에요')
  assert.equal(labels.EXPIRED_REOPEN, '원본 열어 다시 쪼개기')
  assert.equal(labels.OVER_NOTE, '4시간 이상이에요. 그대로 만들 수 있지만 더 나누면 계획에 넣기 쉬워요.')
  assert.equal(labels.EDITED_TOAST, '조각을 고쳤어요.')
  assert.equal(labels.CYCLE, '순환')
  assert.deepEqual({ ...labels.PREVIOUS_HELP }, {
    label: '이전 조각', title: '이전 조각이란?',
    body: '이 조각을 시작하기 전에 끝내야 하는 조각이에요. 고른 조각을 모두 끝내야 이 조각을 시작할 수 있어요.',
  })
})
test('기간이 끝난 제안', () => {
  assert.equal(labels.expiredBody('온보딩 개편 설계'), '제안은 7일 동안만 보관해요. 아무것도 만들어지지 않았고, 원본 "온보딩 개편 설계"은 그대로 있으며 다시 고칠 수 있어요.')
  assert.equal(labels.expiredBody(null), '제안은 7일 동안만 보관해요. 아무것도 만들어지지 않았고, 원본은 그대로 있으며 다시 고칠 수 있어요.')
})
test('원본 줄과 비교 줄', () => {
  assert.equal(labels.originLine(proposal, day), '원본 8시간 · day(2026-11-21) 마감 · day(2026-11-24T00:05:00Z)까지 보관')
  assert.equal(labels.originLine({ ...proposal, originalDueDate: null }, day), '원본 8시간 · day(2026-11-24T00:05:00Z)까지 보관')
  const compare = labels.compareLine(proposal, check({ totalMinutes: 580 }))
  assert.equal(compare.before, '원본 8시간')
  assert.equal(compare.after, '9시간 40분')
})
test('빈 목록과 뺀 조각', () => {
  assert.equal(labels.emptyText('ALL_EXCLUDED_BY_AI'), '이미 끝낸 것 같아요. 아래 근거를 보고, 필요한 조각만 다시 넣어 주세요.')
  assert.equal(labels.emptyText('ALL_REMOVED_BY_MEMBER'), '만들 조각이 없어요. 아래에서 조각을 다시 넣어 주세요.')
  assert.equal(labels.emptyText(null), '만들 조각이 없어요. 아래에서 조각을 다시 넣어 주세요.')
  assert.equal(labels.droppedTitle(3), '뺀 조각 3개')
  const done = { reason: 'ALREADY_DONE', evidenceTaskId: 9, evidenceTitle: '로그인 정리' }
  const dup = { reason: 'DUPLICATES_OPEN', evidenceTaskId: 9, evidenceTitle: '로그인 정리' }
  assert.equal(labels.droppedNote(p('x', { exclusion: done }), info('x', null)), '이미 끝낸 것 같아요 · 로그인 정리')
  assert.equal(labels.droppedNote(p('x', { exclusion: dup }), info('x', null)), '겹치는 작업이 있어요 · 로그인 정리')
  assert.equal(labels.droppedNote(p('x', { exclusion: null }), info('x', null, { shownMinutes: 90 })), '내가 뺌 · 1시간 30분')
  assert.equal(labels.droppedNote(p('x'), info('x', null, { shownMinutes: 90 })), '내가 뺌 · 1시간 30분')
})
test('조각 안내', () => {
  const done = { reason: 'ALREADY_DONE', evidenceTaskId: 9, evidenceTitle: '로그인 정리' }
  const warnings = [
    { kind: 'OVERLAPS_OPEN_TASK', evidenceTaskId: 3, evidenceTitle: '디자인 검토' },
    { kind: 'OVERLAPS_OPEN_TASK', evidenceTaskId: 4, evidenceTitle: '문서 정리' },
  ]
  assert.deepEqual([...labels.pieceNotes(p('a', { exclusion: done }), info('a', 0, { warnings }))], [
    '"로그인 정리"에서 이미 끝냈을 수 있어요.',
    '"디자인 검토" 작업과 겹칠 수 있어요.',
    '"문서 정리" 작업과 겹칠 수 있어요.',
  ])
  assert.equal(labels.pieceNotes(p('a', { exclusion: { ...done, reason: 'DUPLICATES_OPEN' } }), info('a', 0)).length, 0)
  assert.equal(labels.pieceNotes(p('a'), undefined).length, 0)
  assert.equal(labels.orderChoiceNote({ key: 'b', title: 'b', link: 'DIRECT', blocked: true }), '순환이 생겨요')
  assert.equal(labels.orderChoiceNote({ key: 'b', title: 'b', link: 'VIA_EXCLUDED', blocked: false }), '뺀 조각을 거쳐 이어져 있어요')
  assert.equal(labels.orderChoiceNote({ key: 'b', title: 'b', link: 'NONE', blocked: false }), '')
})
test('토스트', () => {
  assert.equal(labels.removedToast('요구 정리'), '"요구 정리" 조각을 뺐어요.')
  assert.equal(labels.restoredToast('요구 정리'), '"요구 정리" 조각을 다시 넣었어요.')
})
test('적용 막대와 안내 문구의 경계', () => {
  assert.equal(labels.applySummary(check({ selectedCount: 5, totalMinutes: 580 })).main, '5개 · 9시간 40분')
  assert.equal(labels.applySummary(check({ problemCount: 2, overCount: 1 })).warn, '고칠 곳 2개')
  assert.equal(labels.applySummary(check({ overCount: 1 })).warn, '4시간 이상 1개')
  assert.equal(labels.applySummary(check()).warn, '')
  assert.equal(labels.madeToast(5, 0), '조각 5개를 만들었어요.')
  assert.equal(labels.madeToast(5, 1), '조각 5개를 만들었어요. 반복 작업과의 선후관계 1개는 잇지 못했어요.')
  assert.match(labels.adminOnlyNotice([], true).body, /관리자에게 부탁하거나 제안을 버려 주세요\./)
  assert.match(labels.adminOnlyNotice(['김서연', '박지훈'], false).body, /관리자 김서연·박지훈님에게 부탁하거나/)
  assert.equal(labels.adminOnlyNotice([], false).strong, '이제 관리자만 만들 수 있어요')
  assert.equal(labels.adminOnlyNotice([], true).strong, '만들지 못했어요. 이제 관리자만 할 수 있어요')
  assert.equal(labels.adminOnlyNotice(['김서연'], true).body,
    '쪼개면 원본이 휴지통으로 가는데, 이 스페이스에서 삭제는 관리자만 할 수 있어요. 그사이 내 권한이 바뀌었어요. 관리자 김서연님에게 부탁하거나 제안을 버려 주세요. 버리면 원본 잠금이 풀려요.')
  assert.equal(labels.adminOnlyNotice([], true).body,
    '쪼개면 원본이 휴지통으로 가는데, 이 스페이스에서 삭제는 관리자만 할 수 있어요. 그사이 내 권한이 바뀌었어요. 관리자에게 부탁하거나 제안을 버려 주세요. 버리면 원본 잠금이 풀려요.')
  assert.match(labels.expiredBody(null), /^제안은 7일 동안만 보관해요\. 아무것도 만들어지지 않았고, 원본은 그대로 있으며/)
})
