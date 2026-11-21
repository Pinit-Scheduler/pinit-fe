import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Dispatch, PointerEvent as ReactPointerEvent, RefObject, SetStateAction } from 'react'
import { flushSync } from 'react-dom'
import type { Box, EditorCommand, EditorState } from '../model/editor'
import { dropTargetMany, findNode, pathTo, topmostBranches } from '../model/tree'
import type { Drop } from '../model/tree'
import { insertLine, pinchView, wheelFactor, zoomAt } from '../model/viewport'
import type { Pinch, View } from '../model/viewport'

/** 이만큼(px) 넘게 움직여야 끌기를 시작한다. */
const DRAG_START = 6
/** 같은 가지를 이 안에(ms) 두 번 누르면 글을 고친다. */
const DOUBLE_TAP_MS = 380
/** 손가락으로 가지를 이만큼(ms) 움직이지 않고 누르면 가지 메뉴를 연다. */
const LONG_PRESS_MS = 500
const NODE_ID_PREFIX = 'mind-map-node-'

type Point = { x: number; y: number }
type Press =
  /**
   * travelled: 6px 넘게 움직였다(누르기로 치지 않는다). moved: 끌기를 시작했다(주제는 끌지 않는다).
   * group: 여러 가지를 고른 채 그 가운데 하나를 눌렀다. 끌면 고른 위 가지들을 함께 옮기고, 끌지 않고 떼면 그 가지 하나만 고른다.
   */
  | { type: 'node'; id: string; sx: number; sy: number; travelled: boolean; moved: boolean; group: boolean }
  /** menuId: 마우스 오른쪽 단추로 누른 가지. 끌지 않고 떼면 그 가지의 메뉴를 연다. */
  | { type: 'pan'; lx: number; ly: number; sx: number; sy: number; moved: boolean; menuId: string | null }
  /** 마우스로 빈 곳을 왼쪽 단추로 눌렀다. 끌면 범위 선택이다. base: `Shift`로 더할 때 누르기 전의 고른 가지. */
  | { type: 'marquee'; sx: number; sy: number; moved: boolean; base: string[]; hits: string }
/** 범위 사각형(캔버스 기준). */
export type Marquee = { left: number; top: number; width: number; height: number }
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
  /** 보이는 가지의 상자(배치 좌표). 범위 선택이 쓴다. */
  boxes: ReadonlyMap<string, Box>
  /** Mac은 `⌘`+누르기가 하나씩 고르기이고 `Ctrl`+누르기는 오른쪽 단추다. */
  isMac: boolean
  /** 마우스 오른쪽 단추를 끌지 않고 뗐다(화면 좌표). */
  onMenuAt: (id: string, x: number, y: number) => void
  /**
   * 누른 가지를 고를 때 알린다. 누른 가지는 화면을 옮겨 보이게 하지 않는다.
   * `null`은 범위 선택·하나씩 고르기로 주 가지가 어느 것으로든 바뀔 수 있다는 뜻이다(이때도 화면을 옮기지 않는다).
   */
  onPointerSelect: (id: string | null) => void
  /** 손가락으로 가지를 길게 눌렀다(화면 좌표). */
  onLongPress: (id: string, x: number, y: number) => void
}

export const nodeIdOf = (el: Element | null): string | null => {
  const node = el?.closest<HTMLElement>('.mind-map-node')
  return node?.id.startsWith(NODE_ID_PREFIX) ? node.id.slice(NODE_ID_PREFIX.length) : null
}

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y) || 1

const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/**
 * 캔버스의 마우스·터치: 가지 고르기, 두 번 눌러 고치기, 끌어 옮기기(여러 가지를 골랐으면 함께), 두 손가락 확대,
 * 휠(이동, `Ctrl`·`Cmd`+휠은 확대).
 * 마우스는 빈 곳을 왼쪽 단추로 끌면 범위 선택, 오른쪽·가운데 단추로 끌면 화면 이동이다. 터치·펜은 빈 곳을 끌면 화면 이동이다.
 */
export function useCanvasPointer({
  canvasRef,
  state,
  view,
  setView,
  dispatch,
  boxes,
  isMac,
  onMenuAt,
  onPointerSelect,
  onLongPress,
}: Options) {
  const latest = useRef(state)
  const viewRef = useRef(view)
  const boxesRef = useRef(boxes)
  useLayoutEffect(() => {
    latest.current = state
    viewRef.current = view
    boxesRef.current = boxes
  })
  /** 마우스 오른쪽 단추로 누른 뒤 다음 누르기까지 참이다. 그 사이의 `contextmenu`는 브라우저가 누를 때 보내든 뗄 때 보내든 이 훅이 다룬다. */
  const ownsMenu = useRef(false)
  const [marquee, setMarquee] = useState<Marquee | null>(null)
  const points = useRef(new Map<number, Point>())
  const press = useRef<Press | null>(null)
  const pinch = useRef<Pinch | null>(null)
  const lastTap = useRef<{ id: string | null; t: number }>({ id: null, t: 0 })
  const dropRef = useRef<Drop | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [panning, setPanning] = useState(false)
  const longPress = useRef<number | null>(null)

  const clearDrag = () => {
    dropRef.current = null
    setDrag(null)
  }

  const stopLongPress = () => {
    if (longPress.current !== null) window.clearTimeout(longPress.current)
    longPress.current = null
  }
  useEffect(() => stopLongPress, [])

  /** 지금 누르기를 버린다. 가지 메뉴를 열었으면 손을 떼도 누르기·끌기로 치지 않는다. */
  const cancelPress = useCallback(() => {
    stopLongPress()
    press.current = null
    lastTap.current = { id: null, t: 0 }
    dropRef.current = null
    setDrag(null)
    setMarquee(null)
  }, [])

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const canvas = canvasRef.current
    const target = event.target as Element
    const mouse = event.pointerType === 'mouse'
    const right = mouse && (event.button === 2 || (isMac && event.button === 0 && event.ctrlKey))
    const panButton = right || (mouse && event.button === 1)
    if (!canvas || (event.button > 0 && !panButton)) return
    if (!panButton && target.closest('.mind-map-node__toggle, .mind-map-node__check')) return
    ownsMenu.current = right
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
      stopLongPress()
      clearDrag()
      press.current = null
      const [a, b] = [...points.current.values()]
      pinch.current = { k: viewRef.current?.k ?? 1, distance: distance(a, b) }
      return
    }
    const known = id !== null && findNode(latest.current.tree, id) !== null
    if (panButton) {
      stopLongPress()
      const { clientX: x, clientY: y } = event
      press.current = { type: 'pan', lx: x, ly: y, sx: x, sy: y, moved: false, menuId: right && known ? id : null }
      return
    }
    if (id && known) {
      if (mouse && (event.shiftKey || (isMac ? event.metaKey : event.ctrlKey))) {
        onPointerSelect(null)
        dispatch({ type: 'toggleSelect', id })
        press.current = null
        lastTap.current = { id: null, t: 0 }
        return
      }
      const { selection } = latest.current
      const group = selection.length > 1 && selection.includes(id)
      onPointerSelect(id)
      dispatch({ type: 'select', id, keep: group })
      press.current = { type: 'node', id, sx: event.clientX, sy: event.clientY, travelled: false, moved: false, group }
      if (event.pointerType !== 'mouse') {
        const { clientX, clientY } = event
        stopLongPress()
        longPress.current = window.setTimeout(() => {
          longPress.current = null
          const current = press.current
          if (current?.type !== 'node' || current.id !== id || current.travelled || points.current.size !== 1) return
          cancelPress()
          onLongPress(id, clientX, clientY)
        }, LONG_PRESS_MS)
      }
    } else if (mouse) {
      const base = event.shiftKey ? [...latest.current.selection] : []
      press.current = { type: 'marquee', sx: event.clientX, sy: event.clientY, moved: false, base, hits: '' }
    } else {
      const { clientX: x, clientY: y } = event
      press.current = { type: 'pan', lx: x, ly: y, sx: x, sy: y, moved: false, menuId: null }
    }
  }

  /** 범위 사각형을 그리고 겹치는 보이는 가지를 고른다. 고른 가지가 바뀔 때만 알린다. */
  const sweep = (current: Extract<Press, { type: 'marquee' }>, x: number, y: number, rect: DOMRect) => {
    const left = Math.min(current.sx, x) - rect.left
    const top = Math.min(current.sy, y) - rect.top
    const box = { left, top, width: Math.abs(x - current.sx), height: Math.abs(y - current.sy) }
    setMarquee(box)
    const v = viewRef.current
    if (!v) return
    const world = { x: (left - v.x) / v.k, y: (top - v.y) / v.k, w: box.width / v.k, h: box.height / v.k }
    const hits = [...boxesRef.current].filter(([, b]) => overlaps(world, b)).map(([id]) => id)
    const key = hits.join(' ')
    if (key === current.hits) return
    current.hits = key
    onPointerSelect(null)
    dispatch({ type: 'selectMany', ids: [...current.base, ...hits], additive: false })
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
    if (current.type === 'marquee') {
      if (!current.moved && Math.hypot(event.clientX - current.sx, event.clientY - current.sy) <= DRAG_START) return
      current.moved = true
      sweep(current, event.clientX, event.clientY, rect)
      return
    }
    if (current.type === 'pan') {
      const dx = event.clientX - current.lx
      const dy = event.clientY - current.ly
      current.lx = event.clientX
      current.ly = event.clientY
      if (Math.hypot(event.clientX - current.sx, event.clientY - current.sy) > DRAG_START) current.moved = true
      setPanning(true)
      setView((v) => v && { ...v, x: v.x + dx, y: v.y + dy })
      return
    }
    const { tree, selection } = latest.current
    if (!current.moved) {
      if (Math.hypot(event.clientX - current.sx, event.clientY - current.sy) <= DRAG_START) return
      current.travelled = true
      stopLongPress()
      if (current.id === tree.id) return
      current.moved = true
    }
    const over = document.elementFromPoint(event.clientX, event.clientY)
    const overNode = over && canvas.contains(over) ? over.closest<HTMLElement>('.mind-map-node') : null
    const overId = nodeIdOf(overNode)
    const dragged = current.group ? topmostBranches(tree, selection) : [current.id]
    let drop: Drop | null = null
    let line: Drag['line'] = null
    if (overNode && overId) {
      const r = overNode.getBoundingClientRect()
      drop = dropTargetMany(tree, dragged, overId, (event.clientY - r.top) / r.height)
      if (drop && drop.mode !== 'child')
        line = insertLine(
          { left: r.left - rect.left, top: r.top - rect.top, bottom: r.bottom - rect.top, width: r.width },
          drop.mode,
        )
    }
    dropRef.current = drop
    // 누른 가지가 고른 다른 가지의 아래면 그 위 가지의 글을 보인다.
    const path = pathTo(tree, current.id)
    const lead = dragged.find((id) => path.includes(id)) ?? current.id
    const text = findNode(tree, lead)?.text ?? ''
    setDrag({
      text: dragged.length > 1 ? `${text} 외 ${dragged.length - 1}개` : text,
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      drop,
      line,
    })
  }

  const release = (event: ReactPointerEvent<HTMLDivElement>) => {
    stopLongPress()
    points.current.delete(event.pointerId)
    if (points.current.size < 2) pinch.current = null
    setPanning(false)
    const current = press.current
    press.current = null
    if (!current) return
    if (current.type === 'pan') {
      if (current.menuId && !current.moved && event.type === 'pointerup')
        onMenuAt(current.menuId, event.clientX, event.clientY)
      return
    }
    if (current.type === 'marquee') {
      setMarquee(null)
      if (!current.moved && event.type === 'pointerup') {
        onPointerSelect(null)
        dispatch({ type: 'single' })
      }
      return
    }
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
    // 고른 여러 가지 가운데 하나를 끌지 않고 떼면 그 가지 하나만 고른다.
    if (current.group) dispatch({ type: 'select', id: current.id })
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
    marquee,
    cancelPress,
    /** 이 `contextmenu`는 오른쪽 단추 누르기의 것이라 훅이 뗄 때 메뉴를 연다. */
    ownsContextMenu: () => ownsMenu.current,
    handlers: { onPointerDown, onPointerMove, onPointerUp: release, onPointerCancel: release },
  }
}
