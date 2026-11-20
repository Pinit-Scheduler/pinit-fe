import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Dispatch, PointerEvent as ReactPointerEvent, RefObject, SetStateAction } from 'react'
import { flushSync } from 'react-dom'
import type { EditorCommand, EditorState } from '../model/editor'
import { dropTarget, findNode } from '../model/tree'
import type { Drop } from '../model/tree'
import { insertLine, pinchView, wheelFactor, zoomAt } from '../model/viewport'
import type { Pinch, View } from '../model/viewport'

/** 이만큼(px) 넘게 움직여야 끌기를 시작한다. */
const DRAG_START = 6
/** 같은 가지를 이 안에(ms) 두 번 누르면 글을 고친다. */
const DOUBLE_TAP_MS = 380
const NODE_ID_PREFIX = 'mind-map-node-'

type Point = { x: number; y: number }
type Press =
  /** travelled: 6px 넘게 움직였다(누르기로 치지 않는다). moved: 끌기를 시작했다(주제는 끌지 않는다). */
  | { type: 'node'; id: string; sx: number; sy: number; travelled: boolean; moved: boolean }
  | { type: 'pan'; lx: number; ly: number }
export type Drag = {
  text: string
  /** 유령 상자의 자리(캔버스 기준). */
  x: number
  y: number
  drop: Drop | null
  line: { left: number; top: number; width: number } | null
}

type Options = {
  canvasRef: RefObject<HTMLDivElement | null>
  state: EditorState
  view: View | null
  setView: Dispatch<SetStateAction<View | null>>
  dispatch: (command: EditorCommand) => void
  /** 누른 가지를 고를 때 알린다. 누른 가지는 화면을 옮겨 보이게 하지 않는다. */
  onPointerSelect: (id: string) => void
}

const nodeIdOf = (el: Element | null): string | null => {
  const node = el?.closest<HTMLElement>('.mind-map-node')
  return node?.id.startsWith(NODE_ID_PREFIX) ? node.id.slice(NODE_ID_PREFIX.length) : null
}

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y) || 1

/**
 * 캔버스의 마우스·터치: 가지 고르기, 두 번 눌러 고치기, 끌어 옮기기, 빈 곳 끌어 화면 옮기기,
 * 두 손가락 확대, 휠(이동, `Ctrl`·`Cmd`+휠은 확대).
 */
export function useCanvasPointer({ canvasRef, state, view, setView, dispatch, onPointerSelect }: Options) {
  const latest = useRef(state)
  const viewRef = useRef(view)
  useLayoutEffect(() => {
    latest.current = state
    viewRef.current = view
  })
  const points = useRef(new Map<number, Point>())
  const press = useRef<Press | null>(null)
  const pinch = useRef<Pinch | null>(null)
  const lastTap = useRef<{ id: string | null; t: number }>({ id: null, t: 0 })
  const dropRef = useRef<Drop | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [panning, setPanning] = useState(false)

  const clearDrag = () => {
    dropRef.current = null
    setDrag(null)
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const canvas = canvasRef.current
    const target = event.target as Element
    if (!canvas || event.button > 0 || target.closest('.mind-map-node__toggle, .mind-map-node__check')) return
    const id = nodeIdOf(target)
    // 쓰는 글 상자 안을 누르면 글 상자가 다룬다(커서 옮기기·글 고르기). 고르지 않는다.
    const { editing } = latest.current
    if (editing && id === editing.id) return
    event.preventDefault()
    if (editing) {
      // 다른 곳을 누르면 먼저 확정한다. 글이 한도를 넘어 확정하지 못하면 쓰기를 이어 간다.
      flushSync(() => dispatch({ type: 'commit' }))
      if (latest.current.editing) return
    }
    canvas.focus({ preventScroll: true })
    points.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    canvas.setPointerCapture?.(event.pointerId)
    if (points.current.size === 2) {
      clearDrag()
      press.current = null
      const [a, b] = [...points.current.values()]
      pinch.current = { k: viewRef.current?.k ?? 1, distance: distance(a, b) }
      return
    }
    if (id && findNode(latest.current.tree, id)) {
      onPointerSelect(id)
      dispatch({ type: 'select', id })
      press.current = { type: 'node', id, sx: event.clientX, sy: event.clientY, travelled: false, moved: false }
    } else {
      press.current = { type: 'pan', lx: event.clientX, ly: event.clientY }
    }
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const point = points.current.get(event.pointerId)
    const canvas = canvasRef.current
    if (!point || !canvas) return
    point.x = event.clientX
    point.y = event.clientY
    const rect = canvas.getBoundingClientRect()
    if (pinch.current && points.current.size === 2) {
      const [a, b] = [...points.current.values()]
      const now = pinch.current
      const cx = (a.x + b.x) / 2 - rect.left
      const cy = (a.y + b.y) / 2 - rect.top
      setView((v) => v && pinchView(v, now, distance(a, b), cx, cy))
      return
    }
    const current = press.current
    if (!current) return
    if (current.type === 'pan') {
      const dx = event.clientX - current.lx
      const dy = event.clientY - current.ly
      current.lx = event.clientX
      current.ly = event.clientY
      setPanning(true)
      setView((v) => v && { ...v, x: v.x + dx, y: v.y + dy })
      return
    }
    const { tree } = latest.current
    if (!current.moved) {
      if (Math.hypot(event.clientX - current.sx, event.clientY - current.sy) <= DRAG_START) return
      current.travelled = true
      if (current.id === tree.id) return
      current.moved = true
    }
    const over = document.elementFromPoint(event.clientX, event.clientY)
    const overNode = over && canvas.contains(over) ? over.closest<HTMLElement>('.mind-map-node') : null
    const overId = nodeIdOf(overNode)
    let drop: Drop | null = null
    let line: Drag['line'] = null
    if (overNode && overId) {
      const r = overNode.getBoundingClientRect()
      drop = dropTarget(tree, current.id, overId, (event.clientY - r.top) / r.height)
      if (drop && drop.mode !== 'child')
        line = insertLine(
          { left: r.left - rect.left, top: r.top - rect.top, bottom: r.bottom - rect.top, width: r.width },
          drop.mode,
        )
    }
    dropRef.current = drop
    setDrag({
      text: findNode(tree, current.id)?.text ?? '',
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      drop,
      line,
    })
  }

  const release = (event: ReactPointerEvent<HTMLDivElement>) => {
    points.current.delete(event.pointerId)
    if (points.current.size < 2) pinch.current = null
    setPanning(false)
    const current = press.current
    press.current = null
    if (!current || current.type !== 'node') return
    if (current.moved) {
      const drop = dropRef.current
      clearDrag()
      if (drop && event.type === 'pointerup') dispatch({ type: 'drop', draggedId: current.id, drop })
      return
    }
    // 움직인 누르기(끌 수 없는 주제를 끈 것)는 두 번 누르기로 세지 않는다.
    if (event.type !== 'pointerup' || current.travelled) {
      lastTap.current = { id: null, t: 0 }
      return
    }
    const now = performance.now()
    if (lastTap.current.id === current.id && now - lastTap.current.t < DOUBLE_TAP_MS) {
      lastTap.current = { id: null, t: 0 }
      dispatch({ type: 'startEdit', id: current.id })
    } else {
      lastTap.current = { id: current.id, t: now }
    }
  }

  // 휠은 화면 이동, `Ctrl`·`Cmd`+휠(트랙패드 벌리기 포함)은 확대. 페이지가 움직이지 않게 막는다.
  const onWheel = useCallback(
    (event: WheelEvent) => {
      const canvas = canvasRef.current
      if (!canvas) return
      event.preventDefault()
      if (event.ctrlKey || event.metaKey) {
        const rect = canvas.getBoundingClientRect()
        const cx = event.clientX - rect.left
        const cy = event.clientY - rect.top
        setView((v) => v && zoomAt(v, cx, cy, wheelFactor(event.deltaY)))
      } else {
        setView((v) => v && { ...v, x: v.x - event.deltaX, y: v.y - event.deltaY })
      }
    },
    [canvasRef, setView],
  )
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [canvasRef, onWheel])

  return {
    drag,
    panning,
    handlers: { onPointerDown, onPointerMove, onPointerUp: release, onPointerCancel: release },
  }
}
