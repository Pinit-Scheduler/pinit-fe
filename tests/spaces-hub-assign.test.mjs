import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import React from 'react'
import * as jsxRuntime from 'react/jsx-runtime'
import { renderToStaticMarkup } from 'react-dom/server'
import { requireFrom } from './support/errors.mjs'

const plain = (value) => JSON.parse(JSON.stringify(value))
function load(path, dependencies = {}) {
  const source = readFileSync(new URL('../src/' + path, import.meta.url), 'utf8')
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
    setTimeout,
    clearTimeout,
    console: { error() {} },
    require: requireFrom(dependencies),
  })
  return module.exports
}

const duration = { '@shared/utils/isoDuration': { parseIsoDurationMinutes: () => 0 } }
const hub = () => load('features/spaces/hub.ts', duration)
class ApiError extends Error {
  constructor(message, status, data = null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.data = data
  }
}
const httpClient = { ApiError }
const conflicts = () => load('features/spaces/conflicts.ts', { '@shared/api/httpClient': httpClient })
const assignModule = () =>
  load('features/spaces/hub/assign.ts', {
    '@shared/api/httpClient': httpClient,
    '../conflicts': conflicts(),
    '../hub': hub(),
  })

function taskApi(response) {
  const calls = []
  const api = load('features/tasks/api/tasks.ts', {
    '@shared/api/config': { buildApiUrl: (path) => 'https://api.fixture/v2' + path },
    '@shared/api/httpClient': {
      httpClient: async (url, options = {}) => {
        calls.push({ url, ...options })
        return response
      },
    },
    '@shared/utils/datetime': { toApiDateTimeWithZone: (date) => date },
    '@features/spaces/store': {
      getSelectedScope: () => ({ spaceId: 44, projectId: 13 }),
    },
    '@features/spaces/metadata': load('features/spaces/metadata.ts'),
  })
  return { api, calls }
}

const view = (id, extra = {}) => ({
  task: {
    id,
    title: '작업 ' + id,
    description: '설명',
    completed: false,
    dueDate: { date: '2026-11-20', zoneId: 'Asia/Seoul' },
  },
  spaceId: 31,
  projectId: 88,
  assigneeId: null,
  assigneeNickname: null,
  version: 3,
  allowedActions: { assign: true },
  ...extra,
})

test('the unassigned list asks the server for the space open tasks with no assignee, ignoring the selected project', async () => {
  const { api, calls } = taskApi({ content: [view(5)], last: true })
  const page = await api.fetchUnassignedTasks({ spaceId: 31, page: 1, size: 50 })
  const url = new URL(calls[0].url)
  assert.equal(url.pathname, '/v2/workspace/tasks')
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    spaceId: '31',
    status: 'OPEN',
    unassigned: 'true',
    sort: 'DEADLINE_ASC',
    page: '1',
    size: '50',
  })
  assert.equal(page.content[0].id, 5)
  assert.equal(page.content[0].assigneeId, null)
})

test('assigning sends only the version and the assignee', async () => {
  const { api, calls } = taskApi(view(5, { assigneeId: 2, version: 4 }))
  const task = await api.assignTask(5, 2, 3)
  assert.equal(calls[0].url, 'https://api.fixture/v2/workspace/tasks/5')
  assert.equal(calls[0].method, 'PATCH')
  assert.deepEqual(plain(calls[0].json), { expectedVersion: 3, assignee: { memberId: 2 } })
  assert.equal(task.assigneeId, 2)
})

test('dialog rows name the project and due date and follow the server permission', () => {
  const { assignRows } = assignModule()
  const rows = assignRows(
    [
      { id: 1, title: '디자인 검토', projectId: 88, dueDate: { date: '2026-11-20', zoneId: 'UTC' }, version: 3, allowedActions: { assign: true } },
      { id: 2, title: '프로젝트 없음', projectId: null, dueDate: { date: '2026-12-01', zoneId: 'UTC' }, version: 0 },
      { id: 3, title: '막힘', projectId: 99, dueDate: null, version: 1, allowedActions: { assign: false }, unavailableReasons: { assign: 'SPACE_DELETED' } },
    ],
    [{ id: 88, name: '핀잇 개선' }],
  )
  assert.deepEqual(plain(rows), [
    { id: 1, title: '디자인 검토', detail: '핀잇 개선, 11/20 마감', version: 3, canAssign: true },
    { id: 2, title: '프로젝트 없음', detail: '12/1 마감', version: 0, canAssign: true },
    { id: 3, title: '막힘', detail: '', version: 1, canAssign: false, reason: 'SPACE_DELETED' },
  ])
})

test('assignee choices put me first as 나 and keep the member order', () => {
  const { assigneeOptions } = assignModule()
  assert.deepEqual(
    plain(
      assigneeOptions(
        [
          { memberId: 2, nickname: '민지' },
          { memberId: 7, nickname: '가입 닉네임' },
          { memberId: 3, nickname: '도윤' },
        ],
        7,
      ),
    ),
    [
      { value: 7, label: '나' },
      { value: 2, label: '민지' },
      { value: 3, label: '도윤' },
    ],
  )
})

test('more pages start at the first unseen server row and never repeat one', () => {
  const { mergeTasks, nextAssignPage, offsetAfter, ASSIGN_PAGE_SIZE } = assignModule()
  assert.equal(ASSIGN_PAGE_SIZE, 50)
  const first = { number: 0, size: 50, content: new Array(50) }
  assert.equal(offsetAfter(first), 50)
  assert.equal(nextAssignPage(offsetAfter(first)), 1)
  // 그중 3개를 배정하면 서버 목록이 3칸 당겨져 안 본 첫 작업은 첫 쪽 끝에 있다.
  assert.equal(nextAssignPage(offsetAfter(first) - 3), 0)
  // 두 번째 쪽까지 받은 뒤 위치.
  assert.equal(offsetAfter({ number: 1, size: 50, content: new Array(5) }), 55)
  assert.equal(offsetAfter({ content: [1, 2] }), 2, 'no paging fields: the rows received')
  assert.equal(nextAssignPage(-1), 0)
  const merged = mergeTasks([{ id: 1 }, { id: 2 }], [{ id: 2 }, { id: 3 }])
  assert.deepEqual(plain(merged.map((task) => task.id)), [1, 2, 3])
})

test('a choice for a member who has left falls back to the first option', () => {
  const { chosenAssignee } = assignModule()
  const options = [{ value: 7 }, { value: 2 }]
  assert.equal(chosenAssignee(2, options), 2)
  assert.equal(chosenAssignee(3, options), 7)
  assert.equal(chosenAssignee(undefined, options), 7)
  assert.equal(chosenAssignee(undefined, []), undefined)
})

const space = (actions = {}) => ({
  id: 31,
  name: '핀잇 개선',
  personal: false,
  members: [
    { memberId: 7, nickname: '나', role: 'ADMIN' },
    { memberId: 2, nickname: '민지', role: 'MEMBER' },
  ],
  allowedActions: { invite: true, manageMembers: true, assign: true, ...actions },
})
// Static renders see the first list as the baseline: every row present, nothing animating.
const motionStub = {
  useListPresence: (items, getKey) =>
    (items ?? []).map((item) => ({ key: String(getKey(item)), item, phase: 'present' })),
  presenceProps: () => ({}),
}
const HubPeople = () =>
  load('features/spaces/hub/HubPeople.tsx', {
    'react/jsx-runtime': jsxRuntime,
    '@shared/motion': motionStub,
    '@shared/components/motion/TweenedNumber': { default: ({ value }) => String(value) },
    '../UnavailableNote': load('features/spaces/UnavailableNote.tsx', {
      'react/jsx-runtime': jsxRuntime,
      './spaces.css': {},
    }),
    '../hub': hub(),
    '../unavailable': load('features/spaces/unavailable.ts'),
    './RowMenu': { default: () => null },
  }).default
const people = (props) =>
  renderToStaticMarkup(
    React.createElement(HubPeople(), {
      space: space(),
      rows: [],
      failed: false,
      onRetry() {},
      busy: false,
      onInvite() {},
      onToggleAdmin() {},
      onRemove() {},
      onAssign() {},
      ...props,
    }),
  )

test('the unassigned row offers 배정하기 only when tasks wait, and the server can turn it off', () => {
  const html = people({ unassigned: { openCount: 3, nearestDueDate: '2026-11-20' } })
  assert.match(html, /담당자 미정/)
  assert.match(html, /3개/)
  assert.match(html, /<button[^>]*aria-haspopup="dialog"[^>]*>배정하기<\/button>/)
  assert.doesNotMatch(people({ unassigned: { openCount: 0, nearestDueDate: null } }), /배정하기/)
  assert.match(people({ unassigned: { openCount: 0, nearestDueDate: null } }), /모든 작업에 담당자가 있어요/)
  const off = people({
    space: { ...space({ assign: false }), unavailableReasons: { assign: 'SPACE_DELETED' } },
    unassigned: { openCount: 1, nearestDueDate: null },
  })
  assert.match(off, /<button[^>]*disabled=""[^>]*>배정하기/)
  assert.match(off, /휴지통에 있는 스페이스라 할 수 없어요/)
})

test('the dialog title is the summary count, not a count of the list, and the exit reaches the modal', () => {
  const Dialog = load('features/spaces/hub/AssignUnassignedDialog.tsx', {
    react: React,
    'react/jsx-runtime': jsxRuntime,
    '@shared/components/common/Modal': {
      default: ({ children, closing }) =>
        React.createElement('div', { role: 'dialog', 'data-closing': String(closing) }, children),
    },
    '@shared/motion': motionStub,
    '@features/tasks/api/tasks': {
      fetchUnassignedTasks: () => new Promise(() => {}),
      assignTask: () => new Promise(() => {}),
    },
    '../UnavailableNote': { default: ({ text }) => React.createElement('p', null, text) },
    '../unavailable': load('features/spaces/unavailable.ts'),
    './assign': assignModule(),
  }).default
  const render = (openCount, closing) =>
    renderToStaticMarkup(
      React.createElement(Dialog, {
        space: space(),
        meId: 7,
        projects: [],
        openCount,
        onClose() {},
        onAssigned() {},
        onStale() {},
        closing,
      }),
    )
  assert.match(render(4), /<h2 id="hub-assign-title">담당자 미정 작업 4개<\/h2>/)
  assert.match(render(null), /<h2 id="hub-assign-title">담당자 미정 작업<\/h2>/)
  assert.match(render(4), /맡을 사람을 고르고 배정하세요/)
  assert.match(render(4), /불러오는 중/)
  assert.match(render(4), /data-closing="false"/)
  assert.match(render(4, true), /data-closing="true"/)
})

const row = (id, extra = {}) => ({ id, title: '작업 ' + id, assigneeId: null, version: 1, ...extra })
const page = (ids, { number = 0, last = true } = {}) => ({
  content: ids.map((id) => row(id)),
  number,
  size: 50,
  last,
})
const range = (from, count) => Array.from({ length: count }, (_, i) => from + i)

test('flow: load, assign, the row leaves and the server position moves back by one', () => {
  const { assignReducer, initialAssignState, shouldLoadMore, outOfSync } = assignModule()
  let state = assignReducer(initialAssignState, { type: 'load' })
  assert.equal(state.loading, true)
  assert.equal(state.loaded, false)
  state = assignReducer(state, { type: 'loaded', replace: true, response: page([1, 2, 3]) })
  assert.deepEqual(plain(state.tasks.map((task) => task.id)), [1, 2, 3])
  assert.equal(state.offset, 3)
  assert.equal(state.loaded, true)
  state = assignReducer(state, { type: 'assigning', id: 2 })
  assert.equal(state.busyId, 2)
  assert.equal(shouldLoadMore(state), false)
  state = assignReducer(state, { type: 'assigned', id: 2 })
  assert.deepEqual(plain(state.tasks.map((task) => task.id)), [1, 3])
  assert.equal(state.offset, 2)
  assert.equal(state.busyId, null)
  assert.equal(outOfSync(state, 2), false)
})

test('flow: after assigning every shown row the next page loads instead of saying nothing is left', () => {
  const { assignReducer, initialAssignState, shouldLoadMore, outOfSync, nextAssignPage } = assignModule()
  let state = assignReducer(initialAssignState, { type: 'loaded', replace: true, response: page(range(1, 50), { last: false }) })
  for (const id of range(1, 50)) {
    state = assignReducer(state, { type: 'assigning', id })
    state = assignReducer(state, { type: 'assigned', id })
  }
  assert.equal(state.tasks.length, 0)
  assert.equal(state.hasMore, true)
  assert.equal(shouldLoadMore(state), true)
  assert.equal(outOfSync(state, 5), false)
  // 50개가 빠졌으니 남은 5개는 서버의 첫 쪽에 있다.
  assert.equal(nextAssignPage(state.offset), 0)
  state = assignReducer(state, { type: 'load' })
  assert.equal(shouldLoadMore(state), false, 'no second request while one is running')
  state = assignReducer(state, { type: 'loaded', replace: false, response: page(range(51, 5)) })
  assert.equal(state.tasks.length, 5)
  assert.equal(state.hasMore, false)
})

test('flow: an empty list while the summary still counts tasks asks for a fresh summary', () => {
  const { assignReducer, initialAssignState, outOfSync } = assignModule()
  assert.equal(outOfSync(initialAssignState, 3), false, 'not before the first answer')
  const empty = assignReducer(initialAssignState, { type: 'loaded', replace: true, response: page([]) })
  assert.equal(outOfSync(empty, 3), true)
  assert.equal(outOfSync(empty, 0), false)
  assert.equal(outOfSync(empty, null), false)
  assert.equal(outOfSync(assignReducer(empty, { type: 'loadFailed', message: '작업을 불러오지 못했어요.' }), 3), false)
})

test('flow: a version conflict on assign keeps the row, says it was reloaded and reloads the list from the top', () => {
  const { assignReducer, initialAssignState, assignFailure } = assignModule()
  const { CONFLICT_RELOADED } = conflicts()
  let state = assignReducer(initialAssignState, { type: 'loaded', replace: true, response: page([1, 2]) })
  state = assignReducer(state, { type: 'assigning', id: 1 })
  const conflict = new ApiError('버전이 맞지 않아요.', 409, { code: 'VERSION_CONFLICT' })
  const failure = assignFailure(conflict, '작업 1')
  assert.deepEqual(plain(failure), { notice: '작업 1: ' + CONFLICT_RELOADED, reload: true })
  state = assignReducer(state, { type: 'assignFailed', notice: failure.notice })
  assert.equal(state.busyId, null)
  assert.deepEqual(plain(state.tasks.map((task) => task.id)), [1, 2], 'the row stays until the reload answers')
  // reload means load(0, true): the fresh first page replaces the list and the notice stays.
  state = assignReducer(state, { type: 'load' })
  state = assignReducer(state, { type: 'loaded', replace: true, response: page([2, 3]) })
  assert.deepEqual(plain(state.tasks.map((task) => task.id)), [2, 3])
  assert.equal(state.offset, 2)
  assert.equal(state.notice, '작업 1: ' + CONFLICT_RELOADED)
  state = assignReducer(state, { type: 'assigning', id: 2 })
  assert.equal(state.notice, null, 'a new attempt clears the old message')
})

test('other assign failures show the server message and reload only when the task changed or left', () => {
  const { assignFailure } = assignModule()
  assert.deepEqual(plain(assignFailure(new ApiError('이미 완료된 작업이에요.', 409, { code: 'TASK_COMPLETED' }), '작업 1')), {
    notice: '작업 1: 이미 완료된 작업이에요.',
    reload: true,
  })
  assert.deepEqual(plain(assignFailure(new ApiError('작업을 찾을 수 없어요.', 404), '작업 1')), {
    notice: '작업 1: 작업을 찾을 수 없어요.',
    reload: true,
  })
  assert.deepEqual(plain(assignFailure(new ApiError('', 500), '작업 1')), {
    notice: '작업 1: 배정하지 못했어요. 잠시 후 다시 시도해 주세요.',
    reload: false,
  })
  assert.deepEqual(plain(assignFailure(new TypeError('Failed to fetch'), '작업 1')), {
    notice: '작업 1: 배정하지 못했어요. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.',
    reload: false,
  })
})
