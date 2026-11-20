import type { Box } from './editor'
import type { MindMapNode } from './tree'

export type Size = { w: number; h: number }
/** toId가 null이면 접힌 가지 옆의 짧은 선이다. */
export type Edge = { fromId: string; toId: string | null; d: string; color: number | null }
export type VisibleNode = { id: string; depth: number; color: number | null; index: number; siblings: number }
export type MapLayout = {
  nodes: VisibleNode[]
  boxes: Map<string, Box>
  edges: Edge[]
  bounds: { x0: number; y0: number; w: number; h: number }
}

export const LAYOUT = {
  H_GAP: 52,
  JOIN: 24,
  ROOT_CHILD_GAP: 26,
  CHILD_GAP: 8,
  CORNER: 10,
  STUB: 15,
  /** 접힌 가지의 숫자 단추 최소 폭(짧은 선 끝에 붙는다). */
  TOGGLE: 18,
  STROKE: 1.75,
  BRANCH_COLORS: 5,
} as const

const NO_SIZE: Size = { w: 0, h: 0 }

const shownChildren = (node: MindMapNode): MindMapNode[] => (node.collapsed ? [] : node.children)
const gapAt = (depth: number): number => (depth === 0 ? LAYOUT.ROOT_CHILD_GAP : LAYOUT.CHILD_GAP)

/** 깊이 우선 순서로, 접힌 가지의 아래는 뺀 보이는 가지들. */
export const visibleNodes = (root: MindMapNode): VisibleNode[] => {
  const out: VisibleNode[] = []
  const walk = (node: MindMapNode, depth: number, color: number | null, index: number, siblings: number) => {
    out.push({ id: node.id, depth, color, index, siblings })
    const kids = shownChildren(node)
    kids.forEach((child, i) => {
      const childColor = depth === 0 ? i % LAYOUT.BRANCH_COLORS : color
      walk(child, depth + 1, childColor, i + 1, kids.length)
    })
  }
  walk(root, 0, null, 1, 1)
  return out
}

type Metrics = { w: number; h: number; ch: number; sh: number }

export const layoutMap = (root: MindMapNode, sizes: ReadonlyMap<string, Size>): MapLayout => {
  const nodes = visibleNodes(root)
  const colorOf = new Map(nodes.map((v) => [v.id, v.color]))
  const metrics = new Map<string, Metrics>()

  const measure = (node: MindMapNode, depth: number): Metrics => {
    const { w, h } = sizes.get(node.id) ?? NO_SIZE
    let ch = 0
    shownChildren(node).forEach((child, i) => {
      ch += measure(child, depth + 1).sh + (i > 0 ? gapAt(depth) : 0)
    })
    const m = { w, h, ch, sh: Math.max(h, ch) }
    metrics.set(node.id, m)
    return m
  }
  measure(root, 0)

  const boxes = new Map<string, Box>()
  const place = (node: MindMapNode, depth: number, x: number, top: number): void => {
    const m = metrics.get(node.id) as Metrics
    boxes.set(node.id, { x, y: top + (m.sh - m.h) / 2, w: m.w, h: m.h })
    let y = top + (m.sh - m.ch) / 2
    for (const child of shownChildren(node)) {
      place(child, depth + 1, x + m.w + LAYOUT.H_GAP, y)
      y += (metrics.get(child.id) as Metrics).sh + gapAt(depth)
    }
  }
  place(root, 0, 0, 0)

  const edges: Edge[] = []
  const draw = (node: MindMapNode): void => {
    const box = boxes.get(node.id) as Box
    const x1 = box.x + box.w
    const y1 = box.y + box.h / 2
    const mx = x1 + LAYOUT.JOIN
    if (node.collapsed && node.children.length > 0) {
      edges.push({ fromId: node.id, toId: null, d: `M${x1},${y1}H${x1 + LAYOUT.STUB}`, color: colorOf.get(node.id) ?? null })
    }
    for (const child of shownChildren(node)) {
      const cb = boxes.get(child.id) as Box
      const x2 = cb.x
      const y2 = cb.y + cb.h / 2
      const dy = y2 - y1
      let d = `M${x1},${y1}H${mx}`
      if (Math.abs(dy) < 1) d += `H${x2}`
      else {
        const r = Math.min(LAYOUT.CORNER, Math.abs(dy) / 2)
        const s = Math.sign(dy)
        d += `V${y2 - s * r}Q${mx},${y2} ${mx + r},${y2}H${x2}`
      }
      edges.push({ fromId: node.id, toId: child.id, d, color: colorOf.get(child.id) ?? null })
      draw(child)
    }
  }
  draw(root)

  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const b of boxes.values()) {
    x0 = Math.min(x0, b.x)
    y0 = Math.min(y0, b.y)
    x1 = Math.max(x1, b.x + b.w)
    y1 = Math.max(y1, b.y + b.h)
  }
  return { nodes, boxes, edges, bounds: { x0, y0, w: x1 - x0, h: y1 - y0 } }
}

/** 화면에 그린 것 전체의 경계: 가지 상자에 선 굵기의 절반과 접힌 가지의 짧은 선·숫자 단추를 더한다. */
export const drawnBounds = (layout: MapLayout): MapLayout['bounds'] => {
  const half = LAYOUT.STROKE / 2
  let right = layout.bounds.x0 + layout.bounds.w
  for (const edge of layout.edges) {
    if (edge.toId !== null) continue
    const box = layout.boxes.get(edge.fromId) as Box
    right = Math.max(right, box.x + box.w + LAYOUT.STUB + LAYOUT.TOGGLE)
  }
  const { x0, y0, h } = layout.bounds
  return { x0: x0 - half, y0: y0 - half, w: right - x0 + 2 * half, h: h + 2 * half }
}
