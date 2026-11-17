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

const unavailable = load('../src/features/spaces/unavailable.ts')
const labels = load('../src/features/task-split/utils/splitLabels.ts', { '@features/spaces/unavailable': unavailable })
const entries = load('../src/features/task-split/utils/splitEntry.ts', { '@features/spaces/unavailable': unavailable })
const shared = {
  'react/jsx-runtime': jsxRuntime,
  '@shared/components/common/WorkspaceIcon': { default: () => null },
  '@features/spaces/UnavailableNote': { default: ({ text }) => text },
  '../utils/splitLabels': labels,
  '../utils/splitEntry': entries,
}
const component = (name) => load(`../src/features/task-split/components/${name}.tsx`, shared).default
const SplitChip = component('SplitChip')
const SplitLockNotice = component('SplitLockNotice')
const SplitLockActions = component('SplitLockActions')
const SplitOffer = component('SplitOffer')
const noop = () => {}
const html = (Component, props) =>
  renderToStaticMarkup(
    React.createElement(Component, { onPress: noop, onOpen: noop, onCancel: noop, onDiscard: noop, onStart: noop, ...props }),
  )

const mine = (over) => ({ stage: 'PROCESSING', mine: true, requestId: 9, requestStatus: 'QUEUED', requesterNickname: null, ...over })
const other = { stage: 'PROPOSAL_READY', mine: false, requestId: null, requestStatus: null, requesterNickname: '김서연' }
test('카드 표시는 두 단계이고 다른 참여자의 잠금은 누를 수 없다', () => {
  assert.match(html(SplitChip, { entry: { kind: 'lock', lock: mine() } }), /<button[^>]*class="split-chip"[^>]*>쪼개는 중<\/button>/)
  assert.match(html(SplitChip, { entry: { kind: 'lock', lock: mine({ stage: 'PROPOSAL_READY', requestStatus: 'READY' }) } }), /data-status="READY"[^>]*>쪼개기 제안 준비됨/)
  const locked = html(SplitChip, { entry: { kind: 'lock', lock: other } })
  assert.doesNotMatch(locked, /<button/)
  assert.match(locked, /title="김서연님이 쪼개기 제안을 받았어요\."/)
  assert.match(html(SplitChip, { entry: { kind: 'offer', recommended: true, enabled: true, blockedReasons: [] } }), /4시간 이상 · 쪼개기/)
  assert.equal(html(SplitChip, { entry: { kind: 'offer', recommended: true, enabled: false, blockedReasons: ['ADMIN_ONLY'] } }), '')
  assert.equal(html(SplitChip, { entry: { kind: 'none' } }), '')
})
test('잠긴 원본의 안내와 버튼은 지금 할 수 있는 것만이다', () => {
  assert.match(html(SplitLockNotice, { lock: mine() }), /<strong>쪼개는 중이에요<\/strong>준비되면 알려 드릴게요\./)
  assert.match(html(SplitLockActions, { lock: mine(), proposalScreen: true }), />요청 취소</)
  const ready = mine({ stage: 'PROPOSAL_READY', requestStatus: 'READY' })
  assert.match(html(SplitLockActions, { lock: ready, proposalScreen: true }), /제안 보기.*제안 버리기/s)
  assert.doesNotMatch(html(SplitLockActions, { lock: ready, proposalScreen: false }), /제안 보기/)
  assert.equal(html(SplitLockActions, { lock: other, proposalScreen: true }), '')
})
test('쪼개기 버튼은 맡길 수 없으면 꺼지고 이유가 붙는다', () => {
  const on = html(SplitOffer, { entry: { kind: 'offer', recommended: true, enabled: true, blockedReasons: [] }, admins: [] })
  assert.match(on, /쪼개기<\/button>/)
  assert.match(on, /예상 시간이 4시간 이상이에요\./)
  assert.doesNotMatch(on, /disabled/)
  const off = html(SplitOffer, { entry: { kind: 'offer', recommended: false, enabled: false, blockedReasons: ['HAS_LINKED_SCHEDULE'] }, admins: [] })
  assert.match(off, /disabled/)
  assert.match(off, /일정에 넣은 작업은 쪼갤 수 없어요\./)
  assert.doesNotMatch(off, /4시간 이상/)
  assert.equal(html(SplitOffer, { entry: { kind: 'none' }, admins: [] }), '')
})
