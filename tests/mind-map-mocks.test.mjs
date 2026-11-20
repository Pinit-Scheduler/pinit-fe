import assert from 'node:assert/strict'
import test from 'node:test'
import { setup } from './support/mocks.mjs'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const CONFLICT = '다른 곳에서 마인드맵이 먼저 바뀌었어요. 최신 내용을 불러온 뒤 다시 고쳐 주세요.'
const uuid = (i) => `6d6d00ff-0000-4000-8000-${String(i).padStart(12, '0')}`
const node = (id, text = '가지', children = [], check = 'NONE') => ({ id, text, collapsed: false, check, children })
const count = (n) => n.children.reduce((sum, child) => sum + count(child), 1)

const start = () => {
  const { api, load } = setup()
  const mm = load('src/mocks/mindMap.ts')
  const read = async (as = 1) => (await api('/v2/mind-map', 'GET', undefined, { as })).body
  const save = (body, as = 1) => api('/v2/mind-map', 'PUT', body, { as })
  /** 회원 1의 맵에서 주제 아래 가지를 바꿔 version 3으로 보낸다. */
  const saveChildren = async (children, extra = {}) => {
    const { root } = await read()
    return save({ expectedVersion: 3, saveId: uuid(1), root: { ...root, children }, ...extra })
  }
  const chain = (length, rootId) => {
    let leaf = node(uuid(length))
    for (let i = length - 1; i >= 1; i--) leaf = node(uuid(i), '가지', [leaf])
    return node(rootId, '내 계획', [leaf])
  }
  return { api, mm, read, save, saveChildren, chain }
}

test('demo의 맵은 예시 나무와 기억한 가지를 준다', async () => {
  const { api, mm } = start()
  const { status, body } = await api('/v2/mind-map')
  assert.equal(status, 200)
  assert.equal(body.version, 3)
  assert.equal(body.root.text, '내 계획')
  assert.equal(body.root.check, 'NONE')
  assert.equal(count(body.root) - 1, 27)
  const all = (n) => [n, ...n.children.flatMap(all)]
  const nodes = all(body.root)
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const { ids } = mm.mockMindMapFixture
  assert.equal(nodes.filter((n) => n.children.length === 0).length, 17)
  assert.deepEqual(nodes.filter((n) => n.check !== 'NONE').map((n) => [n.text, n.check]), [
    ['버릴 것 고르기', 'DONE'], ['박스와 테이프 사기', 'OPEN'], ['방마다 포장하기', 'OPEN'], ['건강검진 예약하기', 'DONE'],
  ])
  assert.deepEqual(nodes.filter((n) => n.collapsed).map((n) => n.id), [ids.place])
  assert.deepEqual(Object.fromEntries(Object.entries(ids).map(([key, id]) => [key, byId.get(id)?.text])), {
    moving: '이사 준비', house: '새 집 구하기', packing: '짐 정리', toss: '버릴 것 고르기', boxes: '박스와 테이프 사기',
    rooms: '방마다 포장하기', workshop: '팀 워크숍', place: '장소', health: '건강', checkup: '건강검진 예약하기',
  })
  assert.equal(body.root.id, mm.mockMindMapRootId(1))
  assert.equal(ids.moving, '6d6d0001-0000-4000-8000-000000000001')
  assert.equal(body.cursorNodeId, mm.mockMindMapFixture.ids.packing)
  assert.deepEqual(body.limits, { maxBranches: 500, maxTextLength: 100, maxDepth: 32 })
})

test('저장한 적 없는 회원은 주제 하나, version 0, 기억한 가지는 주제', async () => {
  const { read } = start()
  const other = await read(2)
  const demo = await read(1)
  assert.equal(other.version, 0)
  assert.deepEqual(other.root.children, [])
  assert.equal(other.cursorNodeId, other.root.id)
  assert.notEqual(other.root.id, demo.root.id)
  assert.match(other.root.id, UUID)
})

test('처음 저장은 version 1', async () => {
  const { read, save } = start()
  const { root } = await read(2)
  const { status, body } = await save({ expectedVersion: 0, saveId: uuid(1), root }, 2)
  assert.equal(status, 200)
  assert.deepEqual(body, { version: 1 })
})

test('같은 saveId로 다시 보내면 409에 그 번호', async () => {
  const { read, save } = start()
  const { root } = await read()
  const request = { expectedVersion: 3, saveId: uuid(1), root }
  assert.deepEqual(await save(request), { status: 200, body: { version: 4 } })
  assert.deepEqual(await save(request), {
    status: 409,
    body: { code: 'VERSION_CONFLICT', message: CONFLICT, latestVersion: 4, lastSaveId: uuid(1) },
  })
})

test('충돌이 규칙 위반보다 먼저다', async () => {
  const { saveChildren } = start()
  const { status, body } = await saveChildren([node(uuid(5), '')], { expectedVersion: 2 })
  assert.equal(status, 409)
  assert.equal(body.code, 'VERSION_CONFLICT')
})

test('규칙 위반은 가지 id와 규칙 이름을 싣는다', async () => {
  const { saveChildren } = start()
  const { status, body } = await saveChildren([node(uuid(5), ' '), node(uuid(6)), node(uuid(6))])
  assert.equal(status, 400)
  assert.deepEqual(body.errors.map((e) => e.rejectedValue), ['TEXT_EMPTY', 'ID_DUPLICATE'])
  assert.equal(body.errors[0].field, uuid(5))
  assert.equal(body.errors[1].field, uuid(6))
  assert.equal(body.message, body.errors[0].reason)
  assert.equal(body.path, 'uri=/v2/mind-map')
})

test('주제의 체크, 다른 주제 id, 대문자 id, 101자', async () => {
  const { read, save, saveChildren, mm } = start()
  const { root } = await read()
  const rule = async (response) => {
    const { status, body } = await response
    assert.equal(status, 400)
    return body.errors.map((e) => e.rejectedValue)
  }
  assert.deepEqual(await rule(save({ expectedVersion: 3, saveId: uuid(1), root: { ...root, check: 'OPEN' } })), ['ROOT_CHECKED'])
  assert.deepEqual(await rule(save({ expectedVersion: 3, saveId: uuid(1), root: { ...root, id: mm.mockMindMapRootId(2) } })), ['ROOT_ID_CHANGED'])
  assert.deepEqual(await rule(saveChildren([node(uuid(5).toUpperCase())])), ['ID_FORMAT'])
  assert.deepEqual(await rule(saveChildren([node(uuid(5), '가'.repeat(101))])), ['TEXT_TOO_LONG'])
  const emoji = await saveChildren([node(uuid(5), '😀'.repeat(100))])
  assert.equal(emoji.status, 200)
})

test('가지 수와 깊이는 그 위반 하나만', async () => {
  const { read, save, chain } = start()
  const { root } = await read()
  const wide = (n) => ({ ...root, children: Array.from({ length: n - 1 }, (_, i) => node(uuid(i + 1), i === 0 ? '' : '가지')) })
  const tooMany = await save({ expectedVersion: 3, saveId: uuid(900), root: wide(501) })
  assert.equal(tooMany.status, 400)
  assert.deepEqual(tooMany.body.errors.map((e) => [e.field, e.rejectedValue]), [[root.id, 'TOO_MANY_BRANCHES']])
  const full = { ...wide(500), children: wide(500).children.map((child) => ({ ...child, text: '가지' })) }
  assert.equal((await save({ expectedVersion: 3, saveId: uuid(901), root: full })).status, 200)
  const tooDeep = await save({ expectedVersion: 4, saveId: uuid(902), root: chain(33, root.id) })
  assert.equal(tooDeep.status, 400)
  assert.deepEqual(tooDeep.body.errors.map((e) => [e.field, e.rejectedValue]), [[root.id, 'TOO_DEEP']])
  assert.equal((await save({ expectedVersion: 4, saveId: uuid(903), root: chain(32, root.id) })).status, 200)
})

test('모양 오류는 경로를 싣는다', async () => {
  const { read, save } = start()
  const { root } = await read()
  root.children[0].check = 'MAYBE'
  const shape = await save({ expectedVersion: 3, saveId: uuid(1), root })
  assert.equal(shape.status, 400)
  assert.equal(shape.body.errors[0].field, 'root.children[0].check')
  assert.equal(shape.body.errors[0].rejectedValue, 'MAYBE')
  root.children[0].check = 'NONE'
  const missing = await save({ expectedVersion: 3, root })
  assert.equal(missing.status, 400)
  assert.equal(missing.body.errors[0].field, 'saveId')
})

test('글을 정리해 저장한다', async () => {
  const { read, saveChildren } = start()
  assert.equal((await saveChildren([node(uuid(5), '  짐  정리 ')])).status, 200)
  assert.equal((await read()).root.children[0].text, '짐 정리')
})

test('기억한 가지 저장은 version을 올리지 않고 없는 id도 받는다', async () => {
  const { api, read } = start()
  assert.equal((await api('/v2/mind-map/cursor', 'PUT', { nodeId: uuid(9) })).status, 204)
  const after = await read()
  assert.equal(after.version, 3)
  assert.equal(after.cursorNodeId, after.root.id)
  const bad = await api('/v2/mind-map/cursor', 'PUT', { nodeId: 'ABC' })
  assert.equal(bad.status, 400)
  assert.equal(bad.body.errors[0].field, 'nodeId')
  assert.equal((await api('/v2/mind-map/cursor', 'PUT', { nodeId: uuid(9) }, { as: 2 })).status, 204)
  assert.equal((await read(2)).version, 0)
})

test('응답을 잃은 저장은 반영되고 503으로 답한다', async () => {
  const { read, save, mm } = start()
  const { root } = await read()
  mm.mockMindMapControls.failNextSave('lost')
  assert.equal((await save({ expectedVersion: 3, saveId: uuid(2), root })).status, 503)
  assert.equal((await read()).version, 4)
  const retry = await save({ expectedVersion: 3, saveId: uuid(3), root })
  assert.equal(retry.status, 409)
  assert.equal(retry.body.lastSaveId, uuid(2))
})

test('서버 오류는 반영하지 않는다', async () => {
  const { read, save, mm } = start()
  const { root } = await read()
  mm.mockMindMapControls.failNextSave('server')
  assert.equal((await save({ expectedVersion: 3, saveId: uuid(2), root })).status, 500)
  assert.equal((await read()).version, 3)
})

test('다른 기기의 변경은 저장 번호를 비운다', async () => {
  const { read, save, mm } = start()
  const { root } = await read()
  assert.equal(mm.mockMindMapControls.remoteEdit(), 4)
  assert.equal((await read()).root.children[0].text, '이사 준비 (다른 기기)')
  const response = await save({ expectedVersion: 3, saveId: uuid(2), root })
  assert.equal(response.status, 409)
  assert.equal(response.body.lastSaveId, null)
})

test('불러오기 실패는 한 번만', async () => {
  const { api, mm } = start()
  mm.mockMindMapControls.failNextLoad(true)
  const failed = await api('/v2/mind-map')
  assert.equal(failed.status, 500)
  assert.equal(failed.body.message, '마인드맵을 불러오지 못했어요.')
  assert.equal((await api('/v2/mind-map')).status, 200)
})
