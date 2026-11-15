import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import React from 'react'
import * as jsxRuntime from 'react/jsx-runtime'
import { renderToStaticMarkup } from 'react-dom/server'
import { findElement, hookRuntime } from './support/app.mjs'
import { apiError, requireFrom } from './support/errors.mjs'

function load(path, dependencies = {}, globals = {}) {
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
    require: requireFrom(dependencies),
    ...globals,
  })
  return module.exports
}

const counts = (completed, running, open, unassigned) => ({
  total: completed + running + open + unassigned,
  completed,
  running,
  open,
  unassigned,
})
const hub = load('features/spaces/hub.ts', {
  '@shared/utils/isoDuration': { parseIsoDurationMinutes: () => 0 },
})
const unavailable = load('features/spaces/unavailable.ts')
const TaskDots = load('features/spaces/hub/TaskDots.tsx', {
  'react/jsx-runtime': jsxRuntime,
  '../hub': hub,
}).default

const space = {
  id: 31,
  name: '제품팀',
  purpose: '11월 릴리즈까지 핵심 흐름을 다듬는다',
  members: [
    { memberId: 7, nickname: '김서연', role: 'ADMIN' },
    { memberId: 8, nickname: '박지훈', role: 'MEMBER' },
  ],
}
const project = (overrides = {}) => ({
  id: 88,
  spaceId: 31,
  name: '11월 릴리즈',
  outcome: '11월 28일 배포',
  completed: false,
  version: 4,
  allowedActions: { update: true },
  ...overrides,
})
const loaded = (row) => ({
  data: { projects: row ? [{ projectId: 88, ...row }] : [] },
  error: null,
  isLoading: false,
  reload() {},
})

/** ProjectHead with its data and writes replaced; the hub's own label and dot rules stay real. */
const loadHead = ({ react = React, jsx = jsxRuntime, summary, api = {}, calls = {} } = {}) =>
  load('features/spaces/ProjectHead.tsx', {
    react,
    'react/jsx-runtime': jsx,
    '@contexts/ToastContext': {
      useToast: () => ({ addToast: (...args) => (calls.toasts ??= []).push(args) }),
    },
    './api': api,
    './conflicts': {
      reportEditConflict: (failure) => {
        const conflict = failure?.status === 409
        if (conflict) calls.conflicts = (calls.conflicts ?? 0) + 1
        return conflict
      },
    },
    './hub': hub,
    './hub/TaskDots': { default: TaskDots },
    './hub/useHubData': {
      useSpaceSummary: (spaceId) => {
        calls.spaceId = spaceId
        return summary
      },
    },
    './store': { workspaceChanged: () => (calls.changed = (calls.changed ?? 0) + 1) },
    './unavailable': unavailable,
    './hub/hub.css': {},
    './ProjectHead.css': {},
  })

const head = (props, summary, calls = {}) =>
  renderToStaticMarkup(
    React.createElement(loadHead({ summary, calls }).default, { space, project: project(), ...props }),
  )

test('the project head leads with the outcome and shows the server counts under it', () => {
  const calls = {}
  const html = head({}, loaded({ counts: counts(1, 1, 2, 1), nearestDueDate: '2026-11-17' }), calls)
  assert.equal(calls.spaceId, 31, 'the numbers come from the summary of the project space')
  assert.match(html, /<strong>11월 릴리즈의 성과<\/strong>/)
  assert.match(html, /<p class="project-head__outcome">11월 28일 배포<\/p>/)
  assert.match(html, /<span>작업 5개 중 1개 완료, 진행 중 1개, 담당자 미정 1개<\/span>/)
  assert.match(html, /class="project-head__due">가장 이른 마감 11\/17</)
  assert.match(html, /class="hub-dots"/, 'the same dots as the hub row')
  assert.match(html, />성과 수정</)
  assert.doesNotMatch(html, /완료한 프로젝트/)
})

test('a completed project says so and keeps its outcome', () => {
  const html = head(
    { project: project({ completed: true }) },
    loaded({ counts: counts(3, 0, 0, 0), nearestDueDate: null }),
  )
  assert.match(html, /<span>완료한 프로젝트<\/span>/)
  assert.match(html, /11월 28일 배포/)
  assert.doesNotMatch(html, /가장 이른 마감/, 'no open task, no due date')
})

test('a project without an outcome invites writing one only where the server allows the edit', () => {
  const row = loaded({ counts: counts(0, 0, 1, 0), nearestDueDate: null })
  const open = head({ project: project({ outcome: null }) }, row)
  assert.match(open, /남을 성과를 아직 적지 않았어요\./)
  assert.match(open, />성과 적기</)
  assert.doesNotMatch(open, />성과 수정</)

  const locked = head(
    {
      project: project({
        outcome: null,
        allowedActions: { update: false },
        unavailableReasons: { update: 'ADMIN_ONLY' },
      }),
    },
    row,
  )
  assert.doesNotMatch(locked, /성과 적기/)
  assert.match(locked, /관리자 김서연님만 할 수 있어요\./, 'the reason is the one the server gave')

  const readOnly = head({ project: project({ allowedActions: { update: false } }) }, row)
  assert.doesNotMatch(readOnly, /성과 수정/)
})

test('the progress line never invents numbers: none yet, none at all, or the load failure as given', () => {
  const waiting = head({}, { data: null, error: null, isLoading: true, reload() {} })
  assert.match(waiting, /<span aria-hidden="true">–<\/span>/)
  assert.doesNotMatch(waiting, /작업 \d/)

  const missing = head({}, loaded(null))
  assert.match(missing, /<span aria-hidden="true">–<\/span>/, 'a project the summary does not list yet has no numbers')

  const empty = head({}, loaded({ counts: counts(0, 0, 0, 0), nearestDueDate: null }))
  assert.match(empty, /아직 이 프로젝트에 작업이 없어요\./)
  assert.doesNotMatch(empty, /hub-dots/)

  const failed = head(
    {},
    { data: null, error: '이 스페이스의 작업 수를 불러오지 못했어요.', isLoading: false, reload() {} },
  )
  assert.match(failed, /role="alert"[^>]*>이 스페이스의 작업 수를 불러오지 못했어요\. <button/)
  assert.match(failed, />다시 시도</)
})

// ---------------------------------------------------------------------------
// Writing the outcome in place
// ---------------------------------------------------------------------------

const element = (type, props, key) => ({ type, props, key: key ?? null })
const editor = (api, calls, close) => {
  const runtime = hookRuntime()
  const { OutcomeEditor } = loadHead({
    react: { ...runtime.react, useId: () => 'outcome-error', useLayoutEffect() {} },
    jsx: { jsx: element, jsxs: element },
    api,
    calls,
  })
  const render = () => runtime.render(OutcomeEditor, { project: project(), close })
  const find = (tree, type) => findElement(tree, (node) => node.type === type)
  return { render, find }
}

test('saving sends what was typed with the version it was read at, then refreshes the workspace', async () => {
  const calls = {}
  const sent = []
  let closed = 0
  const { render, find } = editor(
    { updateProject: async (...args) => sent.push(args) },
    calls,
    () => closed++,
  )
  find(render(), 'textarea').props.onChange({ target: { value: '11월 28일 배포와 릴리즈 노트' } })
  await find(render(), 'form').props.onSubmit({ preventDefault() {} })
  assert.deepEqual(JSON.parse(JSON.stringify(sent)), [
    [88, { outcome: '11월 28일 배포와 릴리즈 노트', expectedVersion: 4 }],
  ])
  assert.deepEqual(calls.toasts, [['저장했어요.', 'success']])
  assert.equal(calls.changed, 1)
  assert.equal(closed, 1)
})

test('an edit conflict closes the editor for the shared notice; any other failure keeps the text', async () => {
  const conflictCalls = {}
  let closed = 0
  const conflicted = editor(
    {
      updateProject: async () => {
        throw apiError('conflict', 409, { code: 'VERSION_CONFLICT' })
      },
    },
    conflictCalls,
    () => closed++,
  )
  await conflicted.find(conflicted.render(), 'form').props.onSubmit({ preventDefault() {} })
  assert.equal(conflictCalls.conflicts, 1)
  assert.equal(closed, 1)
  assert.equal(conflictCalls.changed, undefined, 'the conflict notice reloads, not this editor')
  assert.equal(conflictCalls.toasts, undefined)

  const failedCalls = {}
  const failed = editor(
    {
      updateProject: async () => {
        throw new Error('Failed to fetch')
      },
    },
    failedCalls,
    () => closed++,
  )
  failed.find(failed.render(), 'textarea').props.onChange({ target: { value: '지우면 안 되는 문장' } })
  await failed.find(failed.render(), 'form').props.onSubmit({ preventDefault() {} })
  const tree = failed.render()
  assert.equal(closed, 1, 'still open')
  assert.equal(failed.find(tree, 'textarea').props.value, '지우면 안 되는 문장')
  const alert = findElement(tree, (node) => node.props?.role === 'alert')
  assert.equal(
    String(alert.props.children),
    '성과를 저장하지 못했어요. 인터넷 연결을 확인한 뒤 다시 시도해 주세요. 입력한 내용은 유지돼요.',
  )
  assert.equal(failedCalls.changed, undefined)
})

// ---------------------------------------------------------------------------
// Where the head appears
// ---------------------------------------------------------------------------

const contextBar = (pathname, spaces) =>
  renderToStaticMarkup(
    React.createElement(
      load('features/spaces/SpaceChrome.tsx', {
        react: { Fragment: React.Fragment, useState: React.useState, useRef: React.useRef, useEffect: React.useEffect },
        'react/jsx-runtime': jsxRuntime,
        'react-dom': { createPortal: (node) => node },
        'react-router-dom': {
          Link: () => null,
          useNavigate: () => () => {},
          useLocation: () => ({ pathname }),
        },
        '@shared/components/common/Modal': { default: () => null },
        '@shared/components/common/WorkspaceIcon': { default: () => null },
        '@shared/hooks/useMediaQuery': { default: () => false },
        '@shared/motion': { usePresence: (value) => ({ mounted: Boolean(value), closing: false, value }) },
        './store': { useSpaces: () => spaces },
        './ProjectHead': {
          default: ({ space: shownSpace, project: shownProject }) =>
            React.createElement('i', { 'data-head': `${shownSpace.id}:${shownProject.id}` }),
        },
        './SpaceMark': { default: () => null },
        './scope': load('features/spaces/scope.ts'),
        './spaces.css': {},
      }).SpaceContextBar,
    ),
  )

test('choosing a project puts its head on top of every screen that shows the selected project', () => {
  const selected = { selectedSpace: space, selectedProject: project() }
  for (const path of ['/app/tasks', '/app/schedules', '/app/task-map', '/app/plan', '/app/settings/recurrences']) {
    const html = contextBar(path, selected)
    assert.match(html, /data-head="31:88"/, path)
    assert.ok(html.includes(space.purpose), 'the purpose stays above it')
    assert.ok(!html.includes('목적에 기여할 성과'), 'the outcome is no longer folded inside the purpose')
  }
  for (const path of ['/app/today', '/app/statistics', '/app/deadline-risk', '/app/settings/trash', '/app/spaces'])
    assert.doesNotMatch(contextBar(path, selected), /data-head/, path)
})

test('the head shows without a space purpose and never for a project of another space', () => {
  const personal = { ...space, purpose: null }
  assert.match(
    contextBar('/app/tasks', { selectedSpace: personal, selectedProject: project() }),
    /data-head="31:88"/,
    'a space without a purpose used to hide the outcome altogether',
  )
  assert.doesNotMatch(
    contextBar('/app/tasks', { selectedSpace: space, selectedProject: project({ spaceId: 99 }) }),
    /data-head/,
  )
  assert.doesNotMatch(contextBar('/app/tasks', { selectedSpace: space, selectedProject: null }), /data-head/)
})

test('the head and the hub read one summary key, so a number fetched by either is shared', () => {
  const keys = []
  const { useSpaceSummary } = load('features/spaces/hub/useHubData.ts', {
    '@shared/hooks/useRevalidatingQuery': {
      useRevalidatingQuery: (key, _fetcher, options) => {
        keys.push([key, options.group, [...options.invalidateOn]])
        return { data: undefined, error: null, isInitialLoading: key !== null, refetch() {} }
      },
    },
    '../api': {},
  })
  const summary = useSpaceSummary(31)
  assert.equal(summary.data, null)
  assert.equal(summary.isLoading, true)
  useSpaceSummary(null)
  assert.deepEqual(keys, [
    ['spaces/hub/summary:31', 'spaces/hub/', ['task', 'schedule']],
    [null, 'spaces/hub/', ['task', 'schedule']],
  ])
})
