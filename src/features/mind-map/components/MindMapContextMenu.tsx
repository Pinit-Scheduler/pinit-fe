import { useEffect, useLayoutEffect, useRef } from 'react'
import type { PointerEvent } from 'react'
import { actionState } from '../model/editor'
import type { EditorCommand, EditorState } from '../model/editor'
import { shortcutText } from '../model/keymap'

/** 무대(`.mind-map-stage`) 기준 자리. `above`면 손가락에 가리지 않게 누른 곳 위에 연다. */
export type MenuPlace = { id: string; x: number; y: number; above: boolean }

type Props = {
  state: EditorState
  place: MenuPlace
  isMac: boolean
  run: (command: EditorCommand) => void
  onClose: () => void
}

const EDGE = 8
const FINGER = 16

/** 단추를 눌러도 초점이 캔버스에 남게 한다(키보드가 이어서 듣는다). */
const keepFocus = (event: PointerEvent) => event.preventDefault()

/**
 * 가지 메뉴: PC는 가지를 오른쪽 단추로, 터치는 길게 눌러 연다. 잘라내기·복사·붙여넣기를 한다.
 * 메뉴 밖을 누르거나 창을 떠나면 닫는다. 키(`Esc` 포함)는 캔버스가 받아 닫는다.
 */
export default function MindMapContextMenu({ state, place, isMac, run, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const can = actionState(state)

  // 무대 밖으로 나가지 않게 자리를 맞춘다.
  useLayoutEffect(() => {
    const menu = ref.current
    const stage = menu?.offsetParent as HTMLElement | null
    if (!menu || !stage) return
    const { offsetWidth: w, offsetHeight: h } = menu
    const left = Math.max(EDGE, Math.min(place.x, stage.clientWidth - w - EDGE))
    const bottom = stage.clientHeight - EDGE
    // 위에 열 자리가 없으면 아래에, 아래에 열 자리가 없으면 위에 연다.
    let top = place.above ? place.y - FINGER - h : place.y
    if (place.above && top < EDGE) top = place.y + FINGER
    else if (!place.above && top + h > bottom) top = place.y - h
    top = Math.max(EDGE, Math.min(top, bottom - h))
    menu.style.left = `${left}px`
    menu.style.top = `${top}px`
    menu.style.visibility = 'visible'
  }, [place])

  useEffect(() => {
    const outside = (event: Event) => {
      if (!ref.current?.contains(event.target as Node)) onClose()
    }
    document.addEventListener('pointerdown', outside, true)
    window.addEventListener('blur', onClose)
    window.addEventListener('wheel', onClose, true)
    window.addEventListener('resize', onClose)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      window.removeEventListener('blur', onClose)
    window.removeEventListener('wheel', onClose, true)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose])

  const item = (label: string, command: EditorCommand, shortcut: 'cut' | 'copy' | 'paste', enabled: boolean) => (
    <button
      type="button"
      role="menuitem"
      className="mind-map-menu__item"
      disabled={!enabled}
      onClick={() => {
        onClose()
        run(command)
      }}
    >
      <span>{label}</span>
      <kbd aria-hidden="true">{shortcutText(shortcut, isMac)}</kbd>
    </button>
  )

  return (
    <div
      ref={ref}
      className="mind-map-menu"
      role="menu"
      aria-label="가지 메뉴"
      style={{ left: place.x, top: place.y, visibility: 'hidden' }}
      onPointerDown={keepFocus}
      onContextMenu={(event) => event.preventDefault()}
    >
      {item('잘라내기', { type: 'cut' }, 'cut', can.canDelete)}
      {item('복사', { type: 'copy' }, 'copy', can.canCopy)}
      {item('붙여넣기', { type: 'paste' }, 'paste', can.canPaste)}
    </div>
  )
}
