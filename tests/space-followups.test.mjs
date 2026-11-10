import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { requireFrom } from './support/errors.mjs'

const plain = (value) => JSON.parse(JSON.stringify(value))
function load(path, dependencies = {}, globals = {}) {
  const source = readFileSync(
    new URL('../src/' + path, import.meta.url),
    'utf8',
  )
  const output = ts.transpileModule(source, {
    fileName: path,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText
  const module = { exports: {} }
  vm.runInNewContext(output, {
    module,
    exports: module.exports,
    URL,
    URLSearchParams,
    AbortController,
    TextDecoder,
    setTimeout,
    clearTimeout,
    console: { error() {} },
    require: requireFrom(dependencies),
    ...globals,
  })
  return module.exports
}

test('space marks are stable per id and neutral for personal spaces', () => {
  const { spaceMark, SPACE_MARKS } = load('features/spaces/marks.ts')
  assert.deepEqual([...SPACE_MARKS], ['#3e8391', '#9165b0', '#a77d35', '#43886b', '#ad6280'])
  assert.equal(spaceMark({ id: 31, personal: false }), '#9165b0')
  assert.equal(spaceMark({ id: 35, personal: false }), '#3e8391')
  assert.equal(spaceMark({ id: -4, personal: true }), null)
  assert.equal(spaceMark({ id: -7, personal: false }), '#a77d35')
})

test('the bar switcher names the space, and the project only on scoped lists', () => {
  const { switcherLabel } = load('features/spaces/scope.ts')
  const space = { name: '핀잇 개선' }, project = { name: '작업 카드 개선' }
  assert.equal(switcherLabel('selected', space, project, false), '핀잇 개선 › 작업 카드 개선')
  assert.equal(switcherLabel('all', space, project, false), '핀잇 개선')
  assert.equal(switcherLabel('selected', null, null, true), '스페이스 불러오는 중')
  assert.equal(switcherLabel('selected', null, null, false), '스페이스 선택')
})

test('the sheet lists live projects of the chosen space only', () => {
  const { sheetProjects } = load('features/spaces/scope.ts')
  const projects = [
    { id: 1, spaceId: 31, name: '작업 카드 개선', deleted: false },
    { id: 2, spaceId: 31, name: '지난 프로젝트', deleted: true },
    { id: 3, spaceId: 44, name: '11월 대회 준비', deleted: false },
    { id: 4, spaceId: 31, name: '온보딩 안내 정리', deleted: false },
  ]
  assert.deepEqual(plain(sheetProjects(projects, 31).map((p) => p.id)), [1, 4])
  assert.deepEqual(plain(sheetProjects(projects, null)), [])
})

test('unavailable copy comes from the server reason, not from roles', () => {
  const { unavailableText, adminNames } = load('features/spaces/unavailable.ts')
  assert.equal(unavailableText('ADMIN_ONLY', ['서연']), '관리자 서연님만 할 수 있어요.')
  assert.equal(unavailableText('ADMIN_ONLY', ['서연', '도현']), '관리자 서연·도현님만 할 수 있어요.')
  assert.equal(unavailableText('ADMIN_ONLY', []), '관리자만 할 수 있어요.')
  assert.equal(unavailableText('SPACE_DELETED', []), '휴지통에 있는 스페이스라 할 수 없어요.')
  assert.equal(unavailableText('SCHEDULE_RUNNING', ['서연']), '진행 중이거나 멈춘 일정은 삭제할 수 없어요.')
  assert.equal(unavailableText(undefined, ['서연']), '지금은 할 수 없어요.')
  assert.deepEqual(adminNames([
    { memberId: 1, nickname: '서연', role: 'ADMIN' },
    { memberId: 2, nickname: '나', role: 'MEMBER' },
  ]), ['서연'])
})

test('every server reason code has its own sentence and unknown codes fall back', () => {
  const { unavailableText } = load('features/spaces/unavailable.ts')
  assert.equal(unavailableText('PROJECT_DELETED', []), '휴지통에 있는 프로젝트라 할 수 없어요.')
  assert.equal(unavailableText('PERSONAL_SPACE', []), '나의 스페이스에서는 할 수 없어요.')
  assert.equal(unavailableText('LAST_ADMIN', ['서연']), '다른 관리자를 정한 뒤 나갈 수 있어요.')
  assert.equal(unavailableText('TASK_COMPLETED', []), '완료한 작업은 일정에 넣을 수 없어요.')
  assert.equal(unavailableText('PREDECESSOR_INCOMPLETE', []), '먼저 할 작업을 끝내야 일정에 넣을 수 있어요.')
  assert.equal(unavailableText('ALREADY_SCHEDULED', []), '이미 일정에 넣은 작업이에요.')
  assert.equal(unavailableText('RECURRING_TASK', []), '반복 작업은 순서를 연결할 수 없어요.')
  assert.equal(unavailableText('A_CODE_ADDED_LATER', ['서연']), '지금은 할 수 없어요.')
})

test('the edit reason also explains the FE-only update alias for spaces and projects', async () => {
  const space = {
    id: 22, name: '팀', purpose: null, personal: false, version: 0, deletedAt: null,
    allowedActions: { edit: false, delete: false },
    unavailableReasons: { edit: 'SPACE_DELETED', delete: 'SPACE_DELETED' },
  }
  const project = {
    id: 5, spaceId: 22, name: '프로젝트', outcome: null, completed: false, version: 0, deletedAt: null,
    allowedActions: { edit: false, delete: false },
    unavailableReasons: { edit: 'PROJECT_DELETED', delete: 'PROJECT_DELETED' },
  }
  const plainProject = { ...project, id: 6, allowedActions: { edit: true }, unavailableReasons: undefined }
  const api = load('features/spaces/api.ts', {
    '@shared/api/config': { buildApiUrl: (path) => path },
    '@shared/api/httpClient': {
      httpClient: async (url) =>
        url.startsWith('/spaces?')
          ? { defaultSpaceId: -1, currentMember: { memberId: 1, nickname: '나' }, spaces: [space] }
          : { space, projects: [project, plainProject], members: [] },
    },
  })
  const snapshot = await api.fetchWorkspace()
  assert.equal(snapshot.spaces[0].unavailableReasons.update, 'SPACE_DELETED')
  assert.equal(snapshot.projects[0].unavailableReasons.update, 'PROJECT_DELETED')
  assert.equal(snapshot.projects[0].unavailableReasons.delete, 'PROJECT_DELETED')
  assert.equal(snapshot.projects[1].unavailableReasons, undefined)
})

test('unavailableLines skips enabled actions and collapses identical texts in order', () => {
  const { unavailableLines } = load('features/spaces/unavailable.ts')
  assert.deepEqual(
    plain(
      unavailableLines(
        [
          { off: false, reason: 'ADMIN_ONLY' },
          { off: true, reason: undefined },
          { off: true, reason: 'ADMIN_ONLY' },
          { off: true, reason: undefined },
          { off: true, reason: 'SPACE_DELETED' },
        ],
        ['서연'],
      ),
    ),
    ['지금은 할 수 없어요.', '관리자 서연님만 할 수 있어요.', '휴지통에 있는 스페이스라 할 수 없어요.'],
  )
  assert.deepEqual(plain(unavailableLines([{ off: false, reason: undefined }], [])), [])
})

test('my input keeps only the fields I changed', () => {
  const { changedInput } = load('features/spaces/conflicts.ts', { '@shared/api/httpClient': { ApiError: class {} } })
  const labels = { title: '제목', description: '설명', dueDate: '마감일' }
  const before = { title: '첫 작업 기록 안내 초안', description: '', dueDate: '2026-11-03' }
  const mine = { title: '첫 작업 기록 안내 초안 다듬기', description: '두 줄로 줄였어요.', dueDate: '2026-11-03' }
  assert.deepEqual(plain(changedInput(before, mine, labels)), [
    { label: '제목', value: '첫 작업 기록 안내 초안 다듬기' },
    { label: '설명', value: '두 줄로 줄였어요.' },
  ])
  assert.deepEqual(plain(changedInput(before, before, labels)), [])
})
test('a failed reload after a conflict names why', () => {
  const { latestLoadError } = load('features/spaces/conflicts.ts', { '@shared/api/httpClient': { ApiError: class {} } })
  assert.equal(latestLoadError({ status: 404 }, '작업'), '이 작업을 찾을 수 없어요. 삭제됐을 수 있어요.')
  assert.equal(latestLoadError({ status: 403 }, '일정'), '이 일정을 볼 수 없어요. 참여 권한이 바뀌었을 수 있어요.')
  assert.equal(latestLoadError(new Error('Failed to fetch'), '작업'), '연결을 확인한 뒤 다시 시도하세요.')
})
const conflictDialog = (props) => {
  const jsx = (type, elementProps) => ({ type, props: elementProps })
  const Modal = () => null
  const Dialog = load('features/spaces/EditConflictDialog.tsx', {
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'fragment' },
    '@shared/components/common/Modal': { default: Modal },
    './MyInputDisclosure': { default: () => null },
  }).default
  const tree = Dialog({ rows: [], noun: '작업', onLoadLatest() {}, onClose() {}, onBackToList() {}, ...props })
  const nodes = []
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk)
    if (!node || typeof node !== 'object') return
    nodes.push(node)
    walk(node.props?.children)
  }
  walk(tree)
  const text = (node) => [node.props?.children].flat(Infinity).filter((part) => typeof part === 'string').join('')
  return { tree, buttons: nodes.filter((node) => node.type === 'button').map((node) => ({ label: text(node), ...node.props })), alerts: nodes.filter((node) => node.props?.role === 'alert').map(text) }
}
test('the conflict dialog can always be closed, and a failed reload offers retry and the list', () => {
  const closed = []
  const plainDialog = conflictDialog({ onClose: () => closed.push('close') })
  assert.equal(typeof plainDialog.tree.props.onClose, 'function', 'Esc closes')
  assert.deepEqual(plainDialog.buttons.map((button) => button.label), ['닫기', '최신 내용 불러오기'])
  plainDialog.buttons[0].onClick()
  assert.deepEqual(closed, ['close'])
  const failed = conflictDialog({ loadError: '이 작업을 찾을 수 없어요.' })
  assert.deepEqual(failed.buttons.map((button) => button.label), ['닫기', '목록으로', '다시 시도'])
  assert.equal(failed.alerts.length, 1)
  assert.match(failed.alerts[0], /찾을 수 없어요/)
  const loading = conflictDialog({ loading: true })
  assert.equal(loading.buttons.at(-1).disabled, true)
})
test('the affiliation summary stays pressable when only the inputs are locked', () => {
  const source = readFileSync(new URL('../src/features/spaces/AffiliationFields.tsx', import.meta.url), 'utf8')
  assert.match(source, /<fieldset className="space-affiliation">/)
  assert.match(source, /<fieldset className="space-affiliation__fields" disabled={locked}>/)
})
test('the http client no longer raises a global conflict dialog', () => {
  const source = readFileSync(new URL('../src/shared/api/httpClient.ts', import.meta.url), 'utf8')
  assert.equal(source.includes('workspace:edit-conflict'), false)
})

const impactTo = { id: 44, name: '주말 러닝 모임', personal: false, memberCount: 3 }
const impactBase = { creating: false, kind: 'task', fromSpaceId: 31, to: impactTo, assignee: { id: 7, nickname: '준호' }, destinationMemberIds: [1, 2, 3], hasLinkedItem: false, dependencyCount: 0 }
test('moving names the release, the audience and linked items', () => {
  const { affiliationImpact } = load('features/spaces/affiliationImpact.ts')
  assert.deepEqual(plain(affiliationImpact(impactBase).map((line) => line.kind)), ['release', 'share', 'linked'])
  assert.equal(affiliationImpact(impactBase)[0].text, '담당자 준호님은 주말 러닝 모임 참여자가 아니라서 저장하면 담당이 해제돼요.')
  assert.equal(affiliationImpact({ ...impactBase, dependencyCount: 2 }).at(-1).kind, 'links')
})
test('no release when the chosen assignee is a member', () => {
  const { affiliationImpact } = load('features/spaces/affiliationImpact.ts')
  assert.equal(affiliationImpact({ ...impactBase, assignee: { id: 2, nickname: '서연' } }).some((l) => l.kind === 'release'), false)
  assert.equal(affiliationImpact({ ...impactBase, destinationMemberIds: null }).some((l) => l.kind === 'release'), false)
})
test('creating in a team space only says who sees it', () => {
  const { affiliationImpact } = load('features/spaces/affiliationImpact.ts')
  assert.deepEqual(plain(affiliationImpact({ ...impactBase, creating: true, fromSpaceId: undefined })), [
    { kind: 'share', text: '주말 러닝 모임 참여자 3명이 이 작업을 함께 봐요.' },
  ])
})
test('the summary line reads space › project, assignee', () => {
  const { affiliationSummary } = load('features/spaces/affiliationImpact.ts')
  assert.equal(affiliationSummary({ name: '핀잇 개선' }, { name: '작업 카드 개선' }, { nickname: '준호' }), '핀잇 개선 › 작업 카드 개선, 담당 준호')
  assert.equal(affiliationSummary({ name: '나의 스페이스' }, null, null), '나의 스페이스, 담당자 미정')
  assert.equal(affiliationSummary({ name: '나의 스페이스' }, null, undefined), '나의 스페이스, 담당자 확인 중')
})
test('the record disclosure is asked only when moving into a shared space', () => {
  const { needsRecordDisclosure } = load('features/spaces/affiliationImpact.ts')
  assert.equal(needsRecordDisclosure({ creating: false, fromSpaceId: 31, to: impactTo }), true)
  assert.equal(needsRecordDisclosure({ creating: false, fromSpaceId: 44, to: impactTo }), false)
  assert.equal(needsRecordDisclosure({ creating: true, fromSpaceId: undefined, to: impactTo }), false)
  assert.equal(needsRecordDisclosure({ creating: false, fromSpaceId: 31, to: { ...impactTo, personal: true } }), false)
})

test('card paths name only what lies beyond the scope', () => {
  const { cardPath } = load('features/spaces/cardPath.ts')
  const spaces = [{ id: 31, name: '핀잇 개선', personal: false }, { id: -4, name: '나의 스페이스', personal: true }]
  const projects = [{ id: 88, name: '작업 카드 개선' }]
  const item = { spaceId: 31, projectId: 88 }
  assert.deepEqual(plain(cardPath('all', { spaceId: 31, projectId: null }, item, spaces, projects)), { spaceId: 31, text: '핀잇 개선 › 작업 카드 개선' })
  assert.deepEqual(plain(cardPath('selected', { spaceId: 31, projectId: null }, item, spaces, projects)), { spaceId: null, text: '작업 카드 개선' })
  assert.equal(cardPath('selected', { spaceId: 31, projectId: 88 }, item, spaces, projects), null)
  assert.deepEqual(plain(cardPath('all', { spaceId: 31, projectId: null }, { spaceId: -4, projectId: null }, spaces, projects)), { spaceId: -4, text: '나의 스페이스' })
  assert.equal(cardPath('all', { spaceId: 31, projectId: null }, { spaceId: 99, projectId: null }, spaces, projects), null)
})
