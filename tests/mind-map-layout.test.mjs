import assert from 'node:assert/strict'
import test from 'node:test'
import { loadModules } from './support/mocks.mjs'

const load = loadModules()
const layout = load('src/features/mind-map/model/layout.ts')
const plain = (value) => JSON.parse(JSON.stringify(value))
const n = (id, children = [], extra = {}) => ({
  id,
  text: id,
  collapsed: false,
  check: 'NONE',
  children,
  ...extra,
})
const sizes = (entries) => new Map(Object.entries(entries).map(([id, [w, h]]) => [id, { w, h }]))
const map = n('r', [n('a', [n('a1'), n('a2')]), n('b')])
const s = sizes({ r: [80, 40], a: [100, 20], a1: [100, 20], a2: [100, 20], b: [100, 20] })

test('논리구조도 배치', () => {
  const out = layout.layoutMap(map, s)
  const box = (id) => plain(out.boxes.get(id))
  assert.deepEqual(box('r'), { x: 0, y: 27, w: 80, h: 40 })
  assert.deepEqual(box('a'), { x: 132, y: 14, w: 100, h: 20 })
  assert.deepEqual(box('a1'), { x: 284, y: 0, w: 100, h: 20 })
  assert.deepEqual(box('a2'), { x: 284, y: 28, w: 100, h: 20 })
  assert.deepEqual(box('b'), { x: 132, y: 74, w: 100, h: 20 })
  assert.deepEqual(plain(out.bounds), { x0: 0, y0: 0, w: 384, h: 94 })
})
test('둥근 꺾은선', () => {
  const d = Object.fromEntries(layout.layoutMap(map, s).edges.map((e) => [e.toId, e.d]))
  assert.equal(d.a, 'M80,47H104V34Q104,24 114,24H132')
  assert.equal(d.b, 'M80,47H104V74Q104,84 114,84H132')
  assert.equal(d.a1, 'M232,24H256V17Q256,10 263,10H284')
})
test('높이가 같으면 곧은 선', () => {
  const out = layout.layoutMap(n('r', [n('a')]), sizes({ r: [80, 40], a: [100, 40] }))
  assert.equal(out.edges[0].d, 'M80,20H104H132')
})
test('접힌 가지는 짧은 선만 있고 아래를 그리지 않는다', () => {
  const folded = n('r', [n('a', [n('a1')], { collapsed: true })])
  const out = layout.layoutMap(folded, sizes({ r: [80, 40], a: [100, 20] }))
  assert.equal(out.boxes.has('a1'), false)
  assert.deepEqual(plain(out.edges.find((e) => e.toId === null)), { fromId: 'a', toId: null, d: 'M232,20H247', color: 0 })
})
test('색은 주제 바로 아래 순서로 다섯 가지를 돌리고 아래는 물려받는다', () => {
  const wide = n('r', ['p', 'q', 's', 't', 'u', 'v'].map((id) => n(id, id === 'v' ? [n('v1')] : [])))
  const color = Object.fromEntries(layout.visibleNodes(wide).map((v) => [v.id, v.color]))
  assert.deepEqual([color.r, color.p, color.u, color.v, color.v1], [null, 0, 4, 0, 0])
})
test('보이는 가지의 차례와 형제 정보', () => {
  assert.deepEqual(plain(layout.visibleNodes(map).map((v) => [v.id, v.depth, v.index, v.siblings])), [
    ['r', 0, 1, 1], ['a', 1, 1, 2], ['a1', 2, 1, 2], ['a2', 2, 2, 2], ['b', 1, 2, 2],
  ])
})

test('그린 경계는 선 굵기와 접힌 가지의 짧은 선·숫자 단추를 더한다', () => {
  const half = layout.LAYOUT.STROKE / 2
  assert.deepEqual(plain(layout.drawnBounds(layout.layoutMap(map, s))), {
    x0: -half, y0: -half, w: 384 + 2 * half, h: 94 + 2 * half,
  })
  const folded = layout.layoutMap(n('r', [n('a', [n('a1')], { collapsed: true }), n('b')]), s)
  // a의 오른쪽 232에 짧은 선 15px와 숫자 단추 18px가 붙는다. 레이아웃 경계는 상자만이다.
  assert.equal(folded.bounds.w, 232)
  assert.equal(layout.drawnBounds(folded).w, 232 + 15 + 18 + 2 * half)
})
