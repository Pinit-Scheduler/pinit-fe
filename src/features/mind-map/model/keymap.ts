import type { EditorCommand } from './editor'

export type KeyLike = {
  key: string
  keyCode?: number
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
  isComposing?: boolean
}
export type KeyAction = { command: EditorCommand; preventDefault: boolean }

const IME_KEY_CODE = 229
const DIRECTIONS = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
} as const

const handled = (command: EditorCommand): KeyAction => ({ command, preventDefault: true })

const isComposing = (event: KeyLike) => event.isComposing === true || event.keyCode === IME_KEY_CODE

/** 코드 포인트 하나인 글자 키. 한글 조합이 시작되는 키(`Process`, keyCode 229)도 글자로 본다. */
const isTypingKey = (event: KeyLike) => event.keyCode === IME_KEY_CODE || [...event.key].length === 1

const editingAction = (event: KeyLike): KeyAction | null => {
  if (isComposing(event)) return null
  if (event.ctrlKey || event.metaKey || event.altKey) return null
  if (event.key === 'Enter') return handled({ type: 'commit' })
  if (event.key === 'Tab' && !event.shiftKey) return handled({ type: 'commitAndAddChild' })
  if (event.key === 'Escape') return handled({ type: 'cancel' })
  return null
}

const commandKeyAction = (event: KeyLike): KeyAction | null => {
  const key = event.key.toLowerCase()
  if (event.altKey) return null
  if (event.key === 'Enter') return handled({ type: event.shiftKey ? 'toggleCheckbox' : 'toggleCheck' })
  if (key === '/' && !event.shiftKey) return handled({ type: 'toggleCollapse' })
  if (key === 'z') return handled({ type: event.shiftKey ? 'redo' : 'undo' })
  if (key === 'y' && !event.shiftKey) return handled({ type: 'redo' })
  return null
}

const selectedAction = (event: KeyLike): KeyAction | null => {
  if (event.ctrlKey || event.metaKey) return commandKeyAction(event)
  const dir = DIRECTIONS[event.key as keyof typeof DIRECTIONS]
  if (event.altKey) {
    if (event.key === 'ArrowUp') return handled({ type: 'reorder', step: -1 })
    if (event.key === 'ArrowDown') return handled({ type: 'reorder', step: 1 })
    return null
  }
  if (dir) return handled({ type: 'navigate', dir })
  if (isComposing(event) && event.key !== 'Process') return null
  switch (event.key) {
    case 'Tab':
      return event.shiftKey ? null : handled({ type: 'addChild' })
    case 'Enter':
      return handled({ type: 'addSibling' })
    case 'F2':
    case ' ':
      return handled({ type: 'startEdit' })
    case 'Delete':
    case 'Backspace':
      return handled({ type: 'delete' })
  }
  // 친 글자가 선택된 글을 대신하도록 기본 동작을 막지 않는다.
  if (isTypingKey(event)) return { command: { type: 'startEdit' }, preventDefault: false }
  return null
}

/** 키 하나를 편집기 명령으로 바꾼다. 맞는 명령이 없으면 `null`이다. */
export const keyAction = (event: KeyLike, editing: boolean): KeyAction | null =>
  editing ? editingAction(event) : selectedAction(event)

export type ShortcutName = 'child' | 'sibling' | 'edit' | 'checkbox' | 'collapse' | 'delete' | 'undo'

const SHORTCUTS: Record<ShortcutName, string> = {
  child: 'Tab',
  sibling: 'Enter',
  edit: 'F2',
  checkbox: '{mod} ⇧ Enter',
  collapse: '{mod} /',
  delete: 'Del',
  undo: '{mod} Z',
}

/** 단추 옆에 보이는 단축키 글. Mac은 `Ctrl` 자리가 `⌘`다. */
export const shortcutText = (name: ShortcutName, isMac: boolean): string =>
  SHORTCUTS[name].replace('{mod}', isMac ? '⌘' : 'Ctrl')
