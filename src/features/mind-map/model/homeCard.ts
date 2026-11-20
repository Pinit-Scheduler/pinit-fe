import type { Box } from './editor'
import type { MapLayout } from './layout'
import { findNode, visibleAnchor } from './tree'
import type { MindMapNode } from './tree'
import { PC_MIN_WIDTH } from './viewport'
import type { Frame, View } from './viewport'

export const cardScale = (viewportWidth: number): number => (viewportWidth >= PC_MIN_WIDTH ? 0.9 : 0.8)

export const cardFocus = (root: MindMapNode, cursorNodeId: string): string => visibleAnchor(root, cursorNodeId)

export const cardTitle = (root: MindMapNode, cursorNodeId: string): string =>
  `${findNode(root, cardFocus(root, cursorNodeId))?.text || '주제'} 주변`

/** 한 축의 위치: 다 들어가면 맵 전체를 가운데에, 아니면 가지를 가운데에 두고 맵 가장자리에서 멈춘다. */
const axis = (box: number, start: number, length: number, focusCentre: number, k: number): number => {
  if (length * k <= box - 32) return (box - length * k) / 2 - start * k
  const lo = box - 16 - (start + length) * k
  const hi = 16 - start * k
  return Math.min(Math.max(box / 2 - focusCentre * k, lo), hi)
}

export const cardView = (bounds: MapLayout['bounds'], focus: Box, frame: Frame, k: number): View => ({
  x: axis(frame.w, bounds.x0, bounds.w, focus.x + focus.w / 2, k),
  y: axis(frame.h, bounds.y0, bounds.h, focus.y + focus.h / 2, k),
  k,
})
