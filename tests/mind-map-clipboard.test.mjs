import assert from 'node:assert/strict'
import test from 'node:test'
import { loadModules } from './support/mocks.mjs'

const load = loadModules()
const editor = load('src/features/mind-map/model/editor.ts')
const tree = load('src/features/mind-map/model/tree.ts')
const clipboard = load('src/features/mind-map/model/clipboard.ts')
const plain = (value) => JSON.parse(JSON.stringify(value))
const n = (id, children = [], extra = {}) => ({ id, text: id, collapsed: false, check: 'NONE', children, ...extra })
const map = n('r', [
  n('a', [n('a1', [], { check: 'OPEN' }), n('a2', [], { check: 'DONE' })], { collapsed: true }),
  n('b'),
])
const ids = () => {
  let i = 0
  return () => 'n' + ++i
}
const limits = { maxBranches: 500, maxTextLength: 100, maxDepth: 32 }
const startAt = (cursorNodeId, root = map, lim = limits) =>
  editor.initialEditor({ root, cursorNodeId, limits: lim })
const run = (state, commands, ctx = { newId: ids() }) => {
  let result = { state, save: null, notice: null }
  for (const command of commands) result = editor.reduce(result.state, command, ctx)
  return result
}
const shape = (node) => ({ text: node.text, check: node.check, collapsed: node.collapsed, children: node.children.map(shape) })

test('복사는 가지와 그 아래를 들여 쓴 목록 글로 둔다. 나무는 그대로고 저장하지 않는다', () => {
  const { state, save, notice } = run(startAt('a'), [{ type: 'copy' }])
  assert.equal(state.tree, startAt('a').tree)
  assert.equal(save, null)
  assert.equal(notice, '가지를 복사했어요.')
  assert.equal(state.clipboard.text, '- a\n  - [ ] a1\n  - [x] a2')
  assert.equal(state.history.past.length, 0)
})

test('붙여넣기는 고른 가지의 마지막 하위 가지로 새 id를 달아 붙이고 붙인 가지를 고른다', () => {
  const copied = run(startAt('a'), [{ type: 'copy' }, { type: 'select', id: 'b' }]).state
  // 붙인 가지가 골라지므로 다시 b를 골라 한 번 더 붙인다.
  const { state, save } = run(copied, [{ type: 'paste' }, { type: 'select', id: 'b' }, { type: 'paste' }])
  const b = tree.findNode(state.tree, 'b')
  assert.deepEqual(plain(b.children.map((x) => x.id)), ['n1', 'n4'])
  assert.deepEqual(plain(shape(b.children[0])), plain(shape(tree.findNode(map, 'a'))), '체크·접힘까지 같다')
  assert.equal(state.selectedId, 'n4')
  assert.equal(save, 'later')
  const undone = run(state, [{ type: 'undo' }, { type: 'undo' }]).state
  assert.equal(tree.findNode(state.tree, 'n1').collapsed, true)
  assert.deepEqual(plain(tree.findNode(undone.tree, 'b').children), [])
  assert.ok(undone.clipboard, '되돌려도 클립보드는 남는다')
})

test('잘라내기는 지우고 클립보드에 둔다. 주제는 잘라내지 않는다', () => {
  const { state, save } = run(startAt('a'), [{ type: 'cut' }])
  assert.equal(tree.findNode(state.tree, 'a'), null)
  assert.equal(state.selectedId, 'b')
  assert.equal(save, 'later')
  const pasted = run(state, [{ type: 'paste' }]).state
  assert.equal(tree.findNode(pasted.tree, 'b').children[0].text, 'a')
  const root = run(startAt('r'), [{ type: 'cut' }]).state
  assert.equal(root.tree, map)
  assert.equal(root.clipboard, null)
})

test('주제를 복사해 붙이면 주제 글을 가진 가지가 된다', () => {
  const { state } = run(startAt('r'), [{ type: 'copy' }, { type: 'select', id: 'b' }, { type: 'paste' }])
  assert.equal(tree.findNode(state.tree, 'b').children[0].text, 'r')
  assert.equal(tree.totalNodes(state.tree), 10)
})

test('붙일 것이 없으면 알린다', () => {
  const { state, notice } = run(startAt('a'), [{ type: 'paste' }])
  assert.equal(state.tree, map)
  assert.equal(notice, editor.NOTHING_TO_PASTE)
})

test('가지 수나 깊이를 넘으면 하나도 붙이지 않는다', () => {
  const few = { ...limits, maxBranches: 6 }
  const copied = run(startAt('a', map, few), [{ type: 'copy' }]).state
  const over = run(copied, [{ type: 'paste' }])
  assert.equal(over.state.tree, map)
  assert.equal(over.notice, '가지는 6개까지 만들 수 있어요.')
  const shallow = { ...limits, maxDepth: 2 }
  const deep = run(startAt('a', map, shallow), [{ type: 'copy' }, { type: 'select', id: 'a1' }, { type: 'paste' }])
  assert.equal(deep.notice, '가지는 주제 아래 2단계까지 만들 수 있어요.')
  const fits = run(startAt('a', map, shallow), [{ type: 'copy' }, { type: 'select', id: 'r' }, { type: 'paste' }])
  assert.equal(fits.notice, null)
})

test('시스템 클립보드의 글이 복사한 글과 같으면 접힘까지 지킨 화면의 클립보드를 붙인다', () => {
  const copied = run(startAt('a'), [{ type: 'copy' }, { type: 'select', id: 'b' }]).state
  const text = copied.clipboard.text.replace(/\n/g, '\r\n') + '\r\n'
  const pasted = run(copied, [{ type: 'paste', text }]).state
  assert.equal(tree.findNode(pasted.tree, 'b').children[0].collapsed, true)
})

test('다른 글이면 줄마다 가지로 읽는다. 들여 쓴 줄은 하위 가지, 목록 기호는 빼고 [ ] [x]는 체크박스다', () => {
  const copied = run(startAt('a'), [{ type: 'copy' }, { type: 'select', id: 'b' }]).state
  const text = '장보기\n\t- [ ] 우유\n    * [X]   달걀  두 판\n\n1. 청소\n  + 거실\n'
  const { state, notice } = run(copied, [{ type: 'paste', text }])
  const b = tree.findNode(state.tree, 'b')
  assert.deepEqual(plain(b.children.map(shape)), [
    {
      text: '장보기',
      check: 'NONE',
      collapsed: false,
      children: [
        { text: '우유', check: 'OPEN', collapsed: false, children: [] },
        { text: '달걀 두 판', check: 'DONE', collapsed: false, children: [] },
      ],
    },
    { text: '청소', check: 'NONE', collapsed: false, children: [{ text: '거실', check: 'NONE', collapsed: false, children: [] }] },
  ])
  assert.equal(state.selectedId, b.children[0].id)
  assert.equal(notice, null)
})

test('읽은 글이 한도를 넘으면 잘라 붙이고 알린다. 빈 글이면 화면의 클립보드를 붙인다', () => {
  const short = { ...limits, maxTextLength: 5 }
  const { state, notice } = run(startAt('b', map, short), [{ type: 'paste', text: '일이삼사오육칠' }])
  assert.equal(tree.findNode(state.tree, 'b').children[0].text, '일이삼사오')
  assert.equal(notice, '글은 5자까지 쓸 수 있어요.')
  const copied = run(startAt('a'), [{ type: 'copy' }, { type: 'select', id: 'b' }]).state
  const fallback = run(copied, [{ type: 'paste', text: '  \n ' }]).state
  assert.equal(tree.findNode(fallback.tree, 'b').children[0].text, 'a')
})

test('목록 글은 다시 읽으면 같은 나무다(접힘 빼고)', () => {
  const node = tree.findNode(map, 'a')
  const text = clipboard.clipboardOf(node).text
  const parsed = clipboard.parseOutline(text, 100)
  assert.deepEqual(plain(parsed.nodes.map((x) => x.children.map((c) => [c.text, c.check]))), [[['a1', 'OPEN'], ['a2', 'DONE']]])
})

test('처음 쓰는 빈 새 가지에서 잘라내기·복사·붙여넣기는 쓰기 취소다', () => {
  for (const type of ['cut', 'copy', 'paste']) {
    const copied = run(startAt('b'), [{ type: 'copy' }]).state
    const { state } = run(copied, [{ type: 'addChild' }, { type }])
    assert.equal(state.editing, null, type)
    assert.deepEqual(plain(state.tree), plain(map), type)
    assert.equal(state.selectedId, 'b', type)
  }
})

test('글을 쓴 새 가지는 확정한 뒤 복사한다', () => {
  const { state } = run(startAt('b'), [{ type: 'addChild' }, { type: 'input', text: ' 새 글 ' }, { type: 'copy' }])
  assert.equal(state.editing, null)
  assert.equal(state.clipboard.text, '- 새 글')
})

test('서버에서 다시 받아도 클립보드는 남는다', () => {
  const copied = run(startAt('a'), [{ type: 'copy' }]).state
  const replaced = editor.replaceFromServer(copied, { root: map, cursorNodeId: 'a', limits })
  assert.equal(replaced.clipboard, copied.clipboard)
})

test('단추 상태: 주제는 잘라내지 않고, 붙여넣기는 클립보드가 있을 때만', () => {
  assert.deepEqual(
    [editor.actionState(startAt('r')).canDelete, editor.actionState(startAt('r')).canCopy, editor.actionState(startAt('r')).canPaste],
    [false, true, false],
  )
  const copied = run(startAt('a'), [{ type: 'copy' }]).state
  assert.equal(editor.actionState(copied).canPaste, true)
})
