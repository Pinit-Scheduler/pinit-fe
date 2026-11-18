import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import React from 'react'
import * as jsxRuntime from 'react/jsx-runtime'
import { renderToStaticMarkup } from 'react-dom/server'

const loadModule = (relativePath, dependencies = {}) => {
  const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    fileName: relativePath,
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

const map = loadModule('../src/features/task-split/utils/splitMapLayout.ts')

const mp = (key, stage, before = []) => ({ key, title: key, shownMinutes: 60, over: false, stage, dueDate: '2026-11-20', before, problem: false })
const five = [mp('a', 0), mp('b', 0), mp('c', 1, ['a', 'b']), mp('d', 2, ['c']), mp('e', 3, ['d'])]
const at = (layout, key) => layout.nodes.find((node) => node.piece.key === key)

test('넓은 화면은 왼쪽에서 오른쪽으로 놓고 적은 단계는 가운데로 모은다', () => {
  const layout = map.layoutSplitMap(five, { mobile: false, room: 1000 })
  assert.equal(layout.width, 184)
  assert.equal(layout.height, 92)
  assert.equal(JSON.stringify([at(layout, 'a').x, at(layout, 'a').y]), '[16,16]')
  assert.equal(JSON.stringify([at(layout, 'b').x, at(layout, 'b').y]), '[16,120]')
  assert.equal(JSON.stringify([at(layout, 'c').x, at(layout, 'c').y]), '[244,68]')
  assert.equal(at(layout, 'e').x, 700)
  assert.equal(layout.worldWidth, 900)
  assert.equal(layout.worldHeight, 228)
  assert.equal(layout.edges.find((edge) => edge.key === 'a:c').d, 'M200,62 C222,62 222,114 242,114')
  assert.equal(layout.edges.length, 4)
})

test('좁아지면 최소 폭까지만 줄이고 그 아래로는 옆으로 민다', () => {
  const layout = map.layoutSplitMap(five, { mobile: false, room: 700 })
  assert.equal(layout.width, 148)
  assert.equal(layout.worldWidth, 708)
  assert.ok(layout.worldWidth > 700)
})

test('좁은 화면은 위에서 아래로 놓는다', () => {
  const layout = map.layoutSplitMap(five, { mobile: true, room: 358 })
  assert.equal(layout.width, 150)
  assert.equal(JSON.stringify([at(layout, 'b').x, at(layout, 'b').y]), '[178,16]')
  assert.equal(JSON.stringify([at(layout, 'c').x, at(layout, 'c').y]), '[97,138]')
  assert.equal(layout.worldWidth, 344)
  assert.equal(layout.worldHeight, 490)
  const three = map.layoutSplitMap([mp('a', 0), mp('b', 0), mp('c', 0)], { mobile: true, room: 358 })
  assert.equal(three.width, 120)
  assert.equal(three.worldWidth, 416)
})

test('너비를 아직 모르면 기본 크기로 놓고, 지도에 없는 조각으로 가는 선은 그리지 않는다', () => {
  assert.equal(map.layoutSplitMap(five, { mobile: false, room: 0 }).width, 184)
  assert.equal(map.layoutSplitMap([mp('b', 0, ['ghost'])], { mobile: false, room: 500 }).edges.length, 0)
})

test('조각 50개도 배치가 끝난다', () => {
  const many = Array.from({ length: 50 }, (_, i) => mp(`p${i}`, Math.floor(i / 5), i >= 5 ? [`p${i - 5}`] : []))
  const layout = map.layoutSplitMap(many, { mobile: true, room: 358 })
  assert.equal(layout.nodes.length, 50)
  assert.equal(layout.width, 120)
})

test('마감이 없는 조각은 지도에 빈 날짜를 그리지 않는다', () => {
  const isoDuration = loadModule('../src/shared/utils/isoDuration.ts')
  const SplitMap = loadModule('../src/features/task-split/components/SplitMap.tsx', {
    react: React,
    'react/jsx-runtime': jsxRuntime,
    '@shared/components/common/WorkspaceIcon': { __esModule: true, default: () => null },
    '@shared/hooks/useMediaQuery': { __esModule: true, default: () => false },
    '@shared/utils/isoDuration': isoDuration,
    '../utils/splitMapLayout': map,
    '../utils/splitProposalLabels': { emptyText: () => '' },
  }).default
  const html = renderToStaticMarkup(React.createElement(SplitMap, {
    pieces: [mp('a', 0), { ...mp('b', 0), dueDate: null }],
    emptyReason: null, activeKey: null, busy: false, formatDay: () => '11/20', onActivate() {}, onRemove() {},
  }))
  assert.equal((html.match(/<time[ >]/g) ?? []).length, 1)
  assert.match(html, /<time dateTime="2026-11-20">11\/20<\/time>/)
})
