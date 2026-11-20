import assert from 'node:assert/strict'
import test from 'node:test'
import { setup, token } from './support/mocks.mjs'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
/** BE pinit-monolith `MindMapErrorMessages`·`RequestErrorMessages`의 문구 그대로. */
const CONFLICT = '다른 곳에서 마인드맵이 먼저 바뀌었어요. 최신 내용을 불러온 뒤 다시 고쳐 주세요.'
const REQUEST_SHAPE = '마인드맵의 내용을 읽지 못했어요. 화면을 새로고침한 뒤 다시 시도해 주세요.'
const UNREADABLE_BODY = '요청을 처리하지 못했어요. 화면을 새로고침한 뒤 다시 시도해 주세요.'
const UNREADABLE = '저장된 마인드맵을 읽지 못했어요. 잠시 후 다시 시도해 주세요.'
const UNEXPECTED = '일시적인 문제로 처리하지 못했어요. 잠시 후 다시 시도해 주세요.'
const WITHDRAWN = '탈퇴한 회원의 마인드맵은 쓸 수 없어요.'
const RULES = {
  ROOT_ID_CHANGED: '가장 위의 주제는 바꿀 수 없어요. 화면을 새로고침한 뒤 다시 시도해 주세요.',
  ROOT_CHECKED: '가장 위의 주제에는 체크박스를 달 수 없어요. 체크박스를 없애고 다시 시도해 주세요.',
  ID_FORMAT: '가지를 구별하는 값이 올바르지 않아요. 화면을 새로고침한 뒤 다시 시도해 주세요.',
  ID_DUPLICATE: '같은 가지가 두 번 들어 있어요. 화면을 새로고침한 뒤 다시 시도해 주세요.',
  TEXT_EMPTY: '가지의 글이 비어 있어요. 글을 적거나 가지를 지워 주세요.',
  TEXT_TOO_LONG: '가지의 글은 100자까지 적을 수 있어요. 글을 줄여 주세요.',
  TOO_MANY_BRANCHES: '가지는 주제를 포함해 500개까지 만들 수 있어요. 안 쓰는 가지를 지운 뒤 다시 시도해 주세요.',
  TOO_DEEP: '가지는 주제 아래로 32단계까지 이어 만들 수 있어요. 단계를 줄여 주세요.',
}
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
  /** 본문을 글 그대로 보낸다(깨진 JSON, 빈 본문). */
  const raw = async (path, text, as = 1) => {
    const response = await mm.handleMindMap(path, 'PUT', new Request(`http://localhost:8080${path}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token(as)}`, 'Content-Type': 'application/json' },
      body: text,
    }))
    return { status: response.status, body: await response.json() }
  }
  return { api, mm, read, save, saveChildren, chain, raw }
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
  assert.deepEqual(body.errors, [
    { field: uuid(5), rejectedValue: 'TEXT_EMPTY', reason: RULES.TEXT_EMPTY },
    { field: uuid(6), rejectedValue: 'ID_DUPLICATE', reason: RULES.ID_DUPLICATE },
  ])
  assert.equal(body.message, RULES.TEXT_EMPTY)
  assert.equal(body.status, 400)
  assert.equal(body.error, 'Bad Request')
  assert.equal(body.path, 'uri=/v2/mind-map')
})

test('주제의 체크, 다른 주제 id, 대문자 id, 101자는 BE 문구 그대로', async () => {
  const { read, save, saveChildren, mm } = start()
  const { root } = await read()
  const rule = async (response) => {
    const { status, body } = await response
    assert.equal(status, 400)
    return body.errors.map((e) => [e.rejectedValue, e.reason])
  }
  const pair = (name) => [name, RULES[name]]
  assert.deepEqual(await rule(save({ expectedVersion: 3, saveId: uuid(1), root: { ...root, check: 'OPEN' } })), [pair('ROOT_CHECKED')])
  assert.deepEqual(await rule(save({ expectedVersion: 3, saveId: uuid(1), root: { ...root, id: mm.mockMindMapRootId(2) } })), [pair('ROOT_ID_CHANGED')])
  assert.deepEqual(await rule(saveChildren([node(uuid(5).toUpperCase())])), [pair('ID_FORMAT')])
  assert.deepEqual(await rule(saveChildren([node(uuid(5), '가'.repeat(101))])), [pair('TEXT_TOO_LONG')])
  const emoji = await saveChildren([node(uuid(5), '😀'.repeat(100))])
  assert.equal(emoji.status, 200)
})

test('가지 수와 깊이는 그 위반 하나만', async () => {
  const { read, save, chain } = start()
  const { root } = await read()
  const wide = (n) => ({ ...root, children: Array.from({ length: n - 1 }, (_, i) => node(uuid(i + 1), i === 0 ? '' : '가지')) })
  const tooMany = await save({ expectedVersion: 3, saveId: uuid(900), root: wide(501) })
  assert.equal(tooMany.status, 400)
  assert.deepEqual(tooMany.body.errors, [{ field: root.id, rejectedValue: 'TOO_MANY_BRANCHES', reason: RULES.TOO_MANY_BRANCHES }])
  const full = { ...wide(500), children: wide(500).children.map((child) => ({ ...child, text: '가지' })) }
  assert.equal((await save({ expectedVersion: 3, saveId: uuid(901), root: full })).status, 200)
  const tooDeep = await save({ expectedVersion: 4, saveId: uuid(902), root: chain(33, root.id) })
  assert.equal(tooDeep.status, 400)
  assert.deepEqual(tooDeep.body.errors, [{ field: root.id, rejectedValue: 'TOO_DEEP', reason: RULES.TOO_DEEP }])
  assert.equal((await save({ expectedVersion: 4, saveId: uuid(903), root: chain(32, root.id) })).status, 200)
})

test('모양 오류는 경로를 싣는다', async () => {
  const { read, save } = start()
  const { root } = await read()
  root.children[0].check = 'MAYBE'
  const shape = await save({ expectedVersion: 3, saveId: uuid(1), root })
  assert.equal(shape.status, 400)
  assert.deepEqual(shape.body.errors, [{ field: 'root.children[0].check', rejectedValue: 'MAYBE', reason: REQUEST_SHAPE }])
  assert.equal(shape.body.message, REQUEST_SHAPE)
  assert.equal(shape.body.path, 'uri=/v2/mind-map')
  root.children[0].check = 'NONE'
  const missing = await save({ expectedVersion: 3, root })
  assert.equal(missing.status, 400)
  assert.deepEqual(missing.body.errors, [{ field: 'saveId', rejectedValue: null, reason: REQUEST_SHAPE }])
})

test('빠지거나 null인 값은 BE의 차례(check, id, text, collapsed, children)로 모두 모은다', async () => {
  const { read, save } = start()
  const { root } = await read()
  const response = await save({
    expectedVersion: -1,
    saveId: 'ABC',
    root: { ...root, children: [{ children: [] }, null] },
  })
  assert.equal(response.status, 400)
  assert.equal(response.body.message, REQUEST_SHAPE)
  assert.deepEqual(response.body.errors.map((e) => [e.field, e.rejectedValue]), [
    ['expectedVersion', -1],
    ['saveId', 'ABC'],
    ['root.children[0].check', null],
    ['root.children[0].id', null],
    ['root.children[0].text', null],
    ['root.children[0].collapsed', null],
    ['root.children[1]', null],
  ])
  assert.ok(response.body.errors.every((e) => e.reason === REQUEST_SHAPE))
  const noRoot = await save({ expectedVersion: 3, saveId: uuid(1) })
  assert.deepEqual(noRoot.body.errors.map((e) => e.field), ['root'])
})

test('종류가 틀린 값은 문서 차례의 첫 곳 하나만, rejectedValue 없이', async () => {
  const { read, save } = start()
  const { root } = await read()
  const first = (response) => {
    assert.equal(response.status, 400)
    assert.equal(response.body.message, REQUEST_SHAPE)
    return response.body.errors
  }
  const bad = { id: uuid(5), text: '가', collapsed: 'maybe', check: 'MAYBE', children: 'x' }
  assert.deepEqual(first(await save({ expectedVersion: 3, saveId: uuid(1), root: { ...root, children: [bad] } })),
    [{ field: 'root.children[0].collapsed', rejectedValue: null, reason: REQUEST_SHAPE }])
  assert.deepEqual(first(await save({ expectedVersion: 3, saveId: uuid(1), root: { ...root, children: {} } })).map((e) => e.field),
    ['root.children'])
  assert.deepEqual(first(await save({ expectedVersion: 'abc', saveId: 'ABC', root })).map((e) => [e.field, e.rejectedValue]),
    [['expectedVersion', null]])
  assert.deepEqual(first(await save({ expectedVersion: 3, saveId: uuid(1), root: { ...root, children: [5] } })).map((e) => e.field),
    ['root.children[0]'])
})

test('숫자 글자의 expectedVersion은 숫자로 받는다(Jackson 기본 변환)', async () => {
  const { read, save } = start()
  const { root } = await read()
  assert.deepEqual(await save({ expectedVersion: '3', saveId: uuid(1), root }), { status: 200, body: { version: 4 } })
})

test('깨진 JSON과 빈 본문은 일반 400', async () => {
  const { raw } = start()
  for (const text of ['{"expectedVersion":', '', '[]']) {
    const { status, body } = await raw('/v2/mind-map', text)
    assert.equal(status, 400)
    assert.equal(body.message, UNREADABLE_BODY)
    assert.deepEqual(body.errors, [])
  }
  const cursor = await raw('/v2/mind-map/cursor', '{')
  assert.equal(cursor.status, 400)
  assert.equal(cursor.body.message, UNREADABLE_BODY)
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
  assert.equal(bad.body.message, REQUEST_SHAPE)
  assert.equal(bad.body.path, 'uri=/v2/mind-map/cursor')
  assert.deepEqual(bad.body.errors, [{ field: 'nodeId', rejectedValue: 'ABC', reason: REQUEST_SHAPE }])
  const missing = await api('/v2/mind-map/cursor', 'PUT', {})
  assert.deepEqual(missing.body.errors, [{ field: 'nodeId', rejectedValue: null, reason: REQUEST_SHAPE }])
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
  const failed = await save({ expectedVersion: 3, saveId: uuid(2), root })
  assert.equal(failed.status, 500)
  assert.equal(failed.body.message, UNEXPECTED)
  assert.equal((await read()).version, 3)
})

test('탈퇴한 회원의 처음 저장은 409 MEMBER_WITHDRAWN, 충돌과 규칙 위반이 먼저다', async () => {
  const { read, save, mm } = start()
  mm.mockMindMapControls.withdraw(1)
  const { version, root } = await read()
  assert.equal(version, 0)
  assert.deepEqual(root.children, [])
  assert.equal((await save({ expectedVersion: 3, saveId: uuid(1), root })).body.code, 'VERSION_CONFLICT')
  const rule = await save({ expectedVersion: 0, saveId: uuid(1), root: { ...root, children: [node(uuid(5), '')] } })
  assert.equal(rule.status, 400)
  assert.deepEqual(await save({ expectedVersion: 0, saveId: uuid(1), root }), {
    status: 409,
    body: { code: 'MEMBER_WITHDRAWN', message: WITHDRAWN, latestVersion: null, lastSaveId: null },
  })
  assert.equal((await read()).version, 0)
  assert.equal((await save({ expectedVersion: 0, saveId: uuid(1), root: (await read(2)).root }, 2)).status, 200)
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
  assert.equal(failed.body.message, UNREADABLE)
  assert.equal(failed.body.error, 'Internal Server Error')
  assert.equal(failed.body.path, 'uri=/v2/mind-map')
  assert.deepEqual(failed.body.errors, [])
  assert.equal('code' in failed.body, false)
  assert.equal((await api('/v2/mind-map')).status, 200)
})
