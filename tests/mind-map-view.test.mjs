import assert from 'node:assert/strict'
import test from 'node:test'
import { loadModules } from './support/mocks.mjs'

const load = loadModules()
const view = load('src/features/mind-map/model/viewport.ts')
const home = load('src/features/mind-map/model/homeCard.ts')
const plain = (value) => JSON.parse(JSON.stringify(value))
const r2 = (v) => ({ x: Math.round(v.x * 100) / 100, y: Math.round(v.y * 100) / 100, k: Math.round(v.k * 100) / 100 })
const n = (id, children = [], extra = {}) => ({ id, text: id, collapsed: false, check: 'NONE', children, ...extra })

test('확대는 25~200%이고 누른 점을 고정한다', () => {
  assert.deepEqual(plain(r2(view.zoomAt({ x: 0, y: 0, k: 1 }, 100, 100, 1.2))), { x: -20, y: -20, k: 1.2 })
  assert.equal(view.zoomAt({ x: 0, y: 0, k: 1.9 }, 0, 0, 1.2).k, 2)
  assert.equal(view.zoomAt({ x: 0, y: 0, k: 0.3 }, 0, 0, 0.5).k, 0.25)
  assert.equal(view.wheelFactor(0), 1)
})
test('배율: PC 100%, 폰 85%; 카드 90%, 80%', () => {
  assert.deepEqual([view.pageScale(1280), view.pageScale(899), home.cardScale(900), home.cardScale(390)], [1, 0.85, 0.9, 0.8])
})
test('들어올 때 고른 가지를 가운데에', () => {
  assert.deepEqual(plain(r2(view.centerOn({ x: 100, y: 50, w: 100, h: 20 }, { w: 1000, h: 700 }, 1))), { x: 350, y: 274, k: 1 })
})
test('전체 보기', () => {
  assert.deepEqual(plain(r2(view.fitView({ x0: 0, y0: 0, w: 384, h: 94 }, { w: 1000, h: 700 }))), { x: 308, y: 287, k: 1 })
  assert.equal(view.fitView({ x0: 0, y0: 0, w: 20000, h: 94 }, { w: 1000, h: 700 }).k, 0.25)
})
test('가지가 가장자리 밖이면 안으로 옮긴다', () => {
  assert.deepEqual(plain(r2(view.keepVisible({ x: 0, y: 0, k: 1 }, { x: 990, y: 650, w: 100, h: 20 }, { w: 1000, h: 700 }))), { x: -118, y: -70, k: 1 })
  assert.deepEqual(plain(r2(view.keepVisible({ x: 0, y: 0, k: 1 }, { x: -50, y: 10, w: 100, h: 20 }, { w: 1000, h: 700 }))), { x: 70, y: 50, k: 1 })
  const inside = { x: 5, y: 7, k: 1 }
  assert.deepEqual(plain(view.keepVisible(inside, { x: 300, y: 300, w: 100, h: 20 }, { w: 1000, h: 700 })), inside)
})
test('카드: 다 들어가면 맵 전체를 가운데에', () => {
  assert.deepEqual(plain(r2(home.cardView({ x0: 0, y0: 0, w: 384, h: 94 }, { x: 0, y: 27, w: 80, h: 40 }, { w: 405, h: 220 }, 0.9))), { x: 29.7, y: 67.7, k: 0.9 })
})
test('카드: 크면 고른 가지를 가운데에, 맵 가장자리에서 멈춘다', () => {
  const big = { x0: 0, y0: 0, w: 2000, h: 1000 }, frame = { w: 405, h: 220 }
  assert.deepEqual(plain(r2(home.cardView(big, { x: 1000, y: 500, w: 100, h: 20 }, frame, 0.9))), { x: -742.5, y: -349, k: 0.9 })
  assert.deepEqual(plain(r2(home.cardView(big, { x: 10, y: 10, w: 100, h: 20 }, frame, 0.9))), { x: 16, y: 16, k: 0.9 })
  assert.deepEqual(plain(r2(home.cardView(big, { x: 1900, y: 980, w: 100, h: 20 }, frame, 0.9))), { x: -1411, y: -696, k: 0.9 })
})
test('카드 제목과 기준 가지', () => {
  const m = n('r', [n('a', [n('a1')], { collapsed: true })])
  assert.equal(home.cardFocus(m, 'a1'), 'a')
  assert.equal(home.cardFocus(m, 'gone'), 'r')
  assert.equal(home.cardTitle(m, 'a1'), 'a 주변')
  assert.equal(home.cardTitle({ ...m, text: '' }, 'gone'), '주제 주변')
})
test('확대 단추는 캔버스 가운데를 기준으로 1.2배씩', () => {
  const frame = { w: 1000, h: 700 }
  const twice = view.zoomStep(view.zoomStep({ x: 0, y: 0, k: 1 }, frame, 1), frame, 1)
  assert.equal(Math.round(twice.k * 100), 144)
  assert.deepEqual(plain(r2(view.zoomStep({ x: 0, y: 0, k: 1.2 }, frame, -1))), { x: 83.33, y: 58.33, k: 1 })
})
test('두 손가락: 시작 배율에 거리 비율을 곱하고 가운데를 고정한다', () => {
  const pinch = { k: 1, distance: 100 }
  assert.deepEqual(plain(r2(view.pinchView({ x: 0, y: 0, k: 1 }, pinch, 150, 100, 100))), { x: -50, y: -50, k: 1.5 })
  assert.equal(view.pinchView({ x: 0, y: 0, k: 1.5 }, pinch, 1000, 0, 0).k, 2)
  assert.equal(view.pinchView({ x: 0, y: 0, k: 1 }, pinch, 1, 0, 0).k, 0.25)
})
test('사이에 끼울 자리의 선: 위는 top-5, 아래는 bottom+2, 폭은 56 이상', () => {
  const target = { left: 40, top: 100, bottom: 124, width: 30 }
  assert.deepEqual(plain(view.insertLine(target, 'before')), { left: 40, top: 95, width: 56 })
  assert.deepEqual(plain(view.insertLine({ ...target, width: 120 }, 'after')), { left: 40, top: 126, width: 120 })
})
