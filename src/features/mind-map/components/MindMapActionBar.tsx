import type { PointerEvent } from 'react'
import { actionState } from '../model/editor'
import type { EditorCommand, EditorState } from '../model/editor'
import { shortcutText } from '../model/keymap'
import type { ShortcutName } from '../model/keymap'

type Props = {
  state: EditorState
  dispatch: (command: EditorCommand) => void
  isMac: boolean
}

const ICONS = {
  child: 'M3 3v5a3 3 0 0 0 3 3h7m0 0-3-3m3 3-3 3',
  sibling: 'M8 3v10m0 0-4-4m4 4 4-4',
  edit: 'm3 13 1-4 7-7 3 3-7 7-4 1Z',
  checkbox: 'M3.5 2.5h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1Zm2 5.6 1.8 1.8 3.2-3.6',
  fold: 'M13.5 8a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0ZM5.5 8h5',
  unfold: 'M13.5 8a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0ZM5.5 8h5M8 5.5v5',
  delete: 'M3 5h10M6.5 5V3h3v2M4.5 5l.8 8h5.4l.8-8',
  undo: 'M4 6h6a3 3 0 0 1 0 6H7M4 6l3-3M4 6l3 3',
} as const

/** 단추를 눌러도 초점(캔버스나 쓰는 글)이 옮겨 가지 않게 한다. */
const keepFocus = (event: PointerEvent) => event.preventDefault()

type ActionProps = {
  icon: keyof typeof ICONS
  label: string
  shortcut: ShortcutName
  isMac: boolean
  disabled?: boolean
  pressed?: boolean
  onClick: () => void
}

function Action({ icon, label, shortcut, isMac, disabled, pressed, onClick }: ActionProps) {
  return (
    <button
      type="button"
      className="mind-map-actions__button"
      disabled={disabled}
      aria-pressed={pressed}
      onClick={onClick}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d={ICONS[icon]} />
      </svg>
      <span className="mind-map-actions__label">{label}</span>
      <kbd aria-hidden="true">{shortcutText(shortcut, isMac)}</kbd>
    </button>
  )
}

/** 캔버스 아래에 뜬 동작 단추 줄. 터치에서는 이 줄이 주 조작 수단이다. */
export default function MindMapActionBar({ state, dispatch, isMac }: Props) {
  const can = actionState(state)
  const common = { isMac }
  return (
    <div className="mind-map-actions" role="toolbar" aria-label="가지 편집" onPointerDown={keepFocus}>
      <Action {...common} icon="child" label="하위 가지" shortcut="child" onClick={() => dispatch({ type: 'addChild' })} />
      <Action
        {...common}
        icon="sibling"
        label="같은 단계"
        shortcut="sibling"
        onClick={() => dispatch({ type: 'addSibling' })}
      />
      <Action {...common} icon="edit" label="글 고치기" shortcut="edit" onClick={() => dispatch({ type: 'startEdit' })} />
      <Action
        {...common}
        icon="checkbox"
        label="체크박스"
        shortcut="checkbox"
        disabled={!can.canCheckbox}
        pressed={can.hasCheckbox}
        onClick={() => dispatch({ type: 'toggleCheckbox' })}
      />
      <Action
        {...common}
        icon={can.collapsed ? 'unfold' : 'fold'}
        label={can.collapsed ? '펴기' : '접기'}
        shortcut="collapse"
        disabled={!can.canCollapse}
        onClick={() => dispatch({ type: 'toggleCollapse' })}
      />
      <Action
        {...common}
        icon="delete"
        label="삭제"
        shortcut="delete"
        disabled={!can.canDelete}
        onClick={() => dispatch({ type: 'delete' })}
      />
      <span className="mind-map-actions__sep" aria-hidden="true" />
      <Action
        {...common}
        icon="undo"
        label="되돌리기"
        shortcut="undo"
        disabled={!can.canUndo}
        onClick={() => dispatch({ type: 'undo' })}
      />
    </div>
  )
}
