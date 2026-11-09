import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import React from 'react'
import * as jsxRuntime from 'react/jsx-runtime'
import { renderToStaticMarkup } from 'react-dom/server'

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
    require: (name) => {
      assert.ok(name in dependencies, 'Unexpected dependency ' + name)
      return dependencies[name]
    },
  })
  return module.exports
}

const duration = { '@shared/utils/isoDuration': { parseIsoDurationMinutes: () => 0 } }
const hub = () => load('features/spaces/hub.ts', duration)
const assignModule = () =>
  load('features/spaces/hub/assign.ts', { '../hub': hub() })

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
  const page = await api.fetchUnassignedTasks({ spaceId: 31, page: 1 })
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

test('more pages start at the first unseen task and never repeat one', () => {
  const { mergeTasks, nextAssignPage, ASSIGN_PAGE_SIZE } = assignModule()
  assert.equal(ASSIGN_PAGE_SIZE, 50)
  assert.equal(nextAssignPage(50), 1)
  // 50개 중 3개를 배정하면 서버의 두 번째 쪽 앞 3개는 이미 보이는 작업이다. 첫 쪽부터 다시 받는다.
  assert.equal(nextAssignPage(47), 0)
  const merged = mergeTasks([{ id: 1 }, { id: 2 }], [{ id: 2 }, { id: 3 }])
  assert.deepEqual(plain(merged.map((task) => task.id)), [1, 2, 3])
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
const HubPeople = () =>
  load('features/spaces/hub/HubPeople.tsx', {
    'react/jsx-runtime': jsxRuntime,
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

test('the dialog title is the summary count, not a count of the list', () => {
  const Dialog = load('features/spaces/hub/AssignUnassignedDialog.tsx', {
    react: React,
    'react/jsx-runtime': jsxRuntime,
    '@shared/components/common/Modal': {
      default: ({ children }) => React.createElement('div', { role: 'dialog' }, children),
    },
    '@features/tasks/api/tasks': {
      fetchUnassignedTasks: () => new Promise(() => {}),
      assignTask: () => new Promise(() => {}),
    },
    '../UnavailableNote': { default: ({ text }) => React.createElement('p', null, text) },
    '../conflicts': { CONFLICT_RELOADED: '', isEditConflict: () => false },
    '../unavailable': load('features/spaces/unavailable.ts'),
    './assign': assignModule(),
  }).default
  const render = (openCount) =>
    renderToStaticMarkup(
      React.createElement(Dialog, {
        space: space(),
        meId: 7,
        projects: [],
        openCount,
        onClose() {},
        onAssigned() {},
      }),
    )
  assert.match(render(4), /<h2 id="hub-assign-title">담당자 미정 작업 4개<\/h2>/)
  assert.match(render(null), /<h2 id="hub-assign-title">담당자 미정 작업<\/h2>/)
  assert.match(render(4), /맡을 사람을 고르고 배정하세요/)
  assert.match(render(4), /불러오는 중/)
  const source = readFileSync(
    new URL('../src/features/spaces/hub/AssignUnassignedDialog.tsx', import.meta.url),
    'utf8',
  )
  assert.equal(/\.reduce\(|tasks\.length\}개|rows\.length\}개/.test(source), false)
})
