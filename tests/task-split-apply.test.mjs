import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { apiError, requireFrom } from './support/errors.mjs'
import { hookRunner, settle } from './support/hooks.mjs'

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
const draftUtils = load('../src/features/task-split/utils/splitDraft.ts')
const stash = load('../src/features/task-split/utils/draftStash.ts')
const paths = load('../src/features/task-split/utils/splitPaths.ts')
const screen = load('../src/features/task-split/utils/splitProposalScreen.ts', { '../api/splitErrors': splitErrors })
const labels = load('../src/features/task-split/utils/splitProposalLabels.ts', { '@shared/utils/isoDuration': isoDuration })
const trashLabels = load('../src/features/trash/utils/trashLabels.ts')
// 실제 되돌리기 시간(UNDO_TOAST_MS)을 쓴다. 훅 본문만 쓰는 의존성은 빈 대체물이다.
const trashUndo = load('../src/features/trash/hooks/useTrashUndo.ts', {
  react: {}, '@contexts/ToastContext': {}, '@shared/utils/events': {}, '../api/trash': {}, '../utils/trashLabels': {},
})

const piece = (key, over = {}) => ({ key, title: key, description: 'd', minutes: 60, difficulty: 3, dueDate: '2026-11-20', after: [], selected: true, ...over })
const info = (key, over = {}) => ({ key, shownMinutes: 60, over: false, stage: 0, before: [], errors: [], warnings: [], orderChoices: [], ...over })
/** 조각 둘(a, b)짜리 검사 결과 */
const checked = (over = {}) => ({
  pieces: ['a', 'b'].map((key) => info(key)),
  selectedCount: 2, totalMinutes: 120, overCount: 0, problemCount: 0, canApply: true,
  cannotApplyReason: null, emptyReason: null, accepted: null,
  limits: { titleMax: 20, descriptionMax: 200, minutesMin: 5, minutesMax: 1440, dueMin: '2026-11-17', dueMax: null },
  ...over,
})

/** 제안 훅(Task 7)의 상태 대신 그 상태를 바꾼 기록을 남기는 대체물과 함께 useSplitApply를 돌린다. */
const harness = (api, { pieces = [piece('a'), piece('b')], busy = false } = {}, requestId = 31) => {
  const runner = hookRunner()
  const toasts = []
  const removed = []
  const selected = []
  const navigated = []
  const changes = []
  const screens = []
  const calls = { apply: [], undo: [] }
  let draft = draftUtils.initDraft(pieces, checked())
  let reloads = 0
  const { useSplitApply } = load('../src/features/task-split/hooks/useSplitApply.ts', {
    react: runner.react,
    'react-router-dom': { useNavigate: () => (to) => navigated.push(to) },
    '@contexts/ToastContext': { useToast: () => ({ addToast: (...toast) => toasts.push(toast) }) },
    '@contexts/TaskCacheContext': { useTaskCache: () => ({ removeTask: (id) => removed.push(id) }) },
    '@shared/utils/events': { dispatchTaskChanged: (detail) => changes.push(detail) },
    '@features/spaces/store': { selectSpace: (id) => selected.push(id) },
    '@features/trash/hooks/useTrashUndo': trashUndo,
    '@features/trash/utils/trashLabels': trashLabels,
    '../api/splitProposals': {
      applySplit: (id, pieces) => {
        calls.apply.push({ requestId: id, pieces })
        return api.applySplit(id, pieces)
      },
    },
    '../api/splitUndo': {
      undoSplitApply: (id) => {
        calls.undo.push(id)
        return api.undoSplitApply(id)
      },
    },
    '../utils/draftStash': stash,
    '../utils/splitDraft': draftUtils,
    '../utils/splitPaths': paths,
    '../utils/splitProposalLabels': labels,
    '../utils/splitProposalScreen': screen,
  })
  const proposal = () => ({
    draft,
    busy,
    setScreen: (next) => screens.push(next),
    setDraft: (next) => {
      draft = next
    },
    reload: () => {
      reloads += 1
    },
  })
  return {
    hook: () => runner.render(() => useSplitApply(requestId, proposal())),
    draft: () => draft,
    toasts, removed, selected, navigated, changes, screens, calls,
    get reloads() {
      return reloads
    },
  }
}

const result = { request: { requestId: 31, spaceId: 2, status: 'APPLIED' }, created: [{ key: 'a', taskId: 101 }, { key: 'b', taskId: 102 }], createdEdges: [], notInherited: [], trashedTaskId: 7 }

test('만들면 원본의 스페이스로 바꿔 작업 맵으로 가고 되돌리기를 준다', async () => {
  const h = harness({ applySplit: async () => result })
  await h.hook().apply()
  assert.equal(JSON.stringify(h.calls.apply[0].pieces.map((piece) => piece.key)), '["a","b"]')
  assert.equal(JSON.stringify(h.removed), '[7]')
  assert.equal(JSON.stringify(h.selected), '[2]')
  assert.equal(h.navigated.at(-1), '/app/task-map')
  assert.equal(h.toasts[0][0], '조각 2개를 만들었어요.')
  assert.equal(h.toasts[0][1], 'success')
  assert.equal(h.toasts[0][2].durationMs, 6000)
  assert.equal(h.toasts[0][2].action.label, '되돌리기')
  assert.equal(JSON.stringify(h.changes), '[{"reason":"split-applied"}]')
  assert.equal(h.hook().applying, false)
  stash.takeDraft(31)
})

test('뺀 조각도 함께 보내고, 잇지 못한 선후관계를 알린다', async () => {
  const made = { ...result, created: [{ key: 'a', taskId: 101 }], notInherited: [{ taskId: 9, direction: 'BEFORE', reason: 'RECURRING' }] }
  const h = harness({ applySplit: async () => made }, { pieces: [piece('a'), piece('b', { selected: false })] })
  await h.hook().apply()
  assert.equal(JSON.stringify(h.calls.apply[0].pieces.map((p) => [p.key, p.selected])), '[["a",true],["b",false]]')
  assert.equal(h.toasts[0][0], '조각 1개를 만들었어요. 반복 작업과의 선후관계 1개는 잇지 못했어요.')
  assert.equal(stash.takeDraft(31).length, 2)
})

test('되돌리면 고치던 조각을 맡겨 둔 채 제안 화면으로 돌아간다', async () => {
  const h = harness({ applySplit: async () => result, undoSplitApply: async () => ({ request: {}, restoredTaskId: 7, restoredEdgeCount: 1, notRestored: [{ taskId: 9, direction: 'AFTER' }] }) })
  await h.hook().apply()
  h.toasts[0][2].action.onAction(); await settle()
  assert.equal(JSON.stringify(h.calls.undo), '[31]')
  assert.equal(h.navigated.at(-1), '/app/tasks/splits/31')
  assert.equal(stash.takeDraft(31).length, 2)
  assert.equal(h.toasts[1][0], '작업을 되돌렸어요. 선후관계 1개는 복구하지 못했어요.')
  assert.equal(h.toasts[1][1], 'success')
  assert.equal(JSON.stringify(h.changes.at(-1)), '{"reason":"split-undone"}')
})

test('모두 복구하면 따로 알리지 않고 제안 화면으로 돌아간다', async () => {
  const h = harness({ applySplit: async () => result, undoSplitApply: async () => ({ request: {}, restoredTaskId: 7, restoredEdgeCount: 2, notRestored: [] }) })
  await h.hook().apply()
  h.toasts[0][2].action.onAction(); await settle()
  assert.equal(h.navigated.at(-1), '/app/tasks/splits/31')
  assert.equal(h.toasts.length, 1)
  stash.takeDraft(31)
})

test('되돌리기가 거부되면 서버 문구를 보이고 작업 맵에 머문다', async () => {
  const refused = apiError('더 이상 되돌릴 수 없어요.', 409, { code: 'SPLIT_UNDO_NOT_AVAILABLE', split: { undoReason: 'PIECES_CHANGED' } })
  const h = harness({ applySplit: async () => result, undoSplitApply: async () => { throw refused } })
  await h.hook().apply()
  h.toasts[0][2].action.onAction(); await settle()
  assert.equal(h.navigated.at(-1), '/app/task-map')
  assert.equal(h.toasts[1][0], '더 이상 되돌릴 수 없어요.')
  assert.equal(h.toasts[1][1], 'error')
  assert.equal(stash.takeDraft(31), null)
  assert.equal(h.changes.length, 1)
})

test('되돌리기에 응답이 없으면 연결을 확인하라고 한다', async () => {
  const h = harness({ applySplit: async () => result, undoSplitApply: async () => { throw new Error('Failed to fetch') } })
  await h.hook().apply()
  h.toasts[0][2].action.onAction(); await settle()
  assert.equal(h.toasts[1][0], '되돌리지 못했어요. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.')
  assert.equal(h.navigated.at(-1), '/app/task-map')
})

test('조각 문제로 거부되면 토스트 없이 받은 검사 결과로 다시 그린다', async () => {
  const problems = apiError('확인', 422, { code: 'SPLIT_INVALID_PIECES', split: { check: checked({ problemCount: 1, canApply: false }) } })
  const h = harness({ applySplit: async () => { throw problems } })
  await h.hook().apply()
  assert.equal(h.draft().check.problemCount, 1)
  assert.equal(h.draft().pieces.length, 2)
  assert.equal(h.toasts.length, 0)
  assert.equal(h.navigated.length, 0)
  assert.equal(h.removed.length, 0)
})

test('권한, 만료, 그 밖의 거부', async () => {
  const admin = harness({ applySplit: async () => { throw apiError('쪼갤 수 없어요.', 422, { code: 'SPLIT_NOT_ELIGIBLE', split: { reasons: ['ADMIN_ONLY'] } }) } })
  assert.equal(admin.hook().adminRefused, false)
  await admin.hook().apply()
  assert.equal(admin.hook().adminRefused, true)
  assert.equal(admin.toasts.length, 0)
  const expired = harness({ applySplit: async () => { throw apiError('준비되지 않았어요.', 409, { code: 'SPLIT_REQUEST_NOT_READY', split: { currentStatus: 'EXPIRED' } }) } })
  await expired.hook().apply()
  assert.equal(expired.screens.at(-1).kind, 'expired')
  const odd = harness({ applySplit: async () => { throw apiError('선후관계에 순환이 생겨 저장할 수 없어요.', 409, { code: 'STATE_CONFLICT' }) } })
  await odd.hook().apply()
  assert.equal(odd.toasts[0][0], '만들지 못했어요. 아무것도 바뀌지 않았어요. 잠시 뒤 다시 시도해 주세요.')
  assert.equal(odd.toasts[0][1], 'error')
  assert.equal(odd.hook().applying, false)
})

test('요청이 아직 준비됨인데 거부되면 제안을 다시 읽게 한다', async () => {
  const h = harness({ applySplit: async () => { throw apiError('준비되지 않았어요.', 409, { code: 'SPLIT_REQUEST_NOT_READY', split: { currentStatus: 'READY' } }) } })
  await h.hook().apply()
  assert.equal(h.screens.at(-1).kind, 'reload')
  assert.equal(h.toasts.length, 0)
})

test('응답이 오지 않으면 바뀌지 않았다고 말하지 않고 조각을 맡겨 둔 채 다시 읽는다', async () => {
  const h = harness({ applySplit: async () => { throw new Error('Failed to fetch') } })
  await h.hook().apply()
  assert.match(h.toasts[0][0], /^만들었는지 확인하지 못했어요\./)
  assert.equal(h.toasts[0][1], 'error')
  assert.equal(h.reloads, 1)
  assert.equal(stash.takeDraft(31).length, 2)
})

test('응답을 받은 뒤 계정 확인에서 막히면(401) 바뀌지 않았다고 말하지 않는다', async () => {
  const h = harness({ applySplit: async () => { throw apiError('계정이 변경되었어요. 최신 화면에서 다시 시도해 주세요.', 401) } })
  await h.hook().apply()
  assert.equal(h.toasts[0][0], '만들었는지 확인하지 못했어요. 계정이 변경되었어요. 최신 화면에서 다시 시도해 주세요.')
  assert.equal(h.reloads, 1)
  assert.equal(stash.takeDraft(31).length, 2)
})

test('만드는 중이거나 검사 중이면 다시 보내지 않는다', async () => {
  let release
  const h = harness({ applySplit: () => new Promise((resolve) => { release = () => resolve(result) }) })
  const first = h.hook().apply()
  assert.equal(h.hook().applying, true)
  await h.hook().apply()
  assert.equal(h.calls.apply.length, 1)
  release()
  await first
  assert.equal(h.calls.apply.length, 1)
  stash.takeDraft(31)
  const checking = harness({ applySplit: async () => result }, { busy: true })
  await checking.hook().apply()
  assert.equal(checking.calls.apply.length, 0)
})
