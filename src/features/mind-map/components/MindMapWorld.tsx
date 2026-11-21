import { useMemo } from 'react'
import type { CSSProperties } from 'react'
import type { Editing } from '../model/editor'
import type { MapLayout } from '../model/layout'
import type { MindMapNode } from '../model/tree'
import MindMapNodeView from './MindMapNodeView'

type Props = {
  root: MindMapNode
  layout: MapLayout
  selectedId: string | null
  /** 고른 가지들(편집 화면). 없으면 `selectedId` 하나만 고른 것으로 그린다. */
  selectedIds?: ReadonlySet<string>
  editing: Editing | null
  readOnly: boolean
  nodeRef?: (id: string, el: HTMLElement | null) => void
  onLabelInput?: (text: string) => void
  onCheckClick?: (id: string) => void
  onToggleClick?: (id: string) => void
  dropId?: string | null
  /** 화면 위치(transform)와 보이기는 부모가 정한다. */
  style?: CSSProperties
}

const byId = (root: MindMapNode): Map<string, MindMapNode> => {
  const out = new Map<string, MindMapNode>()
  const walk = (node: MindMapNode) => {
    out.set(node.id, node)
    node.children.forEach(walk)
  }
  walk(root)
  return out
}

const stroke = (color: number | null) =>
  color === null ? 'var(--workspace-muted)' : `var(--workspace-mind-map-branch-${color})`

/** 선과 가지들. 페이지는 편집하고, 홈 카드는 `readOnly`로 보여 주기만 한다. */
export default function MindMapWorld({
  root,
  layout,
  selectedId,
  selectedIds,
  editing,
  readOnly,
  nodeRef,
  onLabelInput,
  onCheckClick,
  onToggleClick,
  dropId = null,
  style,
}: Props) {
  const nodes = useMemo(() => byId(root), [root])
  // 선과 가지 목록은 내용이 바뀔 때만 다시 만든다. 화면 이동·확대나 범위 상자처럼 `style`만 바뀌는 그리기에서는
  // 가지 수만큼의 요소를 새로 만들지 않는다(끄는 동안 포인터 이동마다 그린다).
  const edges = useMemo(
    () =>
      layout.edges.map((edge) => (
        <path key={`${edge.fromId}>${edge.toId ?? ''}`} d={edge.d} style={{ stroke: stroke(edge.color) }} />
      )),
    [layout],
  )
  const branches = useMemo(
    () =>
      layout.nodes.map((place) => {
        const node = nodes.get(place.id)
        if (!node) return null
        return (
          <MindMapNodeView
            key={place.id}
            node={node}
            place={place}
            box={layout.boxes.get(place.id)}
            selected={selectedIds ? selectedIds.has(place.id) : place.id === selectedId}
            primary={(selectedIds?.size ?? 0) > 1 && place.id === selectedId}
            editing={!readOnly && editing?.id === place.id}
            readOnly={readOnly}
            dropTarget={place.id === dropId}
            nodeRef={nodeRef}
            onLabelInput={onLabelInput}
            onCheckClick={onCheckClick}
            onToggleClick={onToggleClick}
          />
        )
      }),
    [layout, nodes, selectedId, selectedIds, editing, readOnly, dropId, nodeRef, onLabelInput, onCheckClick, onToggleClick],
  )
  return (
    <div
      className={'mind-map-world' + (readOnly ? ' mind-map-world--readonly' : '')}
      style={style}
      aria-hidden={readOnly || undefined}
    >
      <svg className="mind-map-edges" aria-hidden="true">
        {edges}
      </svg>
      {branches}
    </div>
  )
}
