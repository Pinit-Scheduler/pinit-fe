import { clipboardOf, clipboardOfNodes, clipCount, clipHeight, pasteSource, plant } from './clipboard'
import type { Clipboard } from './clipboard'
import { emptyHistory, record, redo as redoHistory, undo as undoHistory } from './history'
import type { History, Snapshot } from './history'
import { normalizeText, textLength } from './text'
import {
  addChild,
  addSiblingAfter,
  applyDropMany,
  depthOf,
  findNode,
  moveAmongSiblings,
  newNode,
  nextCheck,
  parentOf,
  pathTo,
  preorder,
  removeNode,
  subtreeHeight,
  toggledCheckbox,
  topmostBranches,
  totalNodes,
  updateNode,
  visibleAnchor,
  withCollapseFrom,
} from './tree'
import type { CheckState, Drop, MindMapNode } from './tree'

export type Box = { x: number; y: number; w: number; h: number }
export type Limits = { maxBranches: number; maxTextLength: number; maxDepth: number }
/** from: 새 가지를 만들기 전의 선택 */
export type Editing = { id: string; isNew: boolean; original: string; from: string }
export type EditorState = {
  tree: MindMapNode
  /** 주 가지. 커서 저장·화면 따라가기·키보드가 이 가지를 기준으로 한다. */
  selectedId: string
  /** 고른 가지들. 늘 `selectedId`를 담고, 하나만 골랐으면 `[selectedId]`다. */
  selection: string[]
  editing: Editing | null
  history: History
  limits: Limits
  /** 잘라내거나 복사한 가지. 되돌리기 기록에 들지 않고, 서버에서 다시 받아도 남는다. */
  clipboard: Clipboard | null
}
export type EditorCommand =
  /** `keep`이고 이미 고른 가지면 고른 목록을 두고 주 가지만 바꾼다. */
  | { type: 'select'; id: string; keep?: boolean }
  /** 고른 목록에 더하거나 뺀다(`Shift`·`Ctrl`/`⌘`+누르기). */
  | { type: 'toggleSelect'; id: string }
  /** 범위 사각형으로 고른다. `additive`면 지금 목록에 더한다. */
  | { type: 'selectMany'; ids: string[]; additive: boolean }
  /** 주 가지 하나만 남긴다(`Esc`). */
  | { type: 'single' }
  | { type: 'addChild' }
  | { type: 'addSibling' }
  | { type: 'startEdit'; id?: string }
  | { type: 'input'; text: string }
  | { type: 'commit' }
  | { type: 'commitAndAddChild' }
  | { type: 'cancel' }
  | { type: 'delete' }
  | { type: 'navigate'; dir: 'left' | 'right' | 'up' | 'down' }
  | { type: 'reorder'; step: -1 | 1 }
  | { type: 'toggleCollapse'; id?: string }
  | { type: 'toggleCheck'; id?: string }
  | { type: 'toggleCheckbox' }
  | { type: 'drop'; draggedId: string; drop: Drop }
  | { type: 'copy' }
  | { type: 'cut' }
  /** `text`는 시스템 클립보드의 글이다. 없으면 화면이 복사해 둔 가지를 붙인다. */
  | { type: 'paste'; text?: string }
  | { type: 'undo' }
  | { type: 'redo' }
export type SaveTiming = 'now' | 'later' | null
export type EditorResult = { state: EditorState; save: SaveTiming; notice: string | null }
export type EditorContext = { newId: () => string; geo?: ReadonlyMap<string, Box> }
type ServerMap = { root: MindMapNode; cursorNodeId: string; limits: Limits }

const result = (state: EditorState, save: SaveTiming = null, notice: string | null = null): EditorResult => ({
  state,
  save,
  notice,
})

/** 앞의 결과 뒤에 이은 결과. 저장은 `now`가 이긴다. */
const chain = (first: EditorResult, second: EditorResult): EditorResult => ({
  state: second.state,
  save: first.save === 'now' || second.save === 'now' ? 'now' : (first.save ?? second.save),
  notice: second.notice ?? first.notice,
})

const branchesNotice = (limits: Limits) => `가지는 ${limits.maxBranches}개까지 만들 수 있어요.`
const depthNotice = (limits: Limits) => `가지는 주제 아래 ${limits.maxDepth}단계까지 만들 수 있어요.`
export const textNotice = (limits: Limits) => `글은 ${limits.maxTextLength}자까지 쓸 수 있어요.`

const snapshotOf = (state: EditorState): Snapshot => ({ tree: state.tree, selectedId: state.selectedId })
const recorded = (state: EditorState): EditorState => ({
  ...state,
  history: record(state.history, snapshotOf(state)),
})
const withText = (root: MindMapNode, id: string, text: string): MindMapNode =>
  updateNode(root, id, (node) => ({ ...node, text }))
const selected = (state: EditorState, id: string): EditorState =>
  id === state.selectedId ? state : { ...state, selectedId: id }

const select = (state: EditorState, id: string, keep = false): EditorResult => {
  if (!findNode(state.tree, id)) return result(state)
  if (keep && state.selection.includes(id)) return result(selected(state, id))
  return result({ ...selected(state, id), selection: [id] })
}

const toggleSelect = (state: EditorState, id: string): EditorResult => {
  if (!findNode(state.tree, id)) return result(state)
  if (!state.selection.includes(id)) return result({ ...state, selectedId: id, selection: [...state.selection, id] })
  if (state.selection.length === 1) return result(state)
  const selection = state.selection.filter((x) => x !== id)
  return result({ ...state, selection, selectedId: id === state.selectedId ? selection[selection.length - 1] : state.selectedId })
}

/** 주 가지가 결과 안에 있으면 그대로, 없으면 깊이 우선 첫 가지가 주 가지다. 결과가 비면 주 가지 하나다. */
const selectMany = (state: EditorState, ids: readonly string[], additive: boolean): EditorResult => {
  const wanted = new Set(additive ? [...state.selection, ...ids] : ids)
  const selection = preorder(state.tree).filter((id) => wanted.has(id))
  if (selection.length === 0) return result({ ...state, selection: [state.selectedId] })
  const selectedId = selection.includes(state.selectedId) ? state.selectedId : selection[0]
  const same =
    selectedId === state.selectedId &&
    selection.length === state.selection.length &&
    selection.every((id) => state.selection.includes(id))
  return result(same ? state : { ...state, selectedId, selection })
}

/** 여러 가지를 골랐으면 함께 다룰 위 가지들, 아니면 `null`. */
const pickedBranches = (state: EditorState): string[] | null =>
  state.selection.length > 1 ? topmostBranches(state.tree, state.selection) : null

/** 가지들을 차례로 지운다. 고를 가지는 마지막으로 지운 가지 옆이고, 그 가지가 없으면 주제다. */
const removeAll = (root: MindMapNode, ids: readonly string[]): { root: MindMapNode; nextId: string } => {
  let tree = root
  let nextId = root.id
  for (const id of ids) {
    const removed = removeNode(tree, id)
    if (!removed) continue
    tree = removed.root
    nextId = removed.nextId
  }
  return { root: tree, nextId: findNode(tree, nextId) ? nextId : tree.id }
}

const createBranch = (
  state: EditorState,
  ctx: EditorContext,
  depth: number,
  place: (root: MindMapNode, node: MindMapNode) => MindMapNode,
): EditorResult => {
  if (totalNodes(state.tree) >= state.limits.maxBranches) return result(state, null, branchesNotice(state.limits))
  if (depth > state.limits.maxDepth) return result(state, null, depthNotice(state.limits))
  const id = ctx.newId()
  return result({
    ...state,
    tree: place(state.tree, newNode(id)),
    selectedId: id,
    editing: { id, isNew: true, original: '', from: state.selectedId },
  })
}

const addChildBranch = (state: EditorState, ctx: EditorContext): EditorResult =>
  createBranch(state, ctx, depthOf(state.tree, state.selectedId) + 1, (root, node) =>
    addChild(root, state.selectedId, node),
  )

/** 주제에서는 하위 가지다. */
const addSiblingBranch = (state: EditorState, ctx: EditorContext): EditorResult =>
  createBranch(state, ctx, Math.max(1, depthOf(state.tree, state.selectedId)), (root, node) =>
    addSiblingAfter(root, state.selectedId, node),
  )

const startEdit = (state: EditorState, id: string = state.selectedId): EditorResult => {
  const node = findNode(state.tree, id)
  if (!node) return result(state)
  return result({
    ...selected(state, id),
    editing: { id, isNew: false, original: node.text, from: state.selectedId },
  })
}

const input = (state: EditorState, text: string): EditorResult =>
  result(state.editing ? { ...state, tree: withText(state.tree, state.editing.id, text) } : state)

/** 새 가지는 없애고 선택을 돌리며, 기존 가지는 원래 글로 둔다. 기록은 쓰기 전 그대로다. */
const discard = (state: EditorState, editing: Editing): EditorState => ({
  ...state,
  tree: confirmedTree(state),
  selectedId: editing.isNew ? editing.from : state.selectedId,
  editing: null,
})

const commit = (state: EditorState): EditorResult => {
  const { editing } = state
  if (!editing) return result(state)
  const text = normalizeText(findNode(state.tree, editing.id)?.text ?? '')
  if (text === '') return result(discard(state, editing))
  if (textLength(text) > state.limits.maxTextLength) return result(state, null, textNotice(state.limits))
  const tree = withText(state.tree, editing.id, text)
  if (!editing.isNew && text === editing.original) return result({ ...state, tree, editing: null })
  // 쓰기 전의 나무(확정된 나무)를 바꾼 확정에서만 기록한다. 기존 가지면 그 가지를 고른 채로 되살린다.
  const before: Snapshot = { tree: confirmedTree(state), selectedId: editing.isNew ? editing.from : editing.id }
  return result({ ...state, tree, editing: null, history: record(state.history, before) }, 'now')
}

const commitAndAddChild = (state: EditorState, ctx: EditorContext): EditorResult => {
  const { editing } = state
  if (!editing) return result(state)
  const committed = commit(state)
  if (committed.state.editing || !findNode(committed.state.tree, editing.id)) return committed
  return chain(committed, addChildBranch(selected(committed.state, editing.id), ctx))
}

const cancel = (state: EditorState): EditorResult =>
  result(state.editing ? discard(state, state.editing) : state)

const remove = (state: EditorState): EditorResult => {
  const picked = pickedBranches(state)
  if (picked) {
    if (picked.length === 0) return result(state)
    const removed = removeAll(state.tree, picked)
    return result({ ...recorded(state), tree: removed.root, selectedId: removed.nextId, selection: [removed.nextId] }, 'later')
  }
  const removed = removeNode(state.tree, state.selectedId)
  if (!removed) return result(state)
  return result({ ...recorded(state), tree: removed.root, selectedId: removed.nextId }, 'later')
}

const copy = (state: EditorState): EditorResult => {
  const picked = pickedBranches(state)
  if (picked && !state.selection.includes(state.tree.id) && picked.length > 1) {
    const nodes = picked.map((id) => findNode(state.tree, id)!)
    return result({ ...state, clipboard: clipboardOfNodes(nodes) }, null, `가지 ${nodes.length}개를 복사했어요.`)
  }
  if (picked && state.selection.includes(state.tree.id))
    return result({ ...state, clipboard: clipboardOf(state.tree) }, null, '가지를 복사했어요.')
  const only = picked?.length === 1 ? picked[0] : state.selectedId
  const node = findNode(state.tree, only)
  return node ? result({ ...state, clipboard: clipboardOf(node) }, null, '가지를 복사했어요.') : result(state)
}

/** 지우기와 같고 지운 가지를 클립보드에 둔다. 주제는 잘라내지 않는다. */
const cut = (state: EditorState): EditorResult => {
  const picked = pickedBranches(state)
  if (picked) {
    if (picked.length === 0) return result(state)
    const nodes = picked.map((id) => findNode(state.tree, id)!)
    const removed = removeAll(state.tree, picked)
    return result(
      {
        ...recorded(state),
        tree: removed.root,
        selectedId: removed.nextId,
        selection: [removed.nextId],
        clipboard: clipboardOfNodes(nodes),
      },
      'later',
    )
  }
  const node = findNode(state.tree, state.selectedId)
  const removed = removeNode(state.tree, state.selectedId)
  if (!node || !removed) return result(state)
  return result(
    { ...recorded(state), tree: removed.root, selectedId: removed.nextId, clipboard: clipboardOf(node) },
    'later',
  )
}

export const NOTHING_TO_PASTE = '붙여 넣을 가지가 없어요. 먼저 가지를 복사하거나 잘라내 주세요.'

/** 고른 가지의 마지막 하위 가지로 붙이고 붙인 첫 가지를 고른다. 한도를 넘으면 하나도 붙이지 않는다. */
const paste = (state: EditorState, ctx: EditorContext, text: string | undefined): EditorResult => {
  const source = pasteSource(state.clipboard, text, state.limits.maxTextLength)
  if (!source) return result(state, null, NOTHING_TO_PASTE)
  const count = source.nodes.reduce((sum, node) => sum + clipCount(node), 0)
  if (totalNodes(state.tree) + count > state.limits.maxBranches) return result(state, null, branchesNotice(state.limits))
  const height = source.nodes.reduce((max, node) => Math.max(max, clipHeight(node)), 0)
  if (depthOf(state.tree, state.selectedId) + 1 + height > state.limits.maxDepth)
    return result(state, null, depthNotice(state.limits))
  const planted = source.nodes.map((node) => plant(node, ctx.newId))
  const tree = planted.reduce((root, node) => addChild(root, state.selectedId, node), state.tree)
  return result(
    { ...recorded(state), tree, selectedId: planted[0].id },
    'later',
    source.clipped ? textNotice(state.limits) : null,
  )
}

const centre = (box: Box): number => box.y + box.h / 2

const nearestChild = (node: MindMapNode, geo: ReadonlyMap<string, Box>): string | null => {
  const own = geo.get(node.id)
  if (!own) return null
  let best: string | null = null
  let bestDistance = Infinity
  for (const child of node.children) {
    const box = geo.get(child.id)
    if (!box) continue
    const distance = Math.abs(centre(box) - centre(own))
    if (distance < bestDistance) {
      best = child.id
      bestDistance = distance
    }
  }
  return best
}

/** 화면에 있는 같은 깊이의 가지 가운데 위·아래 가지. */
const rowNeighbour = (
  state: EditorState,
  geo: ReadonlyMap<string, Box>,
  step: -1 | 1,
): string | null => {
  if (!geo.has(state.selectedId)) return null
  const depth = depthOf(state.tree, state.selectedId)
  const row = [...geo.keys()]
    .filter((id) => depthOf(state.tree, id) === depth)
    .sort((p, q) => geo.get(p)!.y - geo.get(q)!.y)
  return row[row.indexOf(state.selectedId) + step] ?? null
}

const navigate = (
  state: EditorState,
  dir: 'left' | 'right' | 'up' | 'down',
  geo: ReadonlyMap<string, Box> | undefined,
): EditorResult => {
  if (dir === 'left') {
    const parent = parentOf(state.tree, state.selectedId)
    return result(parent ? selected(state, parent.id) : state)
  }
  if (dir === 'right') {
    const node = findNode(state.tree, state.selectedId)
    if (!node || node.children.length === 0) return result(state)
    if (node.collapsed) return toggleCollapse(state, node.id)
    const child = geo ? nearestChild(node, geo) : null
    return result(child ? selected(state, child) : state)
  }
  const next = geo ? rowNeighbour(state, geo, dir === 'up' ? -1 : 1) : null
  return result(next ? selected(state, next) : state)
}

const reorder = (state: EditorState, step: -1 | 1): EditorResult => {
  const moved = moveAmongSiblings(state.tree, state.selectedId, step)
  return moved ? result({ ...recorded(state), tree: moved }, 'later') : result(state)
}

/** 기록하지 않는다. 접을 때 선택이 그 아래에 있으면 접은 가지를 고른다. */
const toggleCollapse = (state: EditorState, id: string = state.selectedId): EditorResult => {
  const node = findNode(state.tree, id)
  if (!node || node.children.length === 0) return result(state)
  const collapsed = !node.collapsed
  const inside = state.selectedId !== id && pathTo(state.tree, state.selectedId).includes(id)
  return result(
    {
      ...state,
      tree: updateNode(state.tree, id, (x) => ({ ...x, collapsed })),
      selectedId: collapsed && inside ? id : state.selectedId,
    },
    'later',
  )
}

const changeCheck = (
  state: EditorState,
  id: string = state.selectedId,
  change: (check: CheckState) => CheckState,
): EditorResult => {
  if (!findNode(state.tree, id)) return result(state)
  const chosen = selected(state, id)
  if (id === state.tree.id) return result(chosen)
  return result(
    { ...recorded(chosen), tree: updateNode(state.tree, id, (x) => ({ ...x, check: change(x.check) })) },
    'now',
  )
}

/** 부모 id와 그 안의 차례. */
const slotOf = (root: MindMapNode, id: string): string => {
  const parent = parentOf(root, id)
  return parent ? `${parent.id}#${parent.children.findIndex((child) => child.id === id)}` : ''
}

/**
 * 놓은 자리가 원래 자리(같은 부모, 같은 차례)면 바뀐 것이 없어 기록·저장하지 않는다.
 * 여러 가지를 고른 채 그 가운데 하나를 놓으면 고른 위 가지들을 함께 옮긴다. 하나라도 깊이 한도를 넘으면 하나도 옮기지 않는다.
 */
const drop = (state: EditorState, draggedId: string, target: Drop): EditorResult => {
  const together = state.selection.length > 1 && state.selection.includes(draggedId)
  const ids = together ? topmostBranches(state.tree, state.selection) : [draggedId]
  if (ids.length === 0) return result(state)
  const moved = applyDropMany(state.tree, ids, target)
  if (moved === state.tree || ids.every((id) => slotOf(moved, id) === slotOf(state.tree, id))) return result(state)
  const tooDeep = ids.some((id) => depthOf(moved, id) + subtreeHeight(findNode(moved, id)!) > state.limits.maxDepth)
  if (tooDeep) return result(state, null, depthNotice(state.limits))
  const selection = together ? state.selection : [draggedId]
  return result({ ...recorded(state), tree: moved, selectedId: draggedId, selection }, 'later')
}

/** 되살린 나무에서 지금 있는 가지의 접힘은 지금 값으로 둔다. */
const travel = (state: EditorState, step: typeof undoHistory): EditorResult => {
  const moved = step(state.history, snapshotOf(state))
  if (!moved) return result(state)
  const tree = withCollapseFrom(moved.snapshot.tree, state.tree)
  return result(
    { ...state, tree, selectedId: visibleAnchor(tree, moved.snapshot.selectedId), history: moved.history },
    'later',
  )
}

const apply = (state: EditorState, command: EditorCommand, ctx: EditorContext): EditorResult => {
  switch (command.type) {
    case 'select':
      return select(state, command.id, command.keep)
    case 'toggleSelect':
      return toggleSelect(state, command.id)
    case 'selectMany':
      return selectMany(state, command.ids, command.additive)
    case 'single':
      return result(state)
    case 'addChild':
      return addChildBranch(state, ctx)
    case 'addSibling':
      return addSiblingBranch(state, ctx)
    case 'startEdit':
      return startEdit(state, command.id)
    case 'input':
      return input(state, command.text)
    case 'commit':
      return commit(state)
    case 'commitAndAddChild':
      return commitAndAddChild(state, ctx)
    case 'cancel':
      return cancel(state)
    case 'delete':
      return remove(state)
    case 'navigate':
      return navigate(state, command.dir, ctx.geo)
    case 'reorder':
      return reorder(state, command.step)
    case 'toggleCollapse':
      return toggleCollapse(state, command.id)
    case 'toggleCheck':
      return changeCheck(state, command.id, nextCheck)
    case 'toggleCheckbox':
      return changeCheck(state, undefined, toggledCheckbox)
    case 'drop':
      return drop(state, command.draggedId, command.drop)
    case 'copy':
      return copy(state)
    case 'cut':
      return cut(state)
    case 'paste':
      return paste(state, ctx, command.text)
    case 'undo':
      return travel(state, undoHistory)
    case 'redo':
      return travel(state, redoHistory)
  }
}

const writing = new Set<EditorCommand['type']>(['input', 'commit', 'commitAndAddChild', 'cancel'])

/**
 * 처음 쓰는 새 가지에 하는 명령 가운데 취소로 끝나는 것: 지우기는 늘, 체크·접기·잘라내기·복사·붙여넣기는 글이 비었을 때.
 * 글이 있으면 체크·접기는 확정한 새 가지에 한다. 어느 쪽이든 이전 선택에는 하지 않는다.
 */
const cancelsNewBranch = (state: EditorState, editing: Editing, command: EditorCommand): boolean => {
  if (!editing.isNew) return false
  const blank = () => normalizeText(findNode(state.tree, editing.id)?.text ?? '') === ''
  switch (command.type) {
    case 'delete':
      return true
    case 'toggleCheckbox':
    case 'copy':
    case 'cut':
    case 'paste':
      return blank()
    case 'toggleCheck':
    case 'toggleCollapse':
      return (command.id === undefined || command.id === editing.id) && blank()
    default:
      return false
  }
}

export const initialEditor = (map: ServerMap): EditorState => single({
  tree: map.root,
  selectedId: visibleAnchor(map.root, map.cursorNodeId),
  selection: [],
  editing: null,
  history: emptyHistory(),
  limits: map.limits,
  clipboard: null,
})

export type ActionState = {
  /** 함께 다룰 가지 수(주제와 고른 가지의 아래는 세지 않는다). */
  count: number
  canDelete: boolean
  canCopy: boolean
  canPaste: boolean
  canCheckbox: boolean
  hasCheckbox: boolean
  canCollapse: boolean
  collapsed: boolean
  canUndo: boolean
}

/**
 * 동작 단추 줄이 고른 가지에 대해 보이는 상태: 주제는 지우거나 잘라내거나 체크박스를 붙이지 않고, 자식이 없으면 접지 않는다.
 * 붙이기 단추는 화면이 복사해 둔 가지가 있을 때만 쓴다(단축키는 시스템 클립보드의 글도 붙인다).
 */
export const actionState = (state: EditorState): ActionState => {
  const node = findNode(state.tree, state.selectedId)
  const isBranch = node !== null && node.id !== state.tree.id
  const count = topmostBranches(state.tree, state.selection).length
  return {
    count,
    canDelete: count > 0,
    canCopy: node !== null,
    canPaste: (state.clipboard?.nodes.length ?? 0) > 0,
    canCheckbox: isBranch,
    hasCheckbox: isBranch && node.check !== 'NONE',
    canCollapse: (node?.children.length ?? 0) > 0,
    collapsed: node?.collapsed === true,
    canUndo: state.history.past.length > 0,
  }
}

/** 고른 목록을 그대로 두고 다루는 명령. 그 밖의 명령은 주 가지 하나로 줄여 한다. */
const MULTI = new Set<EditorCommand['type']>(['select', 'toggleSelect', 'selectMany', 'drop', 'delete', 'cut', 'copy'])

const sameList = (p: readonly string[], q: readonly string[]) => p.length === q.length && p.every((x, i) => x === q[i])

/** 주 가지 하나만 고른 상태. */
const single = (state: EditorState): EditorState =>
  sameList(state.selection, [state.selectedId]) ? state : { ...state, selection: [state.selectedId] }

/** 없거나 접혀 안 보이는 가지는 고른 목록에서 빼고, 주 가지는 늘 넣는다. */
const tidySelection = (state: EditorState): EditorState => {
  const kept = state.selection.filter(
    (id) => id !== state.selectedId && findNode(state.tree, id) && visibleAnchor(state.tree, id) === id,
  )
  const selection = [...kept, state.selectedId]
  const same = selection.length === state.selection.length && selection.every((id) => state.selection.includes(id))
  return same ? state : { ...state, selection }
}

const step = (state: EditorState, command: EditorCommand, ctx: EditorContext): EditorResult => {
  if (!state.editing || writing.has(command.type)) return apply(state, command, ctx)
  if (cancelsNewBranch(state, state.editing, command)) return cancel(state)
  const committed = commit(state)
  if (committed.state.editing) return committed
  return chain(committed, apply(committed.state, command, ctx))
}

/**
 * 쓰는 중에 쓰기 밖의 명령이 오면 먼저 확정한다. 확정하지 못하면(글이 너무 길면) 그 명령은 하지 않는다.
 * 처음 쓰는 새 가지의 지우기와 빈 새 가지의 체크·접기는 취소다(없앤 뒤 이전 선택에 하지 않는다).
 * 여러 가지를 고른 목록은 `MULTI` 명령만 쓰고, 다른 명령 뒤에는 주 가지 하나로 돌아간다.
 */
export const reduce = (state: EditorState, command: EditorCommand, ctx: EditorContext): EditorResult => {
  const multi = MULTI.has(command.type)
  const done = step(multi ? state : single(state), command, ctx)
  const next = multi ? tidySelection(done.state) : single(done.state)
  return next === done.state ? done : { ...done, state: next }
}

/** 고르기 명령이 고른 가지(목록이나 주 가지)를 바꾸는지. 바꾸지 않으면 화면이 다시 그려지지 않는다. */
export const changesSelection = (state: EditorState, command: EditorCommand): boolean =>
  reduce(state, command, { newId: () => '' }).state !== state

/** 서버에 보낼 나무: 쓰는 가지는 마지막으로 확정한 글로 두고, 처음 쓰는 새 가지는 뺀다. */
export const confirmedTree = (state: EditorState): MindMapNode => {
  const { editing, tree } = state
  if (!editing) return tree
  if (editing.isNew) return removeNode(tree, editing.id)?.root ?? tree
  return withText(tree, editing.id, editing.original)
}

/** 쓰던 글을 확정한 것으로 친 확정된 나무. */
export const leaveTree = (state: EditorState): MindMapNode => confirmedTree(commit(state).state)

export const replaceFromServer = (state: EditorState, map: ServerMap): EditorState => single({
  tree: map.root,
  selectedId: visibleAnchor(
    map.root,
    findNode(map.root, state.selectedId) ? state.selectedId : map.cursorNodeId,
  ),
  selection: [],
  editing: null,
  history: emptyHistory(),
  limits: map.limits,
  clipboard: state.clipboard,
})
