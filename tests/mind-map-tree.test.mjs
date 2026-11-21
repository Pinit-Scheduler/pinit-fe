import assert from 'node:assert/strict'
import test from 'node:test'
import { loadModules } from './support/mocks.mjs'

const load = loadModules()
const tree = load('src/features/mind-map/model/tree.ts')
const plain = (value) => JSON.parse(JSON.stringify(value))
const n = (id, children = [], extra = {}) => ({
  id,
  text: id,
  collapsed: false,
  check: 'NONE',
  children,
  ...extra,
})
const map = n('r', [
  n('a', [n('a1'), n('a2')]),
  n('b', [], { collapsed: true, children: [n('b1')] }),
  n('c'),
])

test('하위 가지는 맨 끝에 붙고 접힌 부모를 편다', () => {
  const next = tree.addChild(map, 'b', tree.newNode('x'))
  assert.deepEqual(plain(tree.findNode(next, 'b').children.map((c) => c.id)), ['b1', 'x'])
  assert.equal(tree.findNode(next, 'b').collapsed, false)
  assert.equal(tree.findNode(map, 'b').collapsed, true, '입력은 그대로')
})

test('같은 단계는 바로 뒤, 주제에서는 하위', () => {
  assert.deepEqual(
    plain(tree.addSiblingAfter(map, 'a1', tree.newNode('x')).children[0].children.map((c) => c.id)),
    ['a1', 'x', 'a2'],
  )
  assert.equal(tree.addSiblingAfter(map, 'r', tree.newNode('x')).children.at(-1).id, 'x')
})

test('지우면 다음, 앞, 부모 순서로 고르고 주제는 지우지 않는다', () => {
  assert.equal(tree.removeNode(map, 'a1').nextId, 'a2')
  assert.equal(tree.removeNode(map, 'a2').nextId, 'a1')
  assert.equal(tree.removeNode(tree.removeNode(map, 'a1').root, 'a2').nextId, 'a')
  assert.equal(tree.removeNode(map, 'r'), null)
  assert.equal(tree.removeNode(map, 'zz'), null)
  assert.equal(tree.findNode(tree.removeNode(map, 'a').root, 'a2'), null, '아래도 함께')
})

test('끌어 놓을 자리는 3분의 1 규칙', () => {
  assert.deepEqual(plain(tree.dropTarget(map, 'c', 'a', 0.2)), { targetId: 'a', mode: 'before' })
  assert.deepEqual(plain(tree.dropTarget(map, 'c', 'a', 0.8)), { targetId: 'a', mode: 'after' })
  assert.deepEqual(plain(tree.dropTarget(map, 'c', 'a', 0.5)), { targetId: 'a', mode: 'child' })
  assert.equal(tree.dropTarget(map, 'c', 'r', 0.1), null, '이미 주제의 자식')
  assert.equal(tree.dropTarget(map, 'c', 'r', 0.5), null, '이미 주제의 자식')
  assert.deepEqual(plain(tree.dropTarget(map, 'a1', 'r', 0.1)), { targetId: 'r', mode: 'child' }, '더 깊은 가지는 주제 위에서 늘 자식')
  assert.equal(tree.dropTarget(map, 'a', 'a1', 0.5), null, '자기 아래')
  assert.equal(tree.dropTarget(map, 'a', 'a', 0.5), null, '자기 자신')
  assert.equal(tree.dropTarget(map, 'a1', 'a', 0.5), null, '이미 그 자식')
  assert.deepEqual(plain(tree.dropTarget(map, 'a1', 'a', 0.9)), { targetId: 'a', mode: 'after' })
})

test('놓으면 그 자리로 옮기고 id·체크 상태가 그대로다', () => {
  const checked = tree.updateNode(map, 'c', (node) => ({ ...node, check: 'DONE' }))
  const moved = tree.applyDrop(checked, 'c', { targetId: 'a1', mode: 'before' })
  assert.deepEqual(
    plain(tree.findNode(moved, 'a').children.map((x) => [x.id, x.check])),
    [['c', 'DONE'], ['a1', 'NONE'], ['a2', 'NONE']],
  )
  assert.equal(tree.findNode(tree.applyDrop(map, 'c', { targetId: 'b', mode: 'child' }), 'b').collapsed, false)
  assert.deepEqual(
    plain(tree.applyDrop(map, 'a1', { targetId: 'a2', mode: 'after' }).children[0].children.map((x) => x.id)),
    ['a2', 'a1'],
  )
})

test('같은 부모 안에서 순서를 바꾸고 끝에서는 그대로', () => {
  assert.deepEqual(
    plain(tree.moveAmongSiblings(map, 'a2', -1).children[0].children.map((x) => x.id)),
    ['a2', 'a1'],
  )
  assert.equal(tree.moveAmongSiblings(map, 'a1', -1), null)
  assert.equal(tree.moveAmongSiblings(map, 'r', 1), null)
})

test('체크 상태의 차례', () => {
  assert.deepEqual(['NONE', 'OPEN', 'DONE'].map(tree.nextCheck), ['OPEN', 'DONE', 'OPEN'])
  assert.deepEqual(['NONE', 'OPEN', 'DONE'].map(tree.toggledCheckbox), ['OPEN', 'NONE', 'NONE'])
})

test('숫자: 가지, 맨 끝 가지, 할 일(접힌 아래 포함)', () => {
  const m = tree.updateNode(
    tree.updateNode(map, 'b1', (x) => ({ ...x, check: 'DONE' })),
    'a1',
    (x) => ({ ...x, check: 'OPEN' }),
  )
  assert.deepEqual(plain(tree.countBranches(m)), { branches: 6, leaves: 4, todoDone: 1, todoTotal: 2 })
  assert.equal(tree.hiddenCount(tree.findNode(map, 'a')), 2)
})

test('찾기, 길, 깊이, 크기', () => {
  assert.equal(tree.findNode(map, 'zz'), null)
  assert.equal(tree.parentOf(map, 'a1').id, 'a')
  assert.equal(tree.parentOf(map, 'r'), null)
  assert.deepEqual(plain(tree.pathTo(map, 'b1')), ['r', 'b', 'b1'])
  assert.deepEqual(plain(tree.pathTo(map, 'zz')), [])
  assert.equal(tree.depthOf(map, 'r'), 0)
  assert.equal(tree.depthOf(map, 'a2'), 2)
  assert.equal(tree.depthOf(map, 'zz'), -1)
  assert.equal(tree.totalNodes(map), 7)
  assert.equal(tree.subtreeHeight(map), 2)
  assert.equal(tree.subtreeHeight(n('x')), 0)
})

test('보이는 기준 가지: 없으면 주제, 접힌 조상 아래면 가장 위의 접힌 조상', () => {
  assert.equal(tree.visibleAnchor(map, 'zz'), 'r')
  assert.equal(tree.visibleAnchor(map, 'b1'), 'b')
  assert.equal(tree.visibleAnchor(map, 'a1'), 'a1')
})

test('되살린 나무는 지금 있는 가지의 접힘을 지금 값으로 둔다', () => {
  const now = tree.updateNode(tree.removeNode(map, 'c').root, 'a', (x) => ({ ...x, collapsed: true }))
  const restored = tree.withCollapseFrom(map, now)
  assert.equal(tree.findNode(restored, 'a').collapsed, true)
  assert.equal(tree.findNode(restored, 'c').collapsed, false)
})

test('JSON은 정해진 키 순서', () => {
  assert.equal(tree.treeJson(n('r')), '{"id":"r","text":"r","collapsed":false,"check":"NONE","children":[]}')
  assert.equal(tree.treeJson({ children: [], check: 'NONE', collapsed: false, text: 'r', id: 'r' }), tree.treeJson(n('r')))
})

test('topmostBranches는 주제·없는 id·다른 고른 가지의 아래를 빼고 깊이 우선 차례로 준다', () => {
  assert.deepEqual(plain(tree.topmostBranches(map, ['a1', 'r', 'a', 'c', 'zz'])), ['a', 'c'])
  assert.deepEqual(plain(tree.topmostBranches(map, ['c', 'a2', 'b1'])), ['a2', 'b1', 'c'])
  assert.deepEqual(plain(tree.topmostBranches(map, ['r'])), [])
})

test('dropTargetMany는 끄는 가지들의 안과 이미 모두 자식인 자리를 막는다', () => {
  assert.equal(tree.dropTargetMany(map, ['a', 'c'], 'a1', 0.5), null, '끄는 가지의 아래')
  assert.equal(tree.dropTargetMany(map, ['a', 'c'], 'c', 0.1), null, '끄는 가지 자신')
  assert.deepEqual(plain(tree.dropTargetMany(map, ['a1', 'c'], 'b', 0.5)), { targetId: 'b', mode: 'child' })
  assert.equal(tree.dropTargetMany(map, ['a', 'c'], 'r', 0.5), null, '모두 이미 주제의 자식')
  assert.deepEqual(plain(tree.dropTargetMany(map, ['a1', 'c'], 'r', 0.5)), { targetId: 'r', mode: 'child' })
  assert.equal(tree.dropTargetMany(map, ['a1', 'a2'], 'a', 0.5), null, '모두 이미 그 자식')
  assert.deepEqual(plain(tree.dropTargetMany(map, ['a1', 'c'], 'a', 0.5)), { targetId: 'a', mode: 'child' })
  assert.deepEqual(plain(tree.dropTargetMany(map, ['a2', 'c'], 'a1', 0.2)), { targetId: 'a1', mode: 'before' })
  assert.equal(tree.dropTargetMany(map, [], 'a', 0.5), null)
})

test('applyDropMany는 모두 떼어 낸 뒤 놓는 자리에 깊이 우선 차례로 넣는다', () => {
  const ids = (root, id) => plain(tree.findNode(root, id).children.map((x) => x.id))
  const child = tree.applyDropMany(map, ['c', 'a1'], { targetId: 'b', mode: 'child' })
  assert.deepEqual(ids(child, 'b'), ['b1', 'a1', 'c'])
  assert.deepEqual(ids(child, 'r'), ['a', 'b'])
  assert.equal(tree.findNode(child, 'b').collapsed, false, '자식으로 넣으면 편다')
  const before = tree.applyDropMany(map, ['a2', 'c'], { targetId: 'a1', mode: 'before' })
  assert.deepEqual(ids(before, 'a'), ['a2', 'c', 'a1'])
  const after = tree.applyDropMany(map, ['a1', 'c'], { targetId: 'a2', mode: 'after' })
  assert.deepEqual(ids(after, 'a'), ['a2', 'a1', 'c'])
  assert.equal(tree.applyDropMany(map, ['a', 'c'], { targetId: 'a1', mode: 'child' }), map, '끄는 가지의 아래')
  assert.equal(tree.applyDropMany(map, ['a'], { targetId: 'r', mode: 'before' }), map, '주제의 앞')
  assert.equal(tree.totalNodes(child), tree.totalNodes(map))
})
