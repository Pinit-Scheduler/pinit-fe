import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import React from 'react'
import * as jsxRuntime from 'react/jsx-runtime'
import { renderToStaticMarkup } from 'react-dom/server'
import { apiError, requireFrom } from './support/errors.mjs'

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
test('a failed reload after a conflict shows the server reason, or what to do when none arrived', () => {
  const { latestLoadError } = load('features/spaces/conflicts.ts', { '@shared/api/httpClient': { ApiError: class {} } })
  assert.equal(latestLoadError(apiError('작업을 찾을 수 없어요.', 404), '작업'), '작업을 찾을 수 없어요.')
  assert.equal(latestLoadError(apiError('', 403), '일정'), '최신 일정 내용을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.')
  assert.equal(
    latestLoadError(new TypeError('Failed to fetch'), '작업'),
    '최신 작업 내용을 불러오지 못했어요. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.',
  )
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
  assert.equal(plainDialog.tree.props.closing, false)
  assert.equal(conflictDialog({ closing: true }).tree.props.closing, true, 'the exit reaches the modal')
})
const affiliationFields = (props, store = {}, draft = null) => {
  // 서버 초안은 effect에서 오므로 정적 렌더에는 없다. 초안이 필요한 테스트는 그 상태 칸을 받은 것으로 채운다.
  const react = draft
    ? {
        ...React,
        useState: (initial) =>
          React.useState(
            initial && typeof initial === 'object' && 'draft' in initial
              ? { key: `${draft.spaceId}:${props.kind ?? 'task'}:0`, draft, error: null }
              : initial,
          ),
      }
    : React
  const Fields = load('features/spaces/AffiliationFields.tsx', {
    react,
    'react/jsx-runtime': jsxRuntime,
    '@shared/api/config': { buildApiUrl: (path) => path },
    '@shared/api/httpClient': { httpClient: () => new Promise(() => {}) },
    './affiliationImpact': load('features/spaces/affiliationImpact.ts'),
    './motion': { fadeIn() {}, shouldFadeText: () => false },
    './SpaceMark': { default: () => null },
    './store': {
      useSpaces: () => ({
        selectedSpaceId: 31,
        loading: false,
        error: null,
        spaces: [{ id: 31, name: '핀잇 개선', personal: false, deleted: false, members: [] }],
        projects: [],
        reload: async () => {},
        ...store,
      }),
    },
    './UnavailableNote': { default: () => null },
    './unavailable': load('features/spaces/unavailable.ts'),
    './spaces.css': {},
  }).default
  return renderToStaticMarkup(
    React.createElement(Fields, { value: { spaceId: 31, categoryId: null }, onChange() {}, creating: true, ...props }),
  )
}
test('the affiliation summary stays pressable when only the inputs are locked', () => {
  const html = affiliationFields({ disabled: true })
  assert.match(html, /<button type="button" class="space-affiliation__summary" aria-expanded="false"/)
  assert.doesNotMatch(html.match(/<button[^>]*space-affiliation__summary[^>]*>/)[0], /disabled/)
  assert.match(html, /<fieldset class="space-affiliation__fields" disabled="">/)
  assert.doesNotMatch(affiliationFields({ disabled: false }), /space-affiliation__fields" disabled/)
})
test('while the server draft loads, the pending line is for assistive technology only', () => {
  const html = affiliationFields()
  assert.match(html, /<p class="sr-only" role="status">서버의 소속·담당자 정보를 확인하고 있어요…<\/p>/)
  assert.match(html, /담당자 확인 중/, 'the summary line already says it is checking')
})

// 일정은 개인 단위다: 일정 폼은 팀 스페이스로 보내거나 다른 사람에게 맡기는 선택을 주지 않는다.
const personalStore = {
  memberId: 7,
  defaultSpaceId: -7,
  selectedSpaceId: 31,
  spaces: [
    { id: -7, name: '나의 스페이스', personal: true, deleted: false, members: [{ memberId: 7, nickname: '나' }] },
    { id: 31, name: '핀잇 개선', personal: false, deleted: false, members: [{ memberId: 7, nickname: '나' }, { memberId: 9, nickname: '준호' }, { memberId: 11, nickname: '서연' }] },
    { id: 44, name: '주말 러닝 모임', personal: false, deleted: false, members: [{ memberId: 7, nickname: '나' }] },
  ],
  projects: [
    { id: 5, name: '건강 루틴', spaceId: -7 },
    { id: 88, name: '작업 카드 개선', spaceId: 31 },
  ],
}
const optionsOf = (html, label) => {
  const field = html.match(new RegExp(`<label>${label}<select[^>]*>(.*?)</select>`))
  return field ? [...field[1].matchAll(/<option[^>]*>([^<]*)</g)].map(([, text]) => text) : null
}
test('a new schedule can only be filed under my own space: no space or assignee choice', () => {
  const html = affiliationFields({ kind: 'schedule', personalOnly: true, value: { categoryId: null } }, personalStore)
  assert.match(html, /나의 스페이스/, 'my space is used even while a team space is selected')
  assert.equal(optionsOf(html, '스페이스'), null)
  assert.equal(optionsOf(html, '담당자'), null)
  assert.deepEqual(optionsOf(html, '프로젝트'), ['프로젝트 없음', '건강 루틴'], 'only projects of my space')
  assert.match(html, /일정은 나의 스페이스에 내 일정으로 만들어요\. 팀과 함께 볼 일은 작업으로 만들어 주세요\./)
  // The same fields for a task still offer every space and the assignee.
  const task = affiliationFields({ kind: 'task', value: { categoryId: null } }, personalStore)
  assert.deepEqual(optionsOf(task, '스페이스'), ['스페이스 선택', '나의 스페이스 · 본인 전용', '핀잇 개선', '주말 러닝 모임'])
  assert.notEqual(optionsOf(task, '담당자'), null)
  assert.doesNotMatch(task, /내 일정으로 만들어요|맡길 수 없어요|맡길 수는 없어요/)
})
test('an existing team schedule can stay or come to my space, never go to another team space', () => {
  const mine = affiliationFields(
    { kind: 'schedule', personalOnly: true, creating: false, fromSpaceId: 31, value: { spaceId: 31, categoryId: 88, assigneeId: 7 } },
    personalStore,
  )
  assert.deepEqual(optionsOf(mine, '스페이스'), ['스페이스 선택', '나의 스페이스 · 본인 전용', '핀잇 개선'])
  assert.equal(optionsOf(mine, '담당자'), null, 'what I hold cannot be handed to someone else')
  // In my own space there is nowhere else to go.
  const personal = affiliationFields(
    { kind: 'schedule', personalOnly: true, creating: false, fromSpaceId: -7, value: { spaceId: -7, categoryId: 5, assigneeId: 7 } },
    personalStore,
  )
  assert.equal(optionsOf(personal, '스페이스'), null)
  assert.match(mine, /이 일정은 팀 스페이스에 있어요\. 나의 스페이스로 가져올 수 있고, 다른 팀 스페이스로 보내거나 다른 사람에게 맡길 수는 없어요\./)
  assert.match(personal, /일정은 팀 스페이스로 보내거나 다른 사람에게 맡길 수 없어요/)
  assert.doesNotMatch(mine, /참여자 3명이 이 일정을 함께 봐요/, 'a schedule is personal: nothing says the team sees it')
})
test('the schedule form never offers who works on a schedule: it stays with whoever registered it', () => {
  // 서버 초안에는 그 스페이스의 참여자 셋이 모두 들어 있다. 그래도 일정 폼에는 담당자 칸이 없다.
  const draft = {
    spaceId: 31,
    defaultAssignee: { memberId: 7, nickname: '나' },
    members: [{ memberId: 7, nickname: '나' }, { memberId: 9, nickname: '준호' }, { memberId: 11, nickname: '서연' }],
    allowedActions: {},
  }
  const editing = (assigneeId) =>
    affiliationFields(
      { kind: 'schedule', personalOnly: true, creating: false, fromSpaceId: 31, value: { spaceId: 31, categoryId: null, assigneeId } },
      personalStore,
      draft,
    )
  for (const assigneeId of [9, null, 7])
    assert.equal(optionsOf(editing(assigneeId), '담당자'), null, `no assignee choice when the task is held by ${assigneeId}`)
  const creating = affiliationFields({ kind: 'schedule', personalOnly: true, value: { categoryId: null } }, personalStore, { ...draft, spaceId: -7 })
  assert.equal(optionsOf(creating, '담당자'), null)
  // The task form keeps every participant.
  const task = affiliationFields({ kind: 'task', creating: false, fromSpaceId: 31, value: { spaceId: 31, categoryId: null, assigneeId: 9 } }, personalStore, draft)
  assert.deepEqual(optionsOf(task, '담당자'), ['담당자 미정', '나 · 나', '준호', '서연'])
})
test('a schedule tied to a task cannot be moved from the schedule form: its place follows the task', () => {
  const linked = affiliationFields(
    { kind: 'schedule', personalOnly: true, creating: false, fromSpaceId: 31, hasLinkedItem: true, value: { spaceId: 31, categoryId: 88, assigneeId: 7 } },
    personalStore,
  )
  assert.equal(optionsOf(linked, '스페이스'), null, 'moving it would move the team task with it')
  assert.equal(optionsOf(linked, '프로젝트'), null, 'so would re-filing it under another project')
  assert.match(linked, /작업에 연결된 일정이에요\. 스페이스와 프로젝트는 작업의 것이라 작업에서 바꿔 주세요\./)
  // 연결되지 않은 일정은 프로젝트를 그대로 고른다. 작업 폼도 그대로다.
  const free = affiliationFields(
    { kind: 'schedule', personalOnly: true, creating: false, fromSpaceId: 31, value: { spaceId: 31, categoryId: 88, assigneeId: 7 } },
    personalStore,
  )
  assert.deepEqual(optionsOf(free, '프로젝트'), ['프로젝트 없음', '작업 카드 개선'])
  const task = affiliationFields({ kind: 'task', creating: false, fromSpaceId: 31, hasLinkedItem: true, value: { spaceId: 31, categoryId: 88, assigneeId: 7 } }, personalStore)
  assert.notEqual(optionsOf(task, '스페이스'), null)
  assert.notEqual(optionsOf(task, '프로젝트'), null)
})
test('the help under an unassigned item speaks of the right thing', () => {
  const schedule = affiliationFields(
    { kind: 'schedule', personalOnly: true, creating: false, fromSpaceId: -7, value: { spaceId: -7, categoryId: null, assigneeId: null } },
    personalStore,
  )
  assert.match(schedule, /담당자가 없는 일정은 오늘 화면의 일정에 나오지 않아요\./)
  assert.doesNotMatch(schedule, /내가 맡으면/, 'the form offers no way to take it')
  assert.doesNotMatch(schedule, /담당자 미정 작업은/)
  const task = affiliationFields({ kind: 'task', creating: false, fromSpaceId: 31, value: { spaceId: 31, categoryId: null, assigneeId: null } }, personalStore)
  assert.match(task, /담당자 미정 작업은 스페이스 목록에 남고 오늘의 내 작업에서는 제외돼요\./)
})
test('the schedule form help says what applies to the schedule being edited', () => {
  const { personalScheduleHelp, affiliationImpact } = load('features/spaces/affiliationImpact.ts')
  const help = (input) => personalScheduleHelp({ creating: false, linked: false, inTeamSpace: false, ...input })
  assert.match(help({ creating: true, linked: true, inTeamSpace: true }), /나의 스페이스에 내 일정으로 만들어요/)
  assert.match(help({ linked: true, inTeamSpace: true }), /스페이스와 프로젝트는 작업의 것이라 작업에서 바꿔 주세요/)
  assert.match(help({ inTeamSpace: true }), /나의 스페이스로 가져올 수 있고/)
  assert.match(help({}), /팀 스페이스로 보내거나 다른 사람에게 맡길 수 없어요/)
  // 팀 스페이스에 남아 있는 일정에도 "참여자가 함께 본다"는 줄은 없다. 작업에는 그대로 있다.
  const staying = { creating: false, fromSpaceId: 44, to: impactTo, assignee: null, destinationMemberIds: null, hasLinkedItem: false, dependencyCount: 0 }
  assert.deepEqual(plain(affiliationImpact({ ...staying, kind: 'schedule' })), [])
  assert.deepEqual(plain(affiliationImpact({ ...staying, kind: 'task' }).map((line) => line.kind)), ['share'])
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

// ---------------------------------------------------------------------------
// Sidebar project list: completed projects fold away
// ---------------------------------------------------------------------------

const sidebarProjects = (projects, selectedProjectId = null) =>
  renderToStaticMarkup(
    React.createElement(
      load('features/spaces/SpaceChrome.tsx', {
        react: React,
        'react/jsx-runtime': jsxRuntime,
        'react-dom': { createPortal: (node) => node },
        'react-router-dom': {
          Link: ({ children }) => React.createElement('a', null, children),
          useNavigate: () => () => {},
          useLocation: () => ({ pathname: '/app/tasks' }),
        },
        '@shared/components/common/Modal': { default: () => null },
        '@shared/components/common/WorkspaceIcon': { default: () => null },
        '@shared/hooks/useMediaQuery': { default: () => false },
        '@shared/motion': { usePresence: () => ({ mounted: false, closing: false }) },
        './store': {
          useSpaces: () => ({
            projects,
            selectedSpaceId: 31,
            selectedProjectId,
            selectProject() {},
          }),
        },
        './ProjectHead': { default: () => null },
        './SpaceMark': { default: () => null },
        './scope': load('features/spaces/scope.ts'),
        './pageSpace': { usePageSpace: () => null },
        './spaces.css': {},
      }).SpaceProjectsNav,
    ),
  )
const sidebarFixture = [
  { id: 1, spaceId: 31, name: '작업 카드 개선', completed: false },
  { id: 2, spaceId: 31, name: '10월 릴리즈', completed: true },
  { id: 3, spaceId: 31, name: '온보딩 안내 정리', completed: false },
  { id: 4, spaceId: 31, name: '9월 릴리즈', completed: true },
  { id: 5, spaceId: 31, name: '지운 완료 프로젝트', completed: true, deleted: true },
  { id: 6, spaceId: 44, name: '다른 스페이스의 완료 프로젝트', completed: true },
]

test('the sidebar folds completed projects under a closed count line', () => {
  const html = sidebarProjects(sidebarFixture)
  const [open, folded] = html.split('<details')
  assert.ok(folded, 'completed projects sit in a fold')
  assert.match(open, /작업 카드 개선/)
  assert.match(open, /온보딩 안내 정리/)
  assert.doesNotMatch(open, /릴리즈/, 'no completed project stays in the open list')
  assert.match(folded, /<summary>.*완료한 프로젝트 2개.*<\/summary>/, 'counts live projects of this space only')
  assert.match(folded, /10월 릴리즈/)
  assert.match(folded, /9월 릴리즈/)
  assert.doesNotMatch(html, /지운 완료 프로젝트|다른 스페이스/)
  assert.doesNotMatch(html, /<details[^>]* open/, 'the fold starts closed')
  assert.doesNotMatch(html, /<small>완료<\/small>/, 'the fold already says they are completed')
  assert.ok(html.indexOf('</details>') < html.indexOf('프로젝트 관리'), 'the manage link stays last')
})

test('the sidebar shows no fold when nothing is completed', () => {
  const html = sidebarProjects(sidebarFixture.filter((project) => !project.completed))
  assert.doesNotMatch(html, /<details|완료한 프로젝트/)
  assert.match(html, /작업 카드 개선/)
})

test('the sidebar fold opens while the selected project is a completed one', () => {
  const html = sidebarProjects(sidebarFixture, 4)
  assert.match(html, /<details[^>]* open/)
  assert.match(html, /aria-pressed="true"[^>]*><span>9월 릴리즈/)
  assert.doesNotMatch(sidebarProjects(sidebarFixture, 1), /<details[^>]* open/)
})
