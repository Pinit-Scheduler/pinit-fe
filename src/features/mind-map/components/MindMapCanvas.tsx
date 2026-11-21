import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { FocusEvent, KeyboardEvent, MouseEvent } from 'react'
import { flushSync } from 'react-dom'
import { useToast } from '@shared/contexts/ToastContext'
import { nodeIdOf, useCanvasPointer } from '../hooks/useCanvasPointer'
import { textNotice } from '../model/editor'
import type { Box, EditorCommand, Editing, EditorState } from '../model/editor'
import { keyAction } from '../model/keymap'
import { drawnBounds, layoutMap } from '../model/layout'
import type { Size } from '../model/layout'
import { clipText } from '../model/text'
import { centerOn, fitView, keepVisible, pageScale, zoomStep } from '../model/viewport'
import type { View } from '../model/viewport'
import MindMapActionBar from './MindMapActionBar'
import MindMapContextMenu from './MindMapContextMenu'
import type { MenuPlace } from './MindMapContextMenu'
import { measure, sameSizes } from './measureNodes'
import MindMapWorld from './MindMapWorld'
import MindMapZoom from './MindMapZoom'

type Props = {
  state: EditorState
  /** 명령을 하고 화면 상태가 바뀌었는지 돌려준다. */
  dispatch: (command: EditorCommand) => boolean
  /** 보이는 가지의 상자를 편집기에 알린다(화면상 위·아래 고르기). */
  setGeometry: (boxes: ReadonlyMap<string, Box>) => void
  /** 단추 옆 단축키를 Mac 표기(`⌘`)로 쓴다. */
  isMac: boolean
}

const DOT_SPACING = 22
const ANY_PICK = '*'

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
  const shown = useRef<{ selectedId: string | null; editingId: string | null; frame: { w: number; h: number } | null }>({
    selectedId: null,
    editingId: null,
    frame: null,
  })
  const [sizes, setSizes] = useState<ReadonlyMap<string, Size>>(() => new Map())
  const [view, setView] = useState<View | null>(null)
  const [fontsLoaded, setFontsLoaded] = useState(false)
  /** 캔버스 크기. 폰에서 키보드가 열리면 줄어든다. 줄면 고른 가지가 보이게 다시 옮긴다. */
  const [frameSize, setFrameSize] = useState<{ w: number; h: number } | null>(null)
  /** `Ctrl V`를 눌러 브라우저의 붙여넣기 이벤트를 기다리는 중. 이벤트가 오지 않으면 화면의 클립보드를 붙인다. */
  const pendingPaste = useRef(false)
  /** 문서에 단 붙여넣기 듣기가 마지막 값을 읽는다. */
  const latest = useRef({ editing: false, dispatch })
  /** 열린 가지 메뉴. 고른 가지가 바뀌거나 글 쓰기가 시작되면 보이지 않는다. */
  const [menu, setMenu] = useState<MenuPlace | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])
  /** 눌러서 고른 가지. 누른 가지는 이미 보이므로 화면을 옮기지 않는다. `ANY_PICK`은 범위 선택처럼 주 가지가 어느 것이든 그렇다. */
  const pointerPicked = useRef<string | null>(null)
  const layout = useMemo(() => layoutMap(state.tree, sizes), [state.tree, sizes])
  /** 마지막으로 가지 크기를 재서 배치와 맞은 때의 조건. 이 가운데 하나라도 바뀌면 다시 잰다. */
  const measuredFor = useRef<{
    layout: typeof layout
    editing: Editing | null
    fontsLoaded: boolean
    frameSize: { w: number; h: number } | null
  } | null>(null)
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

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const observer = new ResizeObserver(() => {
      setFrameSize((previous) =>
        previous && previous.w === canvas.clientWidth && previous.h === canvas.clientHeight
          ? previous
          : { w: canvas.clientWidth, h: canvas.clientHeight },
      )
    })
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [])

  useLayoutEffect(() => {
    latest.current = { editing: editing !== null, dispatch }
  })

  // 붙여넣기 이벤트는 초점이 쓸 수 없는 요소에 있으면 문서로 온다. 캔버스에 초점이 있고 글을 쓰지 않을 때만 가지로 붙인다.
  // 글을 쓰는 중이면 브라우저가 글 상자에 글로 붙인다.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const canvas = canvasRef.current
      if (!canvas || latest.current.editing) return
      if (!pendingPaste.current && document.activeElement !== canvas) return
      pendingPaste.current = false
      event.preventDefault()
      latest.current.dispatch({ type: 'paste', text: event.clipboardData?.getData('text/plain') ?? '' })
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [])

  // 글을 쓰는 동안(폰에서는 키보드가 열린 동안) 아래 탭과 미니 플레이어를 숨긴다(mind-map.css). 앱의 다른 입력 화면과 같다.
  const isEditing = editing !== null
  useEffect(() => {
    if (!isEditing) return
    document.body.dataset.mindMapEditing = 'true'
    return () => {
      delete document.body.dataset.mindMapEditing
    }
  }, [isEditing])

  // 배치·쓰기·캔버스 크기가 바뀌거나 글꼴이 오면 보이는 가지를 잰다. 크기가 바뀌었으면 다시 배치하고, 같으면 화면 위치를 맞춘다.
  // 선택과 화면 위치(이동·확대)는 가지 크기를 바꾸지 않으므로 그때는 다시 재지 않는다. 재는 것은 모든 가지의 배치 계산을
  // 강제해서, 끄는 동안 포인터 이동마다 하면 가지 수만큼 느려진다.
  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const last = measuredFor.current
    if (!last || last.layout !== layout || last.editing !== editing || last.fontsLoaded !== fontsLoaded || last.frameSize !== frameSize) {
      const measured = measure(layout.nodes.map((place) => place.id), elements.current)
      if (!sameSizes(measured, sizes)) {
        setSizes(measured)
        return
      }
      measuredFor.current = { layout, editing, fontsLoaded, frameSize }
    }
    setGeometry(layout.boxes)
    const box = layout.boxes.get(selectedId)
    if (!box) return
    const frame = { w: canvas.clientWidth, h: canvas.clientHeight }
    const previous = shown.current
    shown.current = { selectedId, editingId: editing?.id ?? null, frame }
    if (!view) {
      setView(centerOn(box, frame, pageScale(window.innerWidth)))
      canvas.focus({ preventScroll: true })
      return
    }
    const picked = pointerPicked.current
    if (previous.selectedId !== selectedId || picked === ANY_PICK) pointerPicked.current = null
    const resized = previous.frame !== null && (previous.frame.w !== frame.w || previous.frame.h !== frame.h)
    const byPointer = picked === selectedId || picked === ANY_PICK
    if ((previous.selectedId !== selectedId && !byPointer) || editing || resized) {
      const next = keepVisible(view, box, frame)
      if (next.x !== view.x || next.y !== view.y) setView(next)
    }
    // 쓰기가 끝나 쓰던 글 상자가 사라졌으면 초점을 캔버스로 돌린다. 다른 곳을 눌러 끝났으면 그대로 둔다.
    if (previous.editingId && !editing) {
      const active = document.activeElement
      if (!active || active === document.body || canvas.contains(active)) canvas.focus({ preventScroll: true })
    }
  }, [layout, sizes, setGeometry, selectedId, editing, view, fontsLoaded, frameSize])

  // 범위 선택이 주 가지를 바꾸지 않았어도 표시는 이번 그리기에서 끝낸다. 다음 키보드 이동은 화면을 따라 옮긴다.
  useLayoutEffect(() => {
    if (pointerPicked.current === ANY_PICK) pointerPicked.current = null
  }, [state.selection])

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
    if (menu) {
      closeMenu()
      if (event.key === 'Escape') {
        event.preventDefault()
        return
      }
    }
    const action = keyAction(event.nativeEvent, editing !== null)
    if (!action) return
    if (action.command.type === 'paste') {
      // 붙여넣기 이벤트는 이 키의 기본 동작으로 바로 온다. 오지 않는 브라우저에서는 화면의 클립보드를 붙인다.
      pendingPaste.current = true
      window.setTimeout(() => {
        if (!pendingPaste.current) return
        pendingPaste.current = false
        latest.current.dispatch({ type: 'paste' })
      }, 0)
      return
    }
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

  // 가지에 넘기는 함수는 늘 같은 것이어야 가지가 다시 그려지지 않는다(MindMapNodeView의 memo). 할 일은 마지막 것을 부른다.
  const nodeHandlers = useRef({ onLabelInput, focusCanvas })
  useLayoutEffect(() => {
    nodeHandlers.current = { onLabelInput, focusCanvas }
  })
  const onNodeLabelInput = useCallback((text: string) => nodeHandlers.current.onLabelInput(text), [])
  const onNodeCheckClick = useCallback(
    (id: string) => {
      dispatch({ type: 'toggleCheck', id })
      nodeHandlers.current.focusCanvas()
    },
    [dispatch],
  )
  const onNodeToggleClick = useCallback(
    (id: string) => {
      dispatch({ type: 'toggleCollapse', id })
      nodeHandlers.current.focusCanvas()
    },
    [dispatch],
  )

  /** 가지를 고르고 그 가지의 메뉴를 연다. 좌표는 화면 기준이다. */
  const openMenu = (id: string, x: number, y: number, above: boolean) => {
    const stage = canvasRef.current?.parentElement
    if (!stage) return
    const rect = stage.getBoundingClientRect()
    pointerPicked.current = id
    // 고른 여러 가지 가운데 하나면 고른 것을 두어 메뉴가 모두에 하게 한다.
    flushSync(() => dispatch({ type: 'select', id, keep: true }))
    canvasRef.current?.focus({ preventScroll: true })
    setMenu({ id, x: x - rect.left, y: y - rect.top, above })
  }

  const { drag, panning, marquee, cancelPress, ownsContextMenu, handlers } = useCanvasPointer({
    canvasRef,
    state,
    view,
    setView,
    dispatch,
    boxes: layout.boxes,
    isMac,
    onMenuAt: (id, x, y) => openMenu(id, x, y, false),
    onPointerSelect: (id) => {
      pointerPicked.current = id ?? ANY_PICK
    },
    onLongPress: (id, x, y) => openMenu(id, x, y, true),
  })

  /**
   * 안드로이드 길게 누르기로 가지 메뉴를 연다(키보드 메뉴 키는 캔버스를 가리켜 가지가 없으므로 열지 않는다). 쓰는 글 안에서는 브라우저 메뉴를 둔다.
   * 마우스 오른쪽 단추는 끌면 화면 이동이라 포인터 훅이 뗄 때 메뉴를 연다. 그 `contextmenu`는 막기만 한다.
   */
  const onContextMenu = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement
    if (target.isContentEditable) return
    event.preventDefault()
    const pointerType = (event.nativeEvent as PointerEvent).pointerType
    if (ownsContextMenu() && (pointerType === 'mouse' || pointerType === undefined)) return
    const id = nodeIdOf(target)
    if (drag || !id || editing) return
    cancelPress()
    const touch = (event.nativeEvent as PointerEvent).pointerType === 'touch'
    openMenu(id, event.clientX, event.clientY, touch)
  }

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
  const selectedIds = useMemo(() => new Set(state.selection), [state.selection])
  return (
    <div className="mind-map-stage">
      <div
        ref={canvasRef}
        className={'mind-map-canvas' + (panning ? ' is-panning' : '')}
        tabIndex={0}
        role="tree"
        aria-label="마인드맵 편집 화면"
        aria-multiselectable="true"
        aria-activedescendant={selectedId ? `mind-map-node-${selectedId}` : undefined}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
        onContextMenu={onContextMenu}
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
          selectedIds={selectedIds}
          editing={editing}
          readOnly={false}
          dropId={childDrop}
          nodeRef={nodeRef}
          onLabelInput={onNodeLabelInput}
          onCheckClick={onNodeCheckClick}
          onToggleClick={onNodeToggleClick}
          style={{
            transform: view ? `translate(${view.x}px, ${view.y}px) scale(${view.k})` : undefined,
            visibility: view ? undefined : 'hidden',
          }}
        />
        {marquee && (
          <div
            className="mind-map-marquee"
            style={{ left: marquee.left, top: marquee.top, width: marquee.width, height: marquee.height }}
            aria-hidden="true"
          />
        )}
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
      {menu && menu.id === selectedId && !editing && (
        <MindMapContextMenu state={state} place={menu} isMac={isMac} run={runAction} onClose={closeMenu} />
      )}
      <MindMapActionBar state={state} dispatch={runAction} isMac={isMac} />
    </div>
  )
}
