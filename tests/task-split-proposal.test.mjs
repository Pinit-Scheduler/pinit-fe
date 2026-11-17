import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { apiError, requireFrom } from './support/errors.mjs'
import { deferred, hookRunner, settle } from './support/hooks.mjs'

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
// 실제 되돌리기 시간(UNDO_TOAST_MS)을 쓴다. 훅 본문만 쓰는 의존성은 빈 대체물이다.
const trashUndo = load('../src/features/trash/hooks/useTrashUndo.ts', {
  react: {}, '@contexts/ToastContext': {}, '@shared/utils/events': {}, '../api/trash': {}, '../utils/trashLabels': {},
})

const piece = (key, over = {}) => ({ key, title: key, description: 'd', minutes: 60, difficulty: 3, dueDate: '2026-11-20', after: [], selected: true, ...over })
const info = (key, over = {}) => ({ key, shownMinutes: 60, over: false, stage: 0, before: [], errors: [], warnings: [], orderChoices: [], ...over })
/** 조각 둘(a, b)짜리 검사 결과 */
const checked = ({ errorsOf = {}, ...over } = {}) => ({
  pieces: ['a', 'b'].map((key) => info(key, { errors: errorsOf[key] ?? [] })),
  selectedCount: 2, totalMinutes: 120, overCount: 0, problemCount: 0, canApply: true,
  cannotApplyReason: null, emptyReason: null, accepted: null,
  limits: { titleMax: 20, descriptionMax: 200, minutesMin: 5, minutesMax: 1440, dueMin: '2026-11-17', dueMax: null },
  ...over,
})
/** 조각 둘(a, b)짜리 제안 응답 */
const detail = {
  request: { requestId: 31, taskId: 7, status: 'READY', originalTitle: '큰 일' },
  proposal: {
    originalTitle: '큰 일', originalMinutes: 300, originalDueDate: '2026-11-20', expiresAt: '2026-11-24T00:00:00Z',
    violationRemaining: false, factors: {}, pieces: [piece('a'), piece('b')],
  },
  check: checked(),
}

const harness = (api, requestId = 31) => {
  const runner = hookRunner()
  const toasts = []
  const dismissed = []
  const calls = { detail: [], check: [] }
  const proposals = {
    fetchSplitDetail: (id) => {
      calls.detail.push(id)
      return api.fetchSplitDetail(id)
    },
    checkSplitDraft: (id, sent) => {
      calls.check.push({ requestId: id, draft: sent })
      return api.checkSplitDraft(id, sent)
    },
  }
  const { useSplitProposal } = load('../src/features/task-split/hooks/useSplitProposal.ts', {
    react: runner.react,
    '@contexts/ToastContext': {
      // addToast는 토스트 번호를 돌려준다(여기서는 몇 번째인지).
      useToast: () => ({ addToast: (...toast) => toasts.push(toast), dismissToast: (id) => dismissed.push(id) }),
    },
    '@features/trash/hooks/useTrashUndo': trashUndo,
    '../api/splitProposals': proposals,
    '../utils/splitDraft': draft,
    '../utils/draftStash': stash,
    '../utils/splitProposalScreen': screen,
    '../utils/splitProposalLabels': labels,
  })
  return { render: () => runner.render(() => useSplitProposal(requestId)), unmount: runner.unmount, toasts, dismissed, calls }
}

test('열면 받은 제안과 첫 검사 결과로 시작한다', async () => {
  const h = harness({ fetchSplitDetail: async () => detail })
  h.render(); await settle()
  const state = h.render()
  assert.equal(state.screen.kind, 'ready')
  assert.equal(state.draft.check.selectedCount, 2)
  assert.equal(h.calls.check.length, 0)
})
test('맡아 둔 조각이 있으면 그것으로 다시 검사받아 연다', async () => {
  stash.stashDraft(31, detail.proposal.pieces.map((piece) => ({ ...piece, title: '고친 ' + piece.title })))
  const h = harness({ fetchSplitDetail: async () => detail, checkSplitDraft: async () => checked({ selectedCount: 2 }) })
  h.render(); await settle()
  const state = h.render()
  assert.equal(state.draft.pieces[0].title, '고친 a')
  assert.equal(h.calls.check[0].draft.action, undefined)
})
test('빼기는 조각 전체와 동작을 보내고 응답으로 다시 그린다', async () => {
  const h = harness({ fetchSplitDetail: async () => detail, checkSplitDraft: async () => checked({ selectedCount: 1, accepted: true }) })
  h.render(); await settle()
  h.render().exclude('a'); await settle()
  const state = h.render()
  assert.equal(h.calls.check[0].draft.pieces.length, 2)
  assert.equal(JSON.stringify(h.calls.check[0].draft.action), '{"type":"EXCLUDE","key":"a"}')
  assert.equal(state.draft.check.selectedCount, 1)
  assert.equal(h.toasts[0][0], '"a" 조각을 뺐어요.')
  assert.equal(h.toasts[0][2].action.label, '되돌리기')
  assert.equal(h.toasts[0][2].durationMs, 6000)
  h.toasts[0][2].action.onAction()
  assert.equal(h.render().draft.check.selectedCount, 2)
  assert.equal(h.calls.check.length, 1)
})
test('확인이 거부되면 조각은 그대로이고 오류를 돌려준다', async () => {
  const refused = checked({ accepted: false, errorsOf: { a: [{ field: 'title', message: '제목은 1~20자로 입력해 주세요.' }] } })
  const h = harness({ fetchSplitDetail: async () => detail, checkSplitDraft: async () => refused })
  h.render(); await settle()
  const errors = await h.render().confirm({ ...detail.proposal.pieces[0], title: '' })
  assert.equal(errors[0].message, '제목은 1~20자로 입력해 주세요.')
  assert.equal(h.render().draft.pieces[0].title, 'a')
  assert.equal(h.toasts.length, 0)
})
test('검사를 기다리는 동안에는 다른 동작을 보내지 않는다', async () => {
  const wait = deferred()
  const h = harness({ fetchSplitDetail: async () => detail, checkSplitDraft: () => wait.promise })
  h.render(); await settle()
  h.render().exclude('a')
  assert.equal(h.render().busy, true)
  h.render().exclude('b')
  assert.equal(h.calls.check.length, 1)
  wait.resolve(checked({ selectedCount: 1, accepted: true })); await settle()
  assert.equal(h.render().busy, false)
})
test('검사 요청이 실패하면 아무것도 반영하지 않고 알린다', async () => {
  const h = harness({ fetchSplitDetail: async () => detail, checkSplitDraft: async () => { throw new Error('offline') } })
  h.render(); await settle()
  h.render().include('a'); await settle()
  assert.equal(h.render().draft.check.selectedCount, 2)
  assert.match(h.toasts[0][0], /^조각을 확인하지 못했어요\./)
  assert.equal(h.toasts[0][1], 'error')
})
test('다듬는 사이 만료되면 만료 안내로 바뀐다', async () => {
  const expired = apiError('준비되지 않았어요.', 409, { code: 'SPLIT_REQUEST_NOT_READY', split: { currentStatus: 'EXPIRED' } })
  const h = harness({ fetchSplitDetail: async () => detail, checkSplitDraft: async () => { throw expired } })
  h.render(); await settle()
  h.render().exclude('a'); await settle()
  assert.equal(h.render().screen.kind, 'expired')
})
test('준비됨이 아닌 요청과 없는 요청', async () => {
  const queued = harness({ fetchSplitDetail: async () => ({ request: { requestId: 31, status: 'RUNNING' }, proposal: null, check: null }) })
  queued.render(); await settle()
  assert.equal(queued.render().screen.kind, 'to-inbox')
  const gone = harness({ fetchSplitDetail: async () => { throw apiError('없음', 404, { code: 'SPLIT_REQUEST_NOT_FOUND' }) } })
  gone.render(); await settle()
  assert.equal(gone.render().screen.kind, 'missing')
})

const stillReady = () => apiError('준비되지 않았어요.', 409, { code: 'SPLIT_REQUEST_NOT_READY', split: { currentStatus: 'READY' } })

test('요청이 아직 준비됨인데 검사가 거부되면 제안을 다시 읽고 고치던 조각을 잇는다', async () => {
  const answers = [async () => { throw stillReady() }, async (_, sent) => checked({ selectedCount: sent.pieces.filter((p) => p.selected).length })]
  const h = harness({ fetchSplitDetail: async () => detail, checkSplitDraft: (id, sent) => answers.shift()(id, sent) })
  h.render(); await settle()
  // 먼저 한 조각을 고쳐 둔다(고치기는 받아들여진다).
  answers.unshift(async () => checked({ accepted: true }))
  assert.equal(await h.render().confirm({ ...detail.proposal.pieces[0], title: '고친 a' }), null)
  h.render().exclude('b'); await settle()
  const state = h.render()
  assert.equal(h.calls.detail.length, 2)
  assert.equal(state.screen.kind, 'ready')
  assert.equal(state.draft.pieces[0].title, '고친 a')
  // 거부된 빼기는 반영하지 않는다. 다시 읽은 제안 위에서 고치던 조각만 다시 검사받는다.
  assert.equal(state.draft.pieces[1].selected, true)
  assert.equal(h.calls.check[2].draft.action, undefined)
  assert.equal(state.draft.history.length, 0)
  assert.equal(state.busy, false)
})
test('다시 읽기도 거부되면 한 번만 다시 읽고 불러오기 실패로 끝난다', async () => {
  const h = harness({ fetchSplitDetail: async () => { throw stillReady() } })
  h.render(); await settle()
  const state = h.render()
  assert.equal(h.calls.detail.length, 2)
  assert.equal(state.screen.kind, 'error')
  assert.equal(state.screen.message, '준비되지 않았어요.')
})
test('불러오지 못하면 오류 화면이고 다시 시도로 다시 읽는다', async () => {
  const answers = [async () => { throw new Error('offline') }, async () => detail]
  const h = harness({ fetchSplitDetail: () => answers.shift()() })
  h.render(); await settle()
  assert.equal(h.render().screen.kind, 'error')
  assert.match(h.render().screen.message, /^제안을 불러오지 못했어요\./)
  h.render().reload(); await settle()
  assert.equal(h.render().screen.kind, 'ready')
})
test('화면을 떠난 뒤에 온 응답은 버린다', async () => {
  const open = deferred()
  const h = harness({ fetchSplitDetail: () => open.promise })
  h.render()
  h.unmount()
  open.resolve(detail); await settle()
  assert.equal(h.render().screen.kind, 'loading')
})
test('열기를 끝내기 전에 떠나면 맡아 둔 조각을 돌려놓는다', async () => {
  stash.stashDraft(31, detail.proposal.pieces)
  const open = deferred()
  const h = harness({ fetchSplitDetail: () => open.promise })
  h.render()
  h.unmount()
  assert.equal(stash.takeDraft(31).length, 2)
})
test('되돌리기와 처음 제안으로는 서버를 부르지 않는다', async () => {
  const h = harness({ fetchSplitDetail: async () => detail, checkSplitDraft: async (_, sent) => checked({ selectedCount: sent.pieces.filter((p) => p.selected).length, accepted: true }) })
  h.render(); await settle()
  h.render().exclude('a'); await settle()
  h.render().exclude('b'); await settle()
  assert.equal(h.render().draft.check.selectedCount, 0)
  h.render().undo()
  assert.equal(h.render().draft.check.selectedCount, 1)
  h.render().reset()
  assert.equal(h.render().draft.check.selectedCount, 2)
  assert.equal(h.render().draft.history.length, 0)
  assert.equal(h.calls.check.length, 2)
})

test('만드는 동안(hold)에는 빼기·고치기·되돌리기를 받지 않는다', async () => {
  const h = harness({ fetchSplitDetail: async () => detail, checkSplitDraft: async () => checked({ selectedCount: 1, accepted: true }) })
  h.render(); await settle()
  h.render().exclude('a'); await settle()
  h.render().hold(true)
  h.render().include('a'); await settle()
  assert.equal(JSON.stringify(await h.render().confirm({ ...detail.proposal.pieces[1], title: '새 제목' })), '[]')
  h.render().undo()
  h.render().reset()
  assert.equal(h.calls.check.length, 1)
  assert.equal(h.render().draft.check.selectedCount, 1)
  assert.equal(h.render().draft.history.length, 1)
  h.render().hold(false)
  h.render().undo()
  assert.equal(h.render().draft.history.length, 0)
})
test('화면을 떠나면 이 화면이 띄운 되돌리기 토스트를 닫는다', async () => {
  const h = harness({ fetchSplitDetail: async () => detail, checkSplitDraft: async () => checked({ selectedCount: 1, accepted: true }) })
  h.render(); await settle()
  h.render().exclude('a'); await settle()
  assert.equal(h.dismissed.length, 0)
  h.unmount()
  assert.equal(JSON.stringify(h.dismissed), '[1]')
})
