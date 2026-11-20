import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { FocusEvent, KeyboardEvent } from 'react'
import { flushSync } from 'react-dom'
import { useToast } from '@shared/contexts/ToastContext'
import { useCanvasPointer } from '../hooks/useCanvasPointer'
import { textNotice } from '../model/editor'
import type { Box, EditorCommand, Editing, EditorState } from '../model/editor'
import { keyAction } from '../model/keymap'
import { drawnBounds, layoutMap } from '../model/layout'
import type { Size } from '../model/layout'
import { clipText } from '../model/text'
import { centerOn, fitView, keepVisible, pageScale, zoomStep } from '../model/viewport'
import type { View } from '../model/viewport'
import MindMapActionBar from './MindMapActionBar'
import { measure, sameSizes } from './measureNodes'
import MindMapWorld from './MindMapWorld'
import MindMapZoom from './MindMapZoom'

type Props = {
  state: EditorState
  dispatch: (command: EditorCommand) => void
  /** 보이는 가지의 상자를 편집기에 알린다(화면상 위·아래 고르기). */
  setGeometry: (boxes: ReadonlyMap<string, Box>) => void
  /** 단추 옆 단축키를 Mac 표기(`⌘`)로 쓴다. */
  isMac: boolean
}

const DOT_SPACING = 22

const caretToEnd = (el: HTMLElement) => {
  const range = document.createRange()
  range.selectNodeContents(el)
  range.collapse(false)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

/**
 * 편집 화면. 키·마우스·터치를 편집기 명령으로 바꾸고, 가지 크기를 재 배치하고, 고른 가지가 보이게 화면을 옮긴다.
 * 오른쪽 위에 확대 단추, 아래에 동작 단추 줄을 띄운다.
 */
export default function MindMapCanvas({ state, dispatch, setGeometry, isMac }: Props) {
  const { addToast } = useToast()
  const canvasRef = useRef<HTMLDivElement>(null)
  const elements = useRef(new Map<string, HTMLElement>())
  const composing = useRef(false)
  /** 한도 안내를 이미 띄운 쓰기. 글이 한도 안으로 돌아오거나 새로 쓰기 시작하면 다시 알린다. */
  const noticedFor = useRef<Editing | null>(null)
  const shown = useRef<{ selectedId: string | null; editingId: string | null }>({
    selectedId: null,
    editingId: null,
  })
  const [sizes, setSizes] = useState<ReadonlyMap<string, Size>>(() => new Map())
  const [view, setView] = useState<View | null>(null)
  const [fontsLoaded, setFontsLoaded] = useState(false)
  /** 눌러서 고른 가지. 누른 가지는 이미 보이므로 화면을 옮기지 않는다. */
  const pointerPicked = useRef<string | null>(null)
  const layout = useMemo(() => layoutMap(state.tree, sizes), [state.tree, sizes])
  const { editing, selectedId, limits } = state

  const nodeRef = useCallback((id: string, el: HTMLElement | null) => {
    if (el) elements.current.set(id, el)
    else elements.current.delete(id)
  }, [])

  // 글꼴이 늦게 오면 가지 크기가 바뀐다. 다 온 뒤 한 번 더 그려 다시 잰다.
  useEffect(() => {
    let live = true
    document.fonts?.ready.then(() => {
      if (live) setFontsLoaded(true)
    })
    return () => {
      live = false
    }
  }, [])

  // 배치·선택·쓰기가 바뀌거나 글꼴이 오면 보이는 가지를 잰다. 크기가 바뀌었으면 다시 배치하고, 같으면 화면 위치를 맞춘다.
  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const measured = measure(layout.nodes.map((place) => place.id), elements.current)
    if (!sameSizes(measured, sizes)) {
      setSizes(measured)
      return
    }
    setGeometry(layout.boxes)
    const box = layout.boxes.get(selectedId)
    if (!box) return
    const frame = { w: canvas.clientWidth, h: canvas.clientHeight }
    const previous = shown.current
    shown.current = { selectedId, editingId: editing?.id ?? null }
    if (!view) {
      setView(centerOn(box, frame, pageScale(window.innerWidth)))
      canvas.focus({ preventScroll: true })
      return
    }
    const picked = pointerPicked.current
    if (previous.selectedId !== selectedId) pointerPicked.current = null
    if ((previous.selectedId !== selectedId && picked !== selectedId) || editing) {
      const next = keepVisible(view, box, frame)
      if (next.x !== view.x || next.y !== view.y) setView(next)
    }
    // 쓰기가 끝나 쓰던 글 상자가 사라졌으면 초점을 캔버스로 돌린다. 다른 곳을 눌러 끝났으면 그대로 둔다.
    if (previous.editingId && !editing) {
      const active = document.activeElement
      if (!active || active === document.body || canvas.contains(active)) canvas.focus({ preventScroll: true })
    }
  }, [layout, sizes, setGeometry, selectedId, editing, view, fontsLoaded])

  const labelOf = (id: string) =>
    elements.current.get(id)?.querySelector<HTMLElement>('.mind-map-node__label') ?? null

  /** 글은 한도까지만 받는다. 한글 조합 중에는 자르지 않고 조합이 끝난 뒤 자른다. */
  const onLabelInput = (text: string) => {
    if (!editing) return
    const clipped = composing.current ? text : clipText(text, limits.maxTextLength)
    if (clipped !== text) {
      const label = labelOf(editing.id)
      if (label) {
        label.textContent = clipped
        caretToEnd(label)
      }
      if (noticedFor.current !== editing) addToast(textNotice(limits), 'info')
      noticedFor.current = editing
    } else if (!composing.current) {
      noticedFor.current = null
    }
    dispatch({ type: 'input', text: clipped })
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('select, input, textarea')) return
    const action = keyAction(event.nativeEvent, editing !== null)
    if (!action) return
    if (action.preventDefault) event.preventDefault()
    // 친 글자가 글 상자에 들어가도록, 기본 동작 전에 글 상자를 그리고 초점을 옮긴다.
    if (!action.preventDefault) flushSync(() => dispatch(action.command))
    else dispatch(action.command)
  }

  /** 다른 곳을 누르면 확정한다. 글이 한도를 넘어 확정하지 못하면 글 상자에 초점을 둔다. */
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    const label = event.target
    if (!editing || !label.isContentEditable || !label.isConnected) return
    dispatch({ type: 'commit' })
    window.setTimeout(() => {
      if (label.isConnected && label.isContentEditable && document.activeElement !== label)
        label.focus({ preventScroll: true })
    }, 0)
  }

  const focusCanvas = () => {
    if (!editing) canvasRef.current?.focus({ preventScroll: true })
  }

  const { drag, panning, handlers } = useCanvasPointer({
    canvasRef,
    state,
    view,
    setView,
    dispatch,
    onPointerSelect: (id) => {
      pointerPicked.current = id
    },
  })

  /** 단추 줄의 명령. 글 쓰기가 시작되지 않았으면 초점을 캔버스에 둔다(키보드가 이어서 듣는다). */
  const runAction = (command: EditorCommand) => {
    flushSync(() => dispatch(command))
    const active = document.activeElement as HTMLElement | null
    if (!active?.isContentEditable) canvasRef.current?.focus({ preventScroll: true })
  }

  const frame = () => ({ w: canvasRef.current?.clientWidth ?? 0, h: canvasRef.current?.clientHeight ?? 0 })
  const zoom = (dir: 1 | -1) => setView((v) => v && zoomStep(v, frame(), dir))
  const fit = () => setView(fitView(drawnBounds(layout), frame()))

  const k = view?.k ?? 1
  const childDrop = drag?.drop?.mode === 'child' ? drag.drop.targetId : null
  return (
    <div className="mind-map-stage">
      <div
        ref={canvasRef}
        className={'mind-map-canvas' + (panning ? ' is-panning' : '')}
        tabIndex={0}
        role="tree"
        aria-label="마인드맵 편집 화면"
        aria-activedescendant={selectedId ? `mind-map-node-${selectedId}` : undefined}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
        {...handlers}
        onCompositionStart={() => {
          composing.current = true
        }}
        onCompositionEnd={(event) => {
          composing.current = false
          const label = event.target as HTMLElement
          if (label.isContentEditable) onLabelInput((label.textContent ?? '').replace(/[\r\n]/g, ' '))
        }}
        style={{
          backgroundPosition: `${view?.x ?? 0}px ${view?.y ?? 0}px`,
          backgroundSize: `${DOT_SPACING * k}px ${DOT_SPACING * k}px`,
        }}
      >
        <MindMapWorld
          root={state.tree}
          layout={layout}
          selectedId={selectedId}
          editing={editing}
          readOnly={false}
          dropId={childDrop}
          nodeRef={nodeRef}
          onLabelInput={onLabelInput}
          onCheckClick={(id) => {
            dispatch({ type: 'toggleCheck', id })
            focusCanvas()
          }}
          onToggleClick={(id) => {
            dispatch({ type: 'toggleCollapse', id })
            focusCanvas()
          }}
          style={{
            transform: view ? `translate(${view.x}px, ${view.y}px) scale(${view.k})` : undefined,
            visibility: view ? undefined : 'hidden',
          }}
        />
        {drag?.line && (
          <div
            className="mind-map-insert-line"
            style={{ left: drag.line.left, top: drag.line.top, width: drag.line.width }}
            aria-hidden="true"
          />
        )}
        {drag && (
          <div className="mind-map-ghost" style={{ left: drag.x, top: drag.y }} aria-hidden="true">
            {drag.text}
          </div>
        )}
      </div>
      {view && <MindMapZoom k={view.k} onZoom={zoom} onFit={fit} />}
      <MindMapActionBar state={state} dispatch={runAction} isMac={isMac} />
    </div>
  )
}
