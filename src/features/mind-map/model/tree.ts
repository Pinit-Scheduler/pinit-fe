export type CheckState = 'NONE' | 'OPEN' | 'DONE'

export type MindMapNode = {
  id: string
  text: string
  collapsed: boolean
  check: CheckState
  children: MindMapNode[]
}

export type DropMode = 'before' | 'after' | 'child'
export type Drop = { targetId: string; mode: DropMode }
export type MapCounts = { branches: number; leaves: number; todoDone: number; todoTotal: number }

export const newNode = (id: string): MindMapNode => ({
  id,
  text: '',
  collapsed: false,
  check: 'NONE',
  children: [],
})

export const findNode = (root: MindMapNode, id: string): MindMapNode | null => {
  if (root.id === id) return root
  for (const child of root.children) {
    const found = findNode(child, id)
    if (found) return found
  }
  return null
}

export const pathTo = (root: MindMapNode, id: string): string[] => {
  if (root.id === id) return [root.id]
  for (const child of root.children) {
    const rest = pathTo(child, id)
    if (rest.length > 0) return [root.id, ...rest]
  }
  return []
}

export const parentOf = (root: MindMapNode, id: string): MindMapNode | null => {
  const path = pathTo(root, id)
  return path.length < 2 ? null : findNode(root, path[path.length - 2])
}

export const depthOf = (root: MindMapNode, id: string): number => pathTo(root, id).length - 1

export const totalNodes = (node: MindMapNode): number =>
  node.children.reduce((sum, child) => sum + totalNodes(child), 1)

export const subtreeHeight = (node: MindMapNode): number =>
  node.children.reduce((max, child) => Math.max(max, subtreeHeight(child) + 1), 0)

export const hiddenCount = (node: MindMapNode): number => totalNodes(node) - 1

export const updateNode = (
  root: MindMapNode,
  id: string,
  change: (node: MindMapNode) => MindMapNode,
): MindMapNode => {
  if (root.id === id) return change(root)
  let changed = false
  const children = root.children.map((child) => {
    const next = updateNode(child, id, change)
    if (next !== child) changed = true
    return next
  })
  return changed ? { ...root, children } : root
}

export const addChild = (root: MindMapNode, parentId: string, node: MindMapNode): MindMapNode =>
  updateNode(root, parentId, (parent) => ({
    ...parent,
    collapsed: false,
    children: [...parent.children, node],
  }))

/** 주어진 가지의 자식 목록을 바꾼다. 부모가 없으면(주제) 바꾸지 않는다. */
const withSiblings = (
  root: MindMapNode,
  id: string,
  change: (siblings: MindMapNode[], index: number) => MindMapNode[],
): MindMapNode => {
  const parent = parentOf(root, id)
  if (!parent) return root
  return updateNode(root, parent.id, (p) => ({
    ...p,
    children: change(p.children, p.children.findIndex((child) => child.id === id)),
  }))
}

export const addSiblingAfter = (root: MindMapNode, id: string, node: MindMapNode): MindMapNode =>
  id === root.id
    ? addChild(root, id, node)
    : withSiblings(root, id, (siblings, i) => [...siblings.slice(0, i + 1), node, ...siblings.slice(i + 1)])

export const removeNode = (
  root: MindMapNode,
  id: string,
): { root: MindMapNode; nextId: string } | null => {
  const parent = parentOf(root, id)
  if (!parent) return null
  const i = parent.children.findIndex((child) => child.id === id)
  const next = (parent.children[i + 1] ?? parent.children[i - 1] ?? parent).id
  return {
    root: withSiblings(root, id, (siblings, index) => siblings.filter((_, k) => k !== index)),
    nextId: next,
  }
}

export const moveAmongSiblings = (
  root: MindMapNode,
  id: string,
  step: -1 | 1,
): MindMapNode | null => {
  const parent = parentOf(root, id)
  if (!parent) return null
  const i = parent.children.findIndex((child) => child.id === id)
  const j = i + step
  if (j < 0 || j >= parent.children.length) return null
  return withSiblings(root, id, (siblings) => {
    const list = [...siblings]
    ;[list[i], list[j]] = [list[j], list[i]]
    return list
  })
}

export const dropTarget = (
  root: MindMapNode,
  draggedId: string,
  targetId: string,
  fraction: number,
): Drop | null => {
  const dragged = findNode(root, draggedId)
  const dragParent = parentOf(root, draggedId)
  if (!dragged || !dragParent || !findNode(root, targetId)) return null
  if (findNode(dragged, targetId)) return null
  // 주제 위에서는 늘 자식이다. 이미 주제의 자식이면 놓을 수 없다.
  if (targetId === root.id) return dragParent.id === root.id ? null : { targetId, mode: 'child' }
  if (fraction < 1 / 3) return { targetId, mode: 'before' }
  if (fraction > 2 / 3) return { targetId, mode: 'after' }
  return dragParent.id === targetId ? null : { targetId, mode: 'child' }
}

export const applyDrop = (root: MindMapNode, draggedId: string, drop: Drop): MindMapNode => {
  const dragged = findNode(root, draggedId)
  if (!dragged || !parentOf(root, draggedId) || findNode(dragged, drop.targetId)) return root
  if (!findNode(root, drop.targetId)) return root
  if (drop.mode !== 'child' && !parentOf(root, drop.targetId)) return root
  const without = removeNode(root, draggedId)!.root
  if (drop.mode === 'child') return addChild(without, drop.targetId, dragged)
  return withSiblings(without, drop.targetId, (siblings, i) => {
    const at = drop.mode === 'after' ? i + 1 : i
    return [...siblings.slice(0, at), dragged, ...siblings.slice(at)]
  })
}

export const nextCheck = (check: CheckState): CheckState =>
  check === 'NONE' ? 'OPEN' : check === 'OPEN' ? 'DONE' : 'OPEN'

export const toggledCheckbox = (check: CheckState): CheckState => (check === 'NONE' ? 'OPEN' : 'NONE')

export const visibleAnchor = (root: MindMapNode, id: string): string => {
  const path = pathTo(root, id)
  if (path.length === 0) return root.id
  return path.find((step) => findNode(root, step)!.collapsed) ?? id
}

export const withCollapseFrom = (snapshot: MindMapNode, current: MindMapNode): MindMapNode => {
  const now = findNode(current, snapshot.id)
  return {
    ...snapshot,
    collapsed: now ? now.collapsed : snapshot.collapsed,
    children: snapshot.children.map((child) => withCollapseFrom(child, current)),
  }
}

export const countBranches = (root: MindMapNode): MapCounts => {
  const counts: MapCounts = { branches: 0, leaves: 0, todoDone: 0, todoTotal: 0 }
  const walk = (node: MindMapNode): void => {
    for (const child of node.children) {
      counts.branches += 1
      if (child.children.length === 0) counts.leaves += 1
      if (child.check !== 'NONE') counts.todoTotal += 1
      if (child.check === 'DONE') counts.todoDone += 1
      walk(child)
    }
  }
  walk(root)
  return counts
}

const ordered = (node: MindMapNode): MindMapNode => ({
  id: node.id,
  text: node.text,
  collapsed: node.collapsed,
  check: node.check,
  children: node.children.map(ordered),
})

export const treeJson = (root: MindMapNode): string => JSON.stringify(ordered(root))
