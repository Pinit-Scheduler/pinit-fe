import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import React from 'react'
import * as jsxRuntime from 'react/jsx-runtime'
import { renderToStaticMarkup } from 'react-dom/server'
import { requireFrom } from './support/errors.mjs'

const load = (path, dependencies = {}) => {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    fileName: path,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  })
  const module = { exports: {} }
  vm.runInNewContext(outputText, { module, exports: module.exports, require: requireFrom(dependencies) })
  return module.exports
}

const labels = load('../src/features/task-split/utils/splitLabels.ts')
const paths = load('../src/features/task-split/utils/splitPaths.ts')
const SplitInboxRow = load('../src/features/task-split/components/SplitInboxRow.tsx', {
  'react/jsx-runtime': jsxRuntime,
  '../utils/splitLabels': labels,
}).default
const noop = () => {}
const html = (Component, props) =>
  renderToStaticMarkup(React.createElement(Component, { onOpen: noop, onCancel: noop, onDiscard: noop, ...props }))

const base = { requestId: 1, taskId: 7, spaceId: -1, originalTitle: '온보딩 개편 설계', status: 'READY', failureReason: null,
  requestedAt: '2026-11-17T00:00:00Z', readyAt: '2026-11-17T00:05:00Z', expiresAt: '2026-11-24T00:05:00Z',
  pieceCount: 5, excludedCount: 2, violationRemaining: false, canApply: true, cannotApplyReason: null }
const row = (item, proposalScreen = true) => html(SplitInboxRow, { item: { ...base, ...item }, now: Date.parse('2026-11-17T00:03:00Z'), formatDay: () => '11/24', proposalScreen })
test('준비됨 줄', () => {
  const ready = row({})
  assert.match(ready, /data-status="READY"/)
  assert.match(ready, /준비됨/)
  assert.match(ready, /조각 5개 · 뺀 조각 2개 · 11\/24까지 보관/)
  assert.match(ready, /제안 보기.*버리기/s)
  assert.doesNotMatch(row({}, false), /제안 보기/)
})
test('쪼개는 중 줄은 취소만, 실패 줄은 버리기만', () => {
  const running = row({ status: 'RUNNING' })
  assert.match(running, /쪼개는 중/)
  assert.match(running, /3분 전 요청/)
  assert.match(running, />취소</)
  assert.doesNotMatch(running, /버리기/)
  const failed = row({ status: 'FAILED', failureReason: 'PROCESSING_TIMEOUT' })
  assert.match(failed, /처리 시간이 너무 오래 걸렸어요\. 횟수는 돌려 드렸어요\./)
  assert.match(failed, />버리기</)
  assert.doesNotMatch(failed, /취소|제안 보기/)
})
test('제목이 지워진 요청도 줄이 깨지지 않는다', () => {
  assert.match(row({ originalTitle: null }), /<strong[^>]*>작업<\/strong>/)
})
test('대기 중 줄도 돌아가는 표시와 취소를 보인다', () => {
  const queued = row({ status: 'QUEUED' })
  assert.match(queued, /<span class="split-spinner" aria-hidden="true"><\/span>쪼개는 중/)
  assert.match(queued, />취소</)
  assert.doesNotMatch(row({}), /split-spinner/)
})

const SplitInboxLink = (summary) =>
  load('../src/features/task-split/components/SplitInboxLink.tsx', {
    'react/jsx-runtime': jsxRuntime,
    'react-router-dom': { Link: ({ to, children, ...rest }) => React.createElement('a', { href: to, ...rest }, children) },
    '@shared/components/common/WorkspaceIcon': { default: () => null },
    '../hooks/useSplitSummary': { useSplitSummary: () => ({ summary, refetch: noop }) },
    '../utils/splitPaths': paths,
  }).default
const summary = (over) => ({ available: true, consent: { currentVersion: '1', consented: true, provider: 'p' },
  quota: { limit: 5, used: 1, remaining: 4, resetsAt: '2026-11-18T00:00:00Z' }, archiveCount: 0, ...over })
test('보관함 입구는 쓸 수 있거나 보관함에 무언가 있을 때만 보인다', () => {
  assert.equal(html(SplitInboxLink(null)), '')
  assert.equal(html(SplitInboxLink(summary({ available: false }))), '')
  const empty = html(SplitInboxLink(summary({})))
  assert.match(empty, /<a href="\/app\/tasks\/splits" class="workspace-button split-inbox-link">쪼개기 보관함<\/a>/)
  assert.match(html(SplitInboxLink(summary({ available: false, archiveCount: 3 }))), /쪼개기 보관함<span class="split-inbox-link__count">3<\/span>/)
})

const SplitInboxEmpty = () =>
  load('../src/features/task-split/components/SplitInboxEmpty.tsx', {
    'react/jsx-runtime': jsxRuntime,
    'react-router-dom': { Link: ({ to, children, ...rest }) => React.createElement('a', { href: to, ...rest }, children) },
  }).default
test('빈 보관함은 쪼개기를 쓸 수 있을 때만 "쪼개기"를 누르라고 한다', () => {
  const on = html(SplitInboxEmpty(), { startable: true })
  assert.match(on, /보관함이 비어 있어요\./)
  assert.match(on, /4시간이 넘는 큰 작업을 열고 &quot;쪼개기&quot;를 눌러 보세요\./)
  assert.match(on, /<a href="\/app\/tasks" class="workspace-button">작업 목록으로<\/a>/)
  const off = html(SplitInboxEmpty(), { startable: false })
  assert.match(off, /보관함이 비어 있어요\./)
  assert.doesNotMatch(off, /쪼개기/)
  assert.match(off, /작업 목록으로/)
})
test('취소·버리기가 진행 중인 줄은 그 버튼을 끈다', () => {
  const busy = html(SplitInboxRow, { item: { ...base, status: 'RUNNING' }, now: 0, formatDay: () => '', proposalScreen: true, busy: true })
  assert.match(busy, /<button type="button" class="workspace-button" disabled="">취소<\/button>/)
  const ready = html(SplitInboxRow, { item: base, now: 0, formatDay: () => '', proposalScreen: true, busy: true })
  assert.match(ready, /<button type="button" class="workspace-button" disabled="">버리기<\/button>/)
  assert.doesNotMatch(row({}), /disabled/)
})
