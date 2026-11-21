import assert from 'node:assert/strict'
import test from 'node:test'
import { loadModules } from './support/mocks.mjs'

const load = loadModules()
const editor = load('src/features/mind-map/model/editor.ts')
const tree = load('src/features/mind-map/model/tree.ts')
const history = load('src/features/mind-map/model/history.ts')
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
const ids = () => {
  let i = 0
  return () => 'n' + ++i
}
const limits = { maxBranches: 500, maxTextLength: 100, maxDepth: 32 }
const start = editor.initialEditor({ root: map, cursorNodeId: 'a1', limits })

/** 명령을 차례로 보내고 마지막 결과를 돌려준다. */
const run = (state, commands, ctx = { newId: ids() }) => {
  let result = { state, save: null, notice: null }
  for (const command of commands) result = editor.reduce(result.state, command, ctx)
  return result
}
const text = (state, id) => tree.findNode(state.tree, id)?.text
const childIds = (state, id) => plain(tree.findNode(state.tree, id).children.map((x) => x.id))

test('Tab은 하위 가지를 만들고 바로 쓰기 시작한다', () => {
  const { state, save } = run(start, [{ type: 'select', id: 'b' }, { type: 'addChild' }])
  assert.equal(state.selectedId, 'n1')
  assert.equal(state.editing.isNew, true)
  assert.equal(tree.findNode(state.tree, 'b').collapsed, false)
  assert.equal(state.history.past.length, 0, '확정할 때 기록한다')
  assert.equal(save, null)
  const committed = run(state, [{ type: 'input', text: '짐 싸기' }, { type: 'commit' }]).state
  assert.equal(committed.history.past.length, 1)
  const undone = run(committed, [{ type: 'undo' }]).state
  assert.equal(tree.findNode(undone.tree, 'n1'), null)
  assert.equal(undone.selectedId, 'b')
})

test('주제에서 Enter는 하위 가지다', () => {
  const { state } = run(start, [{ type: 'select', id: 'r' }, { type: 'addSibling' }])
  assert.equal(tree.parentOf(state.tree, 'n1').id, 'r')
})

test('Enter로 확정하면 바로 저장하고 한 번 더 Enter면 다음 가지', () => {
  const ctx = { newId: ids() }
  const done = run(start, [{ type: 'addSibling' }, { type: 'input', text: '이사 준비' }, { type: 'commit' }], ctx)
  assert.equal(done.save, 'now')
  assert.equal(done.state.editing, null)
  assert.equal(text(done.state, 'n1'), '이사 준비')
  const next = run(done.state, [{ type: 'addSibling' }], ctx)
  assert.deepEqual(childIds(next.state, 'a'), ['a1', 'n1', 'n2', 'a2'])
})

test('Tab으로 확정하면 저장하고 하위 가지를 연다', () => {
  const { state, save } = run(start, [
    { type: 'addSibling' },
    { type: 'input', text: '이사 준비' },
    { type: 'commitAndAddChild' },
  ])
  assert.equal(save, 'now')
  assert.equal(text(state, 'n1'), '이사 준비')
  assert.equal(state.editing.id, 'n2')
  assert.equal(state.editing.from, 'n1')
  assert.equal(tree.parentOf(state.tree, 'n2').id, 'n1')
})

test('빈 채로 확정하면 새 가지는 사라지고 선택과 기록이 돌아간다', () => {
  const { state, save } = run(start, [{ type: 'addChild' }, { type: 'input', text: '  ' }, { type: 'commit' }])
  assert.equal(tree.findNode(state.tree, 'n1'), null)
  assert.equal(state.selectedId, 'a1')
  assert.equal(state.history.past.length, 0)
  assert.equal(save, null)
  assert.equal(state.editing, null)
})

test('기존 가지를 비워 확정하면 원래 글로', () => {
  const { state, save } = run(start, [{ type: 'startEdit' }, { type: 'input', text: '' }, { type: 'commit' }])
  assert.equal(text(state, 'a1'), 'a1')
  assert.equal(state.history.past.length, 0)
  assert.equal(save, null)
})

test('같은 글로 확정하면 기록하지 않는다', () => {
  const { state, save } = run(start, [{ type: 'startEdit' }, { type: 'input', text: ' a1 ' }, { type: 'commit' }])
  assert.equal(text(state, 'a1'), 'a1')
  assert.equal(state.history.past.length, 0)
  assert.equal(save, null)
})

test('Esc는 새 가지를 없애고 기존 가지는 원래 글로', () => {
  const fresh = run(start, [{ type: 'addChild' }, { type: 'input', text: '새 글' }, { type: 'cancel' }])
  assert.equal(tree.findNode(fresh.state.tree, 'n1'), null)
  assert.equal(fresh.state.selectedId, 'a1')
  assert.equal(fresh.state.history.past.length, 0)
  assert.equal(fresh.state.editing, null)
  assert.equal(fresh.save, null)
  const old = run(start, [{ type: 'startEdit', id: 'c' }, { type: 'input', text: '바꾼 글' }, { type: 'cancel' }])
  assert.equal(text(old.state, 'c'), 'c')
  assert.equal(old.state.selectedId, 'c')
  assert.equal(old.state.history.past.length, 0)
  assert.equal(old.save, null)
})

test('글은 정리해서 확정한다', () => {
  const { state } = run(start, [{ type: 'startEdit' }, { type: 'input', text: ' x\ty ' }, { type: 'commit' }])
  assert.equal(text(state, 'a1'), 'x y')
})

test('쓰는 중의 글은 받은 그대로 나무에 넣고 기록하지 않는다', () => {
  const { state } = run(start, [{ type: 'startEdit' }, { type: 'input', text: ' x\ty ' }])
  assert.equal(text(state, 'a1'), ' x\ty ')
  assert.equal(state.history.past.length, 0)
  const committed = run(state, [{ type: 'commit' }]).state
  assert.equal(committed.history.past.length, 1)
  const undone = run(committed, [{ type: 'undo' }]).state
  assert.equal(text(undone, 'a1'), 'a1')
  assert.equal(undone.selectedId, 'a1')
})

test('편집을 시작했다가 바꾸지 않고 끝내면 다시 하기가 남는다', () => {
  const undone = run(start, [{ type: 'delete' }, { type: 'undo' }]).state
  for (const end of [
    [{ type: 'cancel' }],
    [{ type: 'commit' }],
    [{ type: 'input', text: '' }, { type: 'commit' }],
  ]) {
    const ended = run(undone, [{ type: 'startEdit', id: 'c' }, ...end]).state
    assert.deepEqual(plain(ended.history), plain(undone.history))
    const redone = run(ended, [{ type: 'redo' }]).state
    assert.equal(tree.findNode(redone.tree, 'a1'), null)
  }
  const fresh = run(undone, [{ type: 'addChild' }, { type: 'input', text: 'q' }, { type: 'cancel' }]).state
  assert.deepEqual(plain(fresh.history), plain(undone.history))
})

test('200단계에서 바꾸지 않은 편집은 오래된 단계를 잃지 않는다', () => {
  const commands = Array.from({ length: 200 }, (_, i) => ({ type: 'reorder', step: i % 2 === 0 ? 1 : -1 }))
  const full = run(start, commands).state
  assert.equal(full.history.past.length, 200)
  const ended = run(full, [{ type: 'startEdit' }, { type: 'input', text: 'zz' }, { type: 'cancel' }]).state
  assert.equal(ended.history.past.length, 200)
  assert.equal(ended.history.past[0], full.history.past[0])
  const fresh = run(full, [{ type: 'addChild' }, { type: 'commit' }]).state
  assert.equal(fresh.history.past[0], full.history.past[0])
})

test('100자를 넘으면 확정하지 않고 알린다', () => {
  const editing = run(start, [{ type: 'startEdit' }, { type: 'input', text: '😀'.repeat(101) }])
  const over = run(editing.state, [{ type: 'commit' }])
  assert.deepEqual(plain(over.state.editing), plain(editing.state.editing))
  assert.equal(over.notice, '글은 100자까지 쓸 수 있어요.')
  assert.equal(over.save, null)
  const ok = run(over.state, [{ type: 'input', text: '😀'.repeat(100) }, { type: 'commit' }])
  assert.equal(ok.state.editing, null)
  assert.equal(text(ok.state, 'a1'), '😀'.repeat(100))
  assert.equal(ok.save, 'now')
})

test('확정된 나무는 쓰는 가지를 마지막 확정 글로, 처음 쓰는 새 가지는 뺀다', () => {
  const old = run(start, [{ type: 'startEdit', id: 'a1' }, { type: 'input', text: 'xx' }]).state
  assert.equal(tree.findNode(editor.confirmedTree(old), 'a1').text, 'a1')
  assert.equal(tree.findNode(editor.leaveTree(old), 'a1').text, 'xx')
  const fresh = run(start, [{ type: 'addChild' }, { type: 'input', text: 'yy' }]).state
  assert.equal(tree.findNode(editor.confirmedTree(fresh), 'n1'), null)
  assert.equal(tree.findNode(editor.leaveTree(fresh), 'n1').text, 'yy')
  assert.equal(editor.confirmedTree(start), start.tree)
})

test('지우면 다음 가지를 고르고 나중에 저장한다; 주제는 지우지 않는다', () => {
  const removed = run(start, [{ type: 'delete' }])
  assert.equal(removed.save, 'later')
  assert.equal(removed.state.selectedId, 'a2')
  assert.equal(tree.findNode(removed.state.tree, 'a1'), null)
  assert.equal(removed.state.history.past.length, 1)
  const atRoot = run(start, [{ type: 'select', id: 'r' }]).state
  const kept = run(atRoot, [{ type: 'delete' }])
  assert.equal(kept.state, atRoot)
  assert.equal(kept.save, null)
})

test('되돌리면 같은 id로 살아나고 다시 하기도 된다', () => {
  const removed = run(start, [{ type: 'select', id: 'a' }, { type: 'delete' }]).state
  assert.equal(tree.findNode(removed.tree, 'a2'), null)
  const undone = run(removed, [{ type: 'undo' }])
  assert.ok(tree.findNode(undone.state.tree, 'a2'))
  assert.equal(undone.state.selectedId, 'a')
  assert.equal(undone.save, 'later')
  const redone = run(undone.state, [{ type: 'redo' }])
  assert.equal(tree.findNode(redone.state.tree, 'a2'), null)
  assert.equal(redone.state.selectedId, 'b')
  assert.equal(redone.save, 'later')
  const nothing = run(start, [{ type: 'undo' }])
  assert.equal(nothing.state, start)
  assert.equal(nothing.save, null)
  assert.equal(run(start, [{ type: 'redo' }]).state, start)
})

test('기록은 200단계까지', () => {
  const commands = Array.from({ length: 201 }, (_, i) => ({ type: 'reorder', step: i % 2 === 0 ? 1 : -1 }))
  const { state } = run(start, commands)
  assert.equal(state.history.past.length, 200)
  assert.equal(history.HISTORY_LIMIT, 200)
})

test('기록: 넣으면 가장 오래된 것을 버리고, 되돌리기와 다시 하기는 지금을 맞은편에 둔다', () => {
  const snap = (selectedId) => ({ tree: map, selectedId })
  let h = history.emptyHistory()
  for (let i = 0; i < 202; i++) h = history.record(h, snap('s' + i))
  assert.equal(h.past.length, 200)
  assert.equal(h.past[0].selectedId, 's2')
  const back = history.undo(h, snap('now'))
  assert.equal(back.snapshot.selectedId, 's201')
  assert.equal(back.history.past.length, 199)
  assert.deepEqual(plain(back.history.future.map((x) => x.selectedId)), ['now'])
  const forth = history.redo(back.history, snap('then'))
  assert.equal(forth.snapshot.selectedId, 'now')
  assert.equal(forth.history.past.at(-1).selectedId, 'then')
  assert.equal(forth.history.future.length, 0)
  assert.equal(history.undo(history.emptyHistory(), snap('x')), null)
  assert.equal(history.redo(h, snap('x')), null)
  assert.equal(history.record(back.history, snap('y')).future.length, 0)
  assert.equal(history.dropLast(h).past.length, 199)
  assert.equal(history.dropLast(h).past.at(-1).selectedId, 's200')
})

test('새로 기록하면 다시 하기는 사라진다', () => {
  const undone = run(start, [{ type: 'delete' }, { type: 'undo' }]).state
  assert.equal(undone.history.future.length, 1)
  const changed = run(undone, [{ type: 'reorder', step: 1 }]).state
  assert.equal(changed.history.future.length, 0)
})

test('접기는 기록에 없고, 접으면 그 안의 선택이 접은 가지로', () => {
  const { state, save } = run(start, [{ type: 'toggleCollapse', id: 'a' }])
  assert.equal(tree.findNode(state.tree, 'a').collapsed, true)
  assert.equal(state.selectedId, 'a')
  assert.equal(state.history.past.length, 0)
  assert.equal(save, 'later')
  const leaf = run(start, [{ type: 'toggleCollapse' }])
  assert.equal(leaf.state, start)
  assert.equal(leaf.save, null)
  const other = run(start, [{ type: 'toggleCollapse', id: 'b' }]).state
  assert.equal(tree.findNode(other.tree, 'b').collapsed, false)
  assert.equal(other.selectedId, 'a1')
})

test('Ctrl+Enter는 없음→안 됨→됨→안 됨, 주제는 그대로', () => {
  let state = start
  ;['OPEN', 'DONE', 'OPEN'].forEach((check, i) => {
    const result = run(state, [{ type: 'toggleCheck' }])
    state = result.state
    assert.equal(tree.findNode(state.tree, 'a1').check, check)
    assert.equal(result.save, 'now')
    assert.equal(state.history.past.length, i + 1)
  })
  const root = run(start, [{ type: 'toggleCheck', id: 'r' }])
  assert.equal(root.state.selectedId, 'r')
  assert.equal(root.state.tree.check, 'NONE')
  assert.equal(root.state.history.past.length, 0)
  assert.equal(root.save, null)
  const byId = run(start, [{ type: 'toggleCheck', id: 'c' }]).state
  assert.equal(byId.selectedId, 'c')
  assert.equal(tree.findNode(byId.tree, 'c').check, 'OPEN')
})

test('Ctrl+Shift+Enter는 붙이고 떼고, 떼면 체크 상태도 사라진다', () => {
  const attached = run(start, [{ type: 'toggleCheckbox' }])
  assert.equal(tree.findNode(attached.state.tree, 'a1').check, 'OPEN')
  assert.equal(attached.save, 'now')
  const done = run(start, [{ type: 'toggleCheck' }, { type: 'toggleCheck' }]).state
  assert.equal(tree.findNode(done.tree, 'a1').check, 'DONE')
  const removed = run(done, [{ type: 'toggleCheckbox' }])
  assert.equal(tree.findNode(removed.state.tree, 'a1').check, 'NONE')
  assert.equal(removed.state.history.past.length, 3)
  assert.equal(run(start, [{ type: 'select', id: 'r' }, { type: 'toggleCheckbox' }]).save, null)
})

test('되돌리기는 접힘을 지금 상태로 둔다', () => {
  const { state } = run(start, [
    { type: 'select', id: 'c' },
    { type: 'delete' },
    { type: 'toggleCollapse', id: 'a' },
    { type: 'undo' },
  ])
  assert.ok(tree.findNode(state.tree, 'c'))
  assert.equal(tree.findNode(state.tree, 'a').collapsed, true)
  assert.equal(state.selectedId, 'c')
})

test('되살린 선택이 접힌 가지 아래면 접힌 가지를 고른다', () => {
  const { state } = run(start, [{ type: 'delete' }, { type: 'toggleCollapse', id: 'a' }, { type: 'undo' }])
  assert.ok(tree.findNode(state.tree, 'a1'))
  assert.equal(state.selectedId, 'a')
})

test('가지 수 한도에서는 만들지 않고 알린다', () => {
  const full = editor.initialEditor({ root: map, cursorNodeId: 'a1', limits: { ...limits, maxBranches: 7 } })
  for (const type of ['addChild', 'addSibling']) {
    const { state, save, notice } = run(full, [{ type }])
    assert.equal(notice, '가지는 7개까지 만들 수 있어요.')
    assert.equal(state, full)
    assert.equal(save, null)
  }
})

test('깊이 한도', () => {
  const shallow = editor.initialEditor({ root: map, cursorNodeId: 'a1', limits: { ...limits, maxDepth: 2 } })
  const deep = run(shallow, [{ type: 'addChild' }])
  assert.equal(deep.notice, '가지는 주제 아래 2단계까지 만들 수 있어요.')
  assert.equal(deep.state, shallow)
  assert.equal(run(shallow, [{ type: 'addSibling' }]).notice, null)
  const dropped = run(shallow, [{ type: 'drop', draggedId: 'a', drop: { targetId: 'c', mode: 'child' } }])
  assert.equal(dropped.notice, '가지는 주제 아래 2단계까지 만들 수 있어요.')
  assert.equal(dropped.state, shallow)
  assert.equal(dropped.save, null)
})

test('놓으면 옮긴 가지를 고르고 나중에 저장한다', () => {
  const { state, save } = run(start, [{ type: 'drop', draggedId: 'c', drop: { targetId: 'a1', mode: 'before' } }])
  assert.deepEqual(childIds(state, 'a'), ['c', 'a1', 'a2'])
  assert.equal(state.selectedId, 'c')
  assert.equal(state.history.past.length, 1)
  assert.equal(save, 'later')
})

test('방향키', () => {
  const box = (x, y, w = 100, h = 20) => ({ x, y, w, h })
  const geo = new Map([
    ['r', box(0, 40, 80, 40)],
    ['a', box(132, 10)],
    ['b', box(132, 74)],
    ['c', box(132, 100)],
    ['a1', box(284, 0)],
    ['a2', box(284, 28)],
  ])
  const ctx = { newId: ids(), geo }
  const go = (from, dir) => run(start, [{ type: 'select', id: from }, { type: 'navigate', dir }], ctx)
  assert.equal(go('a1', 'down').state.selectedId, 'a2')
  assert.equal(go('a2', 'down').state.selectedId, 'a2')
  assert.equal(go('a2', 'up').state.selectedId, 'a1')
  assert.equal(go('b', 'up').state.selectedId, 'a')
  assert.equal(go('a', 'right').state.selectedId, 'a1')
  assert.equal(go('a', 'right').save, null)
  const unfold = go('b', 'right')
  assert.equal(tree.findNode(unfold.state.tree, 'b').collapsed, false)
  assert.equal(unfold.state.selectedId, 'b')
  assert.equal(unfold.state.history.past.length, 0)
  assert.equal(unfold.save, 'later')
  assert.equal(go('c', 'right').state.selectedId, 'c')
  assert.equal(go('a1', 'left').state.selectedId, 'a')
  assert.equal(go('r', 'left').state.selectedId, 'r')
  const blind = run(start, [{ type: 'navigate', dir: 'down' }])
  assert.equal(blind.state.selectedId, 'a1')
  assert.equal(run(start, [{ type: 'select', id: 'a' }, { type: 'navigate', dir: 'right' }]).state.selectedId, 'a')
})

test('순서 바꾸기는 끝에서 아무것도 하지 않는다', () => {
  const end = run(start, [{ type: 'reorder', step: -1 }])
  assert.equal(end.state, start)
  assert.equal(end.save, null)
  const moved = run(start, [{ type: 'reorder', step: 1 }])
  assert.deepEqual(childIds(moved.state, 'a'), ['a2', 'a1'])
  assert.equal(moved.state.selectedId, 'a1')
  assert.equal(moved.state.history.past.length, 1)
  assert.equal(moved.save, 'later')
})

test('쓰는 중 단추를 누르면 먼저 확정한다', () => {
  const { state, save } = run(start, [
    { type: 'startEdit', id: 'a1' },
    { type: 'input', text: 'xx' },
    { type: 'toggleCheckbox' },
  ])
  assert.equal(text(state, 'a1'), 'xx')
  assert.equal(tree.findNode(state.tree, 'a1').check, 'OPEN')
  assert.equal(state.editing, null)
  assert.equal(save, 'now')
})

test('쓰는 중 다른 가지를 누르면 확정하고 그 가지를 고른다', () => {
  const { state, save } = run(start, [{ type: 'addChild' }, { type: 'input', text: 'zz' }, { type: 'select', id: 'c' }])
  assert.equal(text(state, 'n1'), 'zz')
  assert.equal(state.selectedId, 'c')
  assert.equal(state.editing, null)
  assert.equal(save, 'now')
})

test('쓰는 중 글이 너무 길면 다른 명령을 하지 않고 알린다', () => {
  const editing = run(start, [{ type: 'startEdit' }, { type: 'input', text: 'x'.repeat(101) }]).state
  const { state, save, notice } = run(editing, [{ type: 'select', id: 'c' }])
  assert.equal(state.selectedId, 'a1')
  assert.equal(state.editing.id, 'a1')
  assert.equal(notice, '글은 100자까지 쓸 수 있어요.')
  assert.equal(save, null)
})

test('쓰던 새 가지에서 지우기를 누르면 그 가지만 없어진다', () => {
  for (const typed of ['', '새 글']) {
    const editing = run(start, [{ type: 'select', id: 'a' }, { type: 'addChild' }, { type: 'input', text: typed }]).state
    const { state, save } = run(editing, [{ type: 'delete' }])
    assert.equal(tree.findNode(state.tree, 'n1'), null)
    assert.deepEqual(childIds(state, 'a'), ['a1', 'a2'])
    assert.deepEqual(plain(state.tree), plain(map))
    assert.equal(state.selectedId, 'a')
    assert.equal(state.editing, null)
    assert.equal(state.history.past.length, 0)
    assert.equal(save, null)
  }
})

const onNewBranch = [
  { type: 'toggleCheck' },
  { type: 'toggleCheck', id: 'n1' },
  { type: 'toggleCheckbox' },
  { type: 'toggleCollapse' },
  { type: 'toggleCollapse', id: 'n1' },
]

test('빈 새 가지에서 체크·접기를 누르면 취소하고 다른 가지는 그대로다', () => {
  const editing = run(start, [{ type: 'select', id: 'a' }, { type: 'addChild' }]).state
  for (const command of onNewBranch) {
    const { state, save } = run(editing, [{ type: 'input', text: ' \t' }, command])
    assert.deepEqual(plain(state.tree), plain(map), command.type)
    assert.equal(state.selectedId, 'a')
    assert.equal(state.editing, null)
    assert.equal(state.history.past.length, 0)
    assert.equal(save, null)
  }
})

test('글을 쓴 새 가지에서 체크를 누르면 확정하고 그 가지에 체크박스를 붙인다', () => {
  const editing = run(start, [{ type: 'select', id: 'a' }, { type: 'addChild' }, { type: 'input', text: ' 새  글 ' }]).state
  for (const command of onNewBranch) {
    const { state, save } = run(editing, [command])
    const branch = tree.findNode(state.tree, 'n1')
    assert.equal(branch.text, '새 글', command.type)
    assert.equal(branch.check, command.type === 'toggleCollapse' ? 'NONE' : 'OPEN')
    assert.equal(tree.findNode(state.tree, 'a').check, 'NONE')
    assert.deepEqual(childIds(state, 'a'), ['a1', 'a2', 'n1'])
    assert.equal(state.selectedId, 'n1')
    assert.equal(state.editing, null)
    assert.equal(save, 'now')
  }
  const undone = run(editing, [{ type: 'toggleCheckbox' }, { type: 'undo' }]).state
  assert.equal(tree.findNode(undone.tree, 'n1').check, 'NONE', '체크를 되돌리면 확정한 글이 남는다')
  const other = run(editing, [{ type: 'toggleCheck', id: 'c' }]).state
  assert.equal(text(other, 'n1'), '새 글')
  assert.equal(tree.findNode(other.tree, 'c').check, 'OPEN')
  const removed = run(editing, [{ type: 'delete' }]).state
  assert.deepEqual(plain(removed.tree), plain(map), '지우기는 글이 있어도 그 새 가지만 없앤다')
})

test('다시 읽은 맵으로 바꾸면 기록을 비우고 선택을 지킨다', () => {
  const busy = run(start, [{ type: 'reorder', step: 1 }, { type: 'startEdit' }, { type: 'input', text: 'q' }]).state
  const newLimits = { ...limits, maxBranches: 9 }
  const same = editor.replaceFromServer(busy, { root: map, cursorNodeId: 'c', limits: newLimits })
  assert.equal(same.selectedId, 'a1')
  assert.equal(same.history.past.length, 0)
  assert.equal(same.history.future.length, 0)
  assert.equal(same.editing, null)
  assert.equal(same.tree, map)
  assert.equal(same.limits.maxBranches, 9)
  const without = tree.removeNode(map, 'a1').root
  assert.equal(editor.replaceFromServer(busy, { root: without, cursorNodeId: 'c', limits }).selectedId, 'c')
  const folded = tree.updateNode(map, 'a', (x) => ({ ...x, collapsed: true }))
  assert.equal(editor.replaceFromServer(busy, { root: folded, cursorNodeId: 'c', limits }).selectedId, 'a')
})

test('처음 상태는 보이는 기억한 가지를 고르고 기록이 비었다', () => {
  assert.equal(start.selectedId, 'a1')
  assert.equal(start.editing, null)
  assert.deepEqual(plain(start.history), { past: [], future: [] })
  assert.equal(editor.initialEditor({ root: map, cursorNodeId: 'b1', limits }).selectedId, 'b')
  assert.equal(editor.initialEditor({ root: map, cursorNodeId: 'zz', limits }).selectedId, 'r')
})

test('단추 줄: 주제에서는 삭제·체크박스를, 자식이 없으면 접기를, 기록이 없으면 되돌리기를 막는다', () => {
  const atRoot = editor.actionState(run(start, [{ type: 'select', id: 'r' }]).state)
  assert.deepEqual(plain(atRoot), {
    count: 0,
    canDelete: false,
    canCopy: true,
    canPaste: false,
    canCheckbox: false,
    hasCheckbox: false,
    canCollapse: true,
    collapsed: false,
    canUndo: false,
  })
  const leaf = run(start, [{ type: 'select', id: 'c' }, { type: 'toggleCheckbox' }]).state
  assert.deepEqual(plain(editor.actionState(leaf)), {
    count: 1,
    canDelete: true,
    canCopy: true,
    canPaste: false,
    canCheckbox: true,
    hasCheckbox: true,
    canCollapse: false,
    collapsed: false,
    canUndo: true,
  })
  const folded = editor.actionState(run(start, [{ type: 'select', id: 'b' }]).state)
  assert.equal(folded.collapsed, true)
  assert.equal(folded.canCollapse, true)
})

test('같은 부모의 같은 자리로 놓으면 바뀐 것이 없어 기록·저장하지 않는다', () => {
  for (const drop of [
    { targetId: 'a2', mode: 'before' },
    { targetId: 'a1', mode: 'before' },
  ]) {
    const result = run(start, [{ type: 'drop', draggedId: 'a1', drop }])
    assert.equal(result.state.tree, start.tree, JSON.stringify(drop))
    assert.equal(result.save, null)
    assert.equal(result.state.history.past.length, 0)
  }
  const sameEnd = run(start, [{ type: 'drop', draggedId: 'c', drop: { targetId: 'b', mode: 'after' } }])
  assert.equal(sameEnd.save, null)
  assert.equal(sameEnd.state.history.past.length, 0)
  const moved = run(start, [{ type: 'drop', draggedId: 'a1', drop: { targetId: 'a2', mode: 'after' } }])
  assert.equal(moved.save, 'later')
  assert.deepEqual(childIds(moved.state, 'a'), ['a2', 'a1'])
})

const sel = (state) => plain(state.selection)

test('selectMany는 여러 가지를 고르고 저장하지 않는다', () => {
  const { state, save } = run(start, [{ type: 'select', id: 'a2' }, { type: 'selectMany', ids: ['a', 'a1', 'c'], additive: false }])
  assert.deepEqual(sel(state).sort(), ['a', 'a1', 'c'])
  assert.equal(state.selectedId, 'a', '주 가지가 결과에 없으면 깊이 우선 첫 가지')
  assert.equal(save, null)
  const kept = run(start, [{ type: 'select', id: 'c' }, { type: 'selectMany', ids: ['a', 'c'], additive: false }]).state
  assert.equal(kept.selectedId, 'c', '주 가지가 결과에 있으면 그대로')
  const added = run(state, [{ type: 'selectMany', ids: ['b'], additive: true }]).state
  assert.deepEqual(sel(added).sort(), ['a', 'a1', 'b', 'c'])
  const empty = run(state, [{ type: 'selectMany', ids: [], additive: false }]).state
  assert.deepEqual(sel(empty), ['a'])
})

test('toggleSelect는 더하고 빼며 마지막 하나는 빼지 않는다', () => {
  const one = run(start, [{ type: 'select', id: 'a' }]).state
  const two = run(one, [{ type: 'toggleSelect', id: 'c' }]).state
  assert.deepEqual(sel(two).sort(), ['a', 'c'])
  assert.equal(two.selectedId, 'c')
  const back = run(two, [{ type: 'toggleSelect', id: 'c' }]).state
  assert.deepEqual(sel(back), ['a'])
  assert.equal(back.selectedId, 'a')
  const still = run(back, [{ type: 'toggleSelect', id: 'a' }]).state
  assert.deepEqual(sel(still), ['a'])
})

test('여러 가지를 고른 채 놓으면 함께 옮기고 되돌리기 한 번이면 돌아온다', () => {
  const picked = run(start, [{ type: 'selectMany', ids: ['a2', 'c'], additive: false }]).state
  const { state, save } = run(picked, [{ type: 'drop', draggedId: 'c', drop: { targetId: 'b', mode: 'child' } }])
  assert.deepEqual(childIds(state, 'b'), ['b1', 'a2', 'c'])
  assert.equal(save, 'later')
  assert.equal(state.history.past.length, 1)
  assert.equal(state.selectedId, 'c')
  assert.deepEqual(sel(state).sort(), ['a2', 'c'])
  const undone = run(state, [{ type: 'undo' }]).state
  assert.deepEqual(childIds(undone, 'a'), ['a1', 'a2'])
  assert.deepEqual(childIds(undone, 'r'), ['a', 'b', 'c'])
  assert.deepEqual(childIds(undone, 'b'), ['b1'])
  assert.equal(undone.history.past.length, 0)
  assert.deepEqual(sel(undone), [undone.selectedId])
})

test('고르지 않은 가지를 놓으면 그 가지만 옮긴다', () => {
  const picked = run(start, [{ type: 'selectMany', ids: ['a2', 'c'], additive: false }]).state
  const { state } = run(picked, [{ type: 'drop', draggedId: 'a1', drop: { targetId: 'b', mode: 'child' } }])
  assert.deepEqual(childIds(state, 'b'), ['b1', 'a1'])
  assert.deepEqual(childIds(state, 'r'), ['a', 'b', 'c'])
})

test('함께 옮길 때 하나라도 깊이 한도를 넘으면 하나도 옮기지 않는다', () => {
  const shallow = { ...start, limits: { ...limits, maxDepth: 2 } }
  const picked = run(shallow, [{ type: 'selectMany', ids: ['a', 'c'], additive: false }]).state
  const result = run(picked, [{ type: 'drop', draggedId: 'c', drop: { targetId: 'b1', mode: 'before' } }])
  assert.equal(result.notice, '가지는 주제 아래 2단계까지 만들 수 있어요.')
  assert.equal(result.state.tree, picked.tree)
  assert.equal(result.save, null)
})

test('여러 가지를 지우면 한 번에 지우고 기록 하나다', () => {
  const picked = run(start, [{ type: 'selectMany', ids: ['a', 'a1', 'c'], additive: false }]).state
  const { state, save } = run(picked, [{ type: 'delete' }])
  assert.equal(tree.findNode(state.tree, 'a'), null)
  assert.equal(tree.findNode(state.tree, 'c'), null)
  assert.equal(state.history.past.length, 1)
  assert.equal(save, 'later')
  assert.deepEqual(sel(state), [state.selectedId])
  assert.ok(tree.findNode(state.tree, state.selectedId))
  const cut = run(picked, [{ type: 'cut' }]).state
  assert.equal(cut.clipboard.nodes.length, 2)
  assert.equal(tree.findNode(cut.tree, 'c'), null)
})

test('여러 가지를 복사하면 위 가지만 담고 주제가 있으면 주제 하나다', () => {
  const picked = run(start, [{ type: 'selectMany', ids: ['a', 'a1', 'c'], additive: false }]).state
  const copied = run(picked, [{ type: 'copy' }])
  assert.equal(copied.state.clipboard.nodes.length, 2)
  assert.equal(copied.notice, '가지 2개를 복사했어요.')
  const withRoot = run(start, [{ type: 'selectMany', ids: ['r', 'a'], additive: false }, { type: 'copy' }]).state
  assert.equal(withRoot.clipboard.nodes.length, 1)
  assert.equal(withRoot.clipboard.nodes[0].text, 'r')
})

test('다른 명령은 주 가지 하나로 줄인 뒤 한다', () => {
  const picked = run(start, [{ type: 'selectMany', ids: ['a', 'c'], additive: false }]).state
  for (const command of [{ type: 'navigate', dir: 'left' }, { type: 'addChild' }, { type: 'single' }, { type: 'toggleCheck' }]) {
    const { state } = run(picked, [command])
    assert.equal(state.selection.length, 1, JSON.stringify(command))
    assert.equal(state.selection[0], state.selectedId)
  }
})

test('접어서 안 보이게 된 가지는 고른 목록에서 빠진다', () => {
  const picked = run(start, [{ type: 'selectMany', ids: ['a', 'a1'], additive: false }]).state
  const { state } = run(picked, [{ type: 'toggleCollapse', id: 'a' }])
  assert.deepEqual(sel(state), ['a'])
})

test('select keep은 고른 목록을 두고 주 가지만 바꾼다', () => {
  const picked = run(start, [{ type: 'selectMany', ids: ['a', 'c'], additive: false }]).state
  const kept = run(picked, [{ type: 'select', id: 'c', keep: true }]).state
  assert.deepEqual(sel(kept).sort(), ['a', 'c'])
  assert.equal(kept.selectedId, 'c')
  const other = run(picked, [{ type: 'select', id: 'b', keep: true }]).state
  assert.deepEqual(sel(other), ['b'])
  const plainSelect = run(picked, [{ type: 'select', id: 'c' }]).state
  assert.deepEqual(sel(plainSelect), ['c'])
})

test('여러 가지를 고르면 단추 줄 상태가 고른 수를 센다', () => {
  const picked = run(start, [{ type: 'selectMany', ids: ['r', 'a', 'a1', 'c'], additive: false }]).state
  const can = editor.actionState(picked)
  assert.equal(can.count, 2)
  assert.equal(can.canDelete, true)
  assert.equal(editor.actionState(run(start, [{ type: 'select', id: 'r' }]).state).count, 0)
})

test('changesSelection은 고른 것을 바꾸지 않는 누르기를 가린다', () => {
  const one = run(start, [{ type: 'select', id: 'a' }]).state
  assert.equal(editor.changesSelection(one, { type: 'single' }), false)
  assert.equal(editor.changesSelection(one, { type: 'toggleSelect', id: 'a' }), false, '하나뿐인 가지는 빼지 않는다')
  assert.equal(editor.changesSelection(one, { type: 'toggleSelect', id: 'c' }), true)
  const two = run(one, [{ type: 'toggleSelect', id: 'c' }]).state
  assert.equal(editor.changesSelection(two, { type: 'single' }), true)
  assert.equal(editor.changesSelection(two, { type: 'selectMany', ids: ['a', 'c'], additive: false }), false)
})
