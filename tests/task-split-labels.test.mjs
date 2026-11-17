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

const unavailable = loadModule('../src/features/spaces/unavailable.ts')
const labels = loadModule('../src/features/task-split/utils/splitLabels.ts', {
  '@features/spaces/unavailable': unavailable,
})
const entry = loadModule('../src/features/task-split/utils/splitEntry.ts', {
  '@features/spaces/unavailable': unavailable,
})
const paths = loadModule('../src/features/task-split/utils/splitPaths.ts')

const quota = { limit: 3, used: 1, remaining: 2, resetsAt: '2026-11-17T15:00:00Z' }
const item = (over) => ({ requestId: 1, taskId: 1, spaceId: -1, originalTitle: '온보딩 개편 설계', status: 'READY', failureReason: null,
  requestedAt: '2026-11-17T00:00:00Z', readyAt: '2026-11-17T00:05:00Z', expiresAt: '2026-11-24T00:05:00Z',
  pieceCount: 5, excludedCount: 2, violationRemaining: false, canApply: true, cannotApplyReason: null, ...over })
const day = () => '11/24'
const now = Date.parse('2026-11-17T00:38:00Z')

test('고정 문구와 경로', () => {
  assert.equal(labels.SUBMITTED, '쪼개기를 맡겼어요. 준비되면 알려 드릴게요.')
  assert.equal(labels.QUOTA_EXHAUSTED, '오늘 쪼개기 횟수를 다 썼어요. 자정에 다시 채워져요.')
  assert.equal(labels.RECOMMEND_NOTE, '예상 시간이 4시간 이상이에요. 4시간보다 작은 조각으로 쪼개면 하루 계획에 넣기 쉬워요.')
  assert.equal(labels.RECOMMEND_CHIP, '4시간 이상 · 쪼개기')
  assert.equal(labels.CANCELLED_TOAST, '쪼개기 요청을 취소했어요.')
  assert.equal(labels.DISCARDED_TOAST, '제안을 버렸어요.')
  assert.equal(paths.SPLIT_INBOX_PATH, '/app/tasks/splits')
  assert.equal(paths.splitProposalPath(12), '/app/tasks/splits/12')
  assert.equal(paths.PROPOSAL_SCREEN_READY, true)
})

test('횟수 줄과 맡기기 확인 창', () => {
  assert.equal(labels.quotaLine(quota), '오늘 3번 중 2번 남음')
  assert.equal(JSON.stringify(labels.requestConfirm(quota)), JSON.stringify({
    title: '쪼개기를 맡길까요?', body: '오늘 3번 중 1번을 써요. 맡기고 나면 1번 남아요.', confirmLabel: '쪼개기 맡기기', cancelLabel: '나중에' }))
  assert.equal(JSON.stringify(labels.CANCEL_CONFIRM), JSON.stringify({
    title: '쪼개기 요청을 취소할까요?', body: '취소해도 횟수는 돌아오지 않아요.', confirmLabel: '요청 취소', cancelLabel: '그대로 두기' }))
  assert.equal(JSON.stringify(labels.discardConfirm(false)), JSON.stringify({
    title: '제안을 버릴까요?', body: '이미 쓴 횟수는 돌아오지 않아요. 원본 작업은 그대로 남아요.', confirmLabel: '제안 버리기', cancelLabel: '그대로 두기' }))
  assert.equal(labels.discardConfirm(true).confirmLabel, '제안 버리기')
  assert.equal(labels.discardConfirm(true).cancelLabel, '그대로 두기')
})

test('잠금 안내와 칩', () => {
  const base = { requestId: null, requestStatus: null, requesterNickname: null }
  assert.equal(JSON.stringify(labels.lockNotice({ ...base, stage: 'PROCESSING', mine: true })), '{"strong":"쪼개는 중이에요","rest":"준비되면 알려 드릴게요."}')
  assert.equal(JSON.stringify(labels.lockNotice({ ...base, stage: 'PROPOSAL_READY', mine: true })), '{"strong":"쪼개기 제안이 준비됐어요","rest":"제안을 보고 조각을 만들어 보세요."}')
  assert.equal(JSON.stringify(labels.lockNotice({ ...base, stage: 'PROPOSAL_READY', mine: false, requesterNickname: '민준' })), '{"strong":"민준님이 쪼개기 제안을 받았어요.","rest":""}')
  assert.equal(labels.lockNotice({ ...base, stage: 'PROCESSING', mine: false, requesterNickname: '' }).strong, '다른 참여자님이 쪼개는 중이에요.')
  assert.equal(labels.lockChipLabel('PROCESSING'), '쪼개는 중')
  assert.equal(labels.lockChipLabel('PROPOSAL_READY'), '쪼개기 제안 준비됨')
})

test('실패 문구와 보관함 상태', () => {
  assert.equal(labels.failureText('PROVIDER_UNAVAILABLE'), 'AI 제공자가 응답하지 않았어요.')
  assert.equal(labels.failureText('PROPOSAL_UNUSABLE'), '받은 제안을 읽을 수 없었어요.')
  assert.equal(labels.failureText('PROCESSING_TIMEOUT'), '처리 시간이 너무 오래 걸렸어요.')
  assert.equal(labels.failureText(null), '쪼개기를 끝내지 못했어요.')
  assert.equal(labels.failureText('NEW_ONE'), '쪼개기를 끝내지 못했어요.')
  assert.equal(labels.inboxStateLabel('QUEUED'), '쪼개는 중')
  assert.equal(labels.inboxStateLabel('RUNNING'), '쪼개는 중')
  assert.equal(labels.inboxStateLabel('READY'), '준비됨')
  assert.equal(labels.inboxStateLabel('FAILED'), '실패')
  assert.equal(labels.inboxStateLabel('APPLIED'), '')
})

test('보관함 한 줄 설명', () => {
  assert.equal(labels.inboxNote(item(), now, day), '조각 5개 · 뺀 조각 2개 · 11/24까지 보관')
  assert.equal(labels.inboxNote(item({ excludedCount: 0 }), now, day), '조각 5개 · 11/24까지 보관')
  assert.equal(labels.inboxNote(item({ pieceCount: null, excludedCount: null, expiresAt: null }), now, day), '')
  assert.equal(labels.inboxNote(item({ pieceCount: undefined, excludedCount: undefined, expiresAt: undefined }), now, day), '')
  assert.equal(labels.inboxNote(item({ status: 'RUNNING' }), now, day), '38분 전 요청')
  assert.equal(labels.inboxNote(item({ status: 'QUEUED' }), now, day), '38분 전 요청')
  assert.equal(labels.inboxNote(item({ status: 'FAILED', failureReason: 'PROVIDER_UNAVAILABLE' }), now, day), 'AI 제공자가 응답하지 않았어요. 횟수는 돌려 드렸어요.')
  assert.equal(labels.inboxNote(item({ status: 'FAILED', failureReason: null }), now, day), '쪼개기를 끝내지 못했어요. 횟수는 돌려 드렸어요.')
})

test('지난 시간', () => {
  const at = (minutes) => new Date(now - minutes * 60000).toISOString()
  assert.equal(labels.agoLabel(at(0), now), '1분 전')
  assert.equal(labels.agoLabel(at(59), now), '59분 전')
  assert.equal(labels.agoLabel(at(60 * 23), now), '23시간 전')
  assert.equal(labels.agoLabel(at(60 * 24 * 3), now), '3일 전')
  assert.equal(labels.agoLabel('not-a-date', now), '')
  assert.equal(labels.agoLabel('', now), '')
  assert.equal(labels.inboxNote(item({ status: 'QUEUED', requestedAt: 'not-a-date' }), now, day), '')
})

test('버리기 확인 문구는 위반이 남은 제안에서 달라진다', () => {
  assert.equal(labels.discardConfirm(false).body, '이미 쓴 횟수는 돌아오지 않아요. 원본 작업은 그대로 남아요.')
  assert.equal(labels.discardConfirm(true).body, '횟수는 이미 돌려 드렸어요. 이 제안을 버릴까요?')
  assert.equal(labels.discardConfirm(true).title, '제안을 버릴까요?')
  assert.equal(labels.CANCEL_CONFIRM.body, '취소해도 횟수는 돌아오지 않아요.')
})

test('닉네임이 없는 다른 참여자의 잠금', () => {
  const lock = { stage: 'PROPOSAL_READY', mine: false, requestId: null, requestStatus: null, requesterNickname: null }
  assert.equal(labels.lockNotice(lock).strong, '다른 참여자님이 쪼개기 제안을 받았어요.')
  assert.equal(labels.lockNotice({ stage: 'PROPOSAL_READY', mine: false }).strong, '다른 참여자님이 쪼개기 제안을 받았어요.')
  assert.equal(labels.lockNotice({ ...lock, stage: 'PROCESSING', requesterNickname: '김서연' }).strong, '김서연님이 쪼개는 중이에요.')
})

test('안내 문구', () => {
  const d = labels.disclosureFor('1', 'Anthropic', quota)
  assert.equal(d.title, '쪼개기에 AI를 써요')
  assert.equal(d.lead, '작업을 나누려면 아래 내용을 외부 AI 제공자(Anthropic)에게 보내야 해요. 처음 한 번만 물어봐요.')
  assert.equal(d.sends, '이 작업의 제목·설명·마감·예상 시간·난이도와 마감이 지났는지, 스페이스 목적, 같은 프로젝트에서 최근 90일 동안 내가 끝낸 작업과 아직 하고 있는 작업의 제목과 설명(최근 것부터 100건씩), 내 난이도별 시간 보정 값')
  assert.equal(d.withholds, '다른 참여자가 맡은 작업, 담당자가 없는 작업, 닉네임, 프로젝트 목표, 핀잇 안의 작업 번호')
})

test('모르는 안내 버전은 보이지 않는다', () => {
  assert.equal(labels.disclosureFor('2', 'Anthropic', quota), null)
  assert.match(labels.disclosureFor('1', 'Anthropic', quota).lead, /외부 AI 제공자\(Anthropic\)/)
  assert.equal(labels.disclosureFor('1', 'Anthropic', quota).result, '제안은 보관함에 7일 동안 있어요. 오늘 3번 중 1번을 써요. 맡기고 나면 1번 남아요.')
})

const info = (over) => ({ recommended: true, canRequest: true, cannotRequestReasons: [], lock: null, ...over })
const mine = { stage: 'PROCESSING', mine: true, requestId: 9, requestStatus: 'QUEUED', requesterNickname: null }
test('작업에 무엇을 보일지는 서버 값으로만 정한다', () => {
  assert.equal(entry.splitEntryOf(undefined, true).kind, 'none')
  assert.equal(entry.splitEntryOf(null, true).kind, 'none')
  assert.equal(entry.splitEntryOf({ recommended: false, canRequest: true, cannotRequestReasons: [] }, true).kind, 'offer')
  assert.equal(entry.splitEntryOf(info({ lock: mine, canRequest: false, cannotRequestReasons: ['SPLIT_IN_PROGRESS'] }), false).kind, 'lock')
  assert.equal(entry.splitEntryOf(info(), false).kind, 'none')
  assert.equal(entry.splitEntryOf(info({ canRequest: false, cannotRequestReasons: ['TASK_COMPLETED'] }), true).kind, 'none')
  assert.equal(entry.splitEntryOf(info({ canRequest: false, cannotRequestReasons: ['RECURRING_TASK', 'ADMIN_ONLY'] }), true).kind, 'none')
  const blocked = entry.splitEntryOf(info({ canRequest: false, cannotRequestReasons: ['HAS_LINKED_SCHEDULE'] }), true)
  assert.equal(blocked.kind, 'offer')
  assert.equal(blocked.enabled, false)
  assert.equal(JSON.stringify(blocked.blockedReasons), '["HAS_LINKED_SCHEDULE"]')
  assert.equal(entry.showsRecommendChip(blocked), false)
  assert.equal(entry.showsRecommendChip(entry.splitEntryOf(info(), true)), true)
  assert.equal(entry.showsRecommendChip(entry.splitEntryOf(info({ recommended: false }), true)), false)
  assert.equal(entry.showsRecommendChip({ kind: 'none' }), false)
  assert.equal(entry.blockedText('ADMIN_ONLY', ['김서연']), '관리자 김서연님만 할 수 있어요.')
  assert.equal(entry.blockedText('HAS_LINKED_SCHEDULE', []), '일정에 넣은 작업은 쪼갤 수 없어요. 일정을 지우거나 연결을 푼 뒤 쪼개 주세요.')
  assert.equal(entry.blockedText('SOMETHING_NEW', []), '지금은 쪼갤 수 없어요.')
})
