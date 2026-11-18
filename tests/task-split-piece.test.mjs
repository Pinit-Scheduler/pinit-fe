import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import React from 'react'
import * as jsxRuntime from 'react/jsx-runtime'
import { renderToStaticMarkup } from 'react-dom/server'

const load = (path, dependencies = {}) => {
  const source = readFileSync(new URL('../src/' + path, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    fileName: path,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
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

const stub = { __esModule: true, default: () => null }
const isoDuration = load('shared/utils/isoDuration.ts')
const labels = load('features/task-split/utils/splitProposalLabels.ts', { '@shared/utils/isoDuration': isoDuration })
const common = {
  react: React,
  'react/jsx-runtime': jsxRuntime,
  '@shared/components/common/WorkspaceIcon': stub,
  '@shared/components/common/TermHelp': stub,
  '@shared/utils/isoDuration': isoDuration,
  '@constants/difficulty': load('constants/difficulty.ts'),
  '../utils/splitProposalLabels': labels,
  './CycleHelp': stub,
}
const PieceSummary = load('features/task-split/components/PieceSummary.tsx', common)
const PieceView = load('features/task-split/components/PieceView.tsx', { ...common, './PieceSummary': PieceSummary }).default
const PieceForm = load('features/task-split/components/PieceForm.tsx', common).default
const html = (Component, props) => renderToStaticMarkup(React.createElement(Component, props))

const limits = { titleMax: 20, descriptionMax: 2000, minutesMin: 5, minutesMax: 1440, dueMin: '2026-11-17', dueMax: '2026-11-25' }
const piece = { key: 'c', title: '개편안 스케치 3종', description: '목적\n세 안을 그린다', minutes: 150, difficulty: 8, dueDate: '2026-11-20', after: ['a', 'x'], selected: true }
const info = (over = {}) => ({ key: 'c', shownMinutes: 195, over: false, stage: 1, before: ['a', 'b'], errors: [], warnings: [], orderChoices: [
  { key: 'a', title: '현재 온보딩 흐름 정리', link: 'DIRECT', blocked: false },
  { key: 'b', title: '이탈 구간 데이터 뽑기', link: 'VIA_EXCLUDED', blocked: false },
  { key: 'd', title: '팀 리뷰 받기', link: 'NONE', blocked: true },
  { key: 'e', title: '최종안 문서화', link: 'NONE', blocked: false },
], ...over })
const view = (over, props = {}) => html(PieceView, { piece, info: info(over), titleOf: (key) => `조각 ${key}`, formatDay: () => '11/20', busy: false, ...props })
const form = (over, props = {}) => html(PieceForm, { piece, info: info(over), limits, errors: [], busy: false, ...props })

test('읽기 단계는 서버가 준 값만 보인다', () => {
  const read = view({})
  assert.match(read, /3시간 15분/)
  assert.match(read, /입력 2시간 30분/)
  assert.match(read, /난이도 8/)
  assert.match(read, /11\/20 마감/)
  assert.match(read, /이전 조각: 조각 a, 조각 b/)
  assert.match(read, /빼기.*고치기/s)
  assert.doesNotMatch(read, /4시간 이상이에요/)
  const over = view({ over: true, shownMinutes: 300, warnings: [{ kind: 'OVERLAPS_OPEN_TASK', evidenceTaskId: 1, evidenceTitle: '온보딩 문구 다듬기' }] })
  assert.match(over, /4시간 이상이에요\. 그대로 만들 수 있지만/)
  assert.match(over, /&quot;온보딩 문구 다듬기&quot; 작업과 겹칠 수 있어요\./)
  assert.equal((view({}, { busy: true }).match(/disabled=""/g) ?? []).length, 2)
})

test('이전 조각 체크박스는 직접 간선만 고칠 수 있다', () => {
  const edit = form({})
  const box = (title) => edit.match(new RegExp(`<label[^>]*><input[^>]*>${title}`))[0]
  assert.match(box('현재 온보딩 흐름 정리'), /checked=""/)
  assert.doesNotMatch(box('현재 온보딩 흐름 정리'), /disabled/)
  assert.match(box('이탈 구간 데이터 뽑기'), /checked=""/)
  assert.match(box('이탈 구간 데이터 뽑기'), /disabled=""/)
  assert.match(edit, /뺀 조각을 거쳐 이어져 있어요/)
  assert.doesNotMatch(box('팀 리뷰 받기'), /checked/)
  assert.match(box('팀 리뷰 받기'), /disabled=""/)
  assert.match(edit, /순환이 생겨요/)
  assert.doesNotMatch(box('최종안 문서화'), /checked|disabled/)
})

test('입력 한도는 서버가 준 값이고 화면은 스스로 막지 않는다', () => {
  const edit = form({})
  assert.match(edit, /<form[^>]*novalidate=""/i)
  assert.match(edit, /maxLength="20"/i)
  assert.match(edit, /min="2026-11-17"[^>]*max="2026-11-25"|max="2026-11-25"[^>]*min="2026-11-17"/)
  assert.match(edit, /2,000/)
})

test('서버가 준 오류는 그 칸 아래에, 모르는 칸의 오류는 맨 위에 보인다', () => {
  const edit = form({}, { errors: [
    { field: 'dueDate', message: '원본 마감(11/25)보다 늦을 수 없어요.' },
    { field: 'importance', message: '중요도를 확인해 주세요.' },
  ] })
  assert.match(edit, /원본 마감\(11\/25\)보다 늦을 수 없어요\./)
  assert.ok(edit.indexOf('중요도를 확인해 주세요.') < edit.indexOf('제목'))
  assert.match(form({}, { busy: true }), /확인하는 중…/)
})
