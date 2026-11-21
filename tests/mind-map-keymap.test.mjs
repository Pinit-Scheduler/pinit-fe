import assert from 'node:assert/strict'
import test from 'node:test'
import { loadModules } from './support/mocks.mjs'

const load = loadModules()
const keymap = load('src/features/mind-map/model/keymap.ts')
const plain = (value) => JSON.parse(JSON.stringify(value))
const k = (key, extra = {}) => ({ key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...extra })
const type = (event, editing = false) => keymap.keyAction(event, editing)?.command.type ?? null

test('고른 상태의 키', () => {
  assert.equal(type(k('Tab')), 'addChild')
  assert.equal(type(k('Enter')), 'addSibling')
  assert.equal(type(k('F2')), 'startEdit')
  assert.equal(type(k(' ')), 'startEdit')
  assert.equal(type(k('Delete')), 'delete')
  assert.equal(type(k('Backspace')), 'delete')
  assert.deepEqual(plain(keymap.keyAction(k('ArrowUp'), false).command), { type: 'navigate', dir: 'up' })
  assert.deepEqual(plain(keymap.keyAction(k('ArrowUp', { altKey: true }), false).command), { type: 'reorder', step: -1 })
  assert.equal(type(k('/', { ctrlKey: true })), 'toggleCollapse')
  assert.equal(type(k('/', { metaKey: true })), 'toggleCollapse')
  assert.equal(type(k('Enter', { ctrlKey: true })), 'toggleCheck')
  assert.equal(type(k('Enter', { ctrlKey: true, shiftKey: true })), 'toggleCheckbox')
  assert.equal(type(k('z', { ctrlKey: true })), 'undo')
  assert.equal(type(k('z', { metaKey: true })), 'undo')
  assert.equal(type(k('Z', { ctrlKey: true, shiftKey: true })), 'redo')
  assert.equal(type(k('y', { ctrlKey: true })), 'redo')
})
test('잘라내기·복사·붙여넣기 단축키. 붙여넣기는 브라우저의 붙여넣기 이벤트를 위해 기본 동작을 막지 않는다', () => {
  assert.equal(type(k('x', { ctrlKey: true })), 'cut')
  assert.equal(type(k('c', { metaKey: true })), 'copy')
  assert.deepEqual(plain(keymap.keyAction(k('v', { ctrlKey: true }), false)), {
    command: { type: 'paste' },
    preventDefault: false,
  })
  assert.equal(keymap.keyAction(k('c', { ctrlKey: true }), false).preventDefault, true)
  assert.equal(type(k('C', { ctrlKey: true, shiftKey: true })), null)
  assert.equal(type(k('c', { ctrlKey: true }), true), null, '쓰는 중에는 글의 복사다')
  assert.equal(type(k('v', { ctrlKey: true }), true), null)
  // 한글 자판: key는 자모, code는 물리 키다.
  assert.equal(type(k('ㅊ', { ctrlKey: true, code: 'KeyC' })), 'copy')
  assert.equal(type(k('ㅌ', { ctrlKey: true, code: 'KeyX' })), 'cut')
  assert.equal(type(k('ㅍ', { metaKey: true, code: 'KeyV' })), 'paste')
  assert.equal(type(k('ㅋ', { ctrlKey: true, code: 'KeyZ' })), 'undo')
  // 라틴 자판은 key를 따른다(Dvorak에서 물리 KeyC는 j).
  assert.equal(type(k('j', { ctrlKey: true, code: 'KeyC' })), null)
  assert.equal(keymap.shortcutText('paste', true), '⌘ V')
  assert.equal(keymap.shortcutText('cut', false), 'Ctrl X')
})

test('글자 키는 바로 고치기이고 기본 동작을 막지 않는다', () => {
  assert.deepEqual(plain(keymap.keyAction(k('가'), false)), { command: { type: 'startEdit' }, preventDefault: false })
  assert.deepEqual(plain(keymap.keyAction(k('Process', { keyCode: 229 }), false)), { command: { type: 'startEdit' }, preventDefault: false })
  assert.equal(keymap.keyAction(k('a', { ctrlKey: true }), false), null)
  assert.equal(keymap.keyAction(k('x', { altKey: true }), false), null)
  assert.equal(keymap.keyAction(k('Shift', { shiftKey: true }), false), null)
})
test('쓰는 중의 키', () => {
  assert.equal(type(k('Enter'), true), 'commit')
  assert.equal(type(k('Enter', { shiftKey: true }), true), 'commit')
  assert.equal(type(k('Tab'), true), 'commitAndAddChild')
  assert.equal(type(k('Escape'), true), 'cancel')
  assert.equal(keymap.keyAction(k('a'), true), null)
  assert.equal(keymap.keyAction(k('Delete'), true), null)
})
test('조합 중에는 Enter·Tab·Esc를 쓰지 않는다', () => {
  for (const key of ['Enter', 'Tab', 'Escape']) {
    assert.equal(keymap.keyAction(k(key, { isComposing: true }), true), null, key)
    assert.equal(keymap.keyAction(k(key, { keyCode: 229 }), true), null, key)
  }
})
test('단추 옆 단축키 글', () => {
  assert.equal(keymap.shortcutText('checkbox', false), 'Ctrl ⇧ Enter')
  assert.equal(keymap.shortcutText('undo', true), '⌘ Z')
  assert.equal(keymap.shortcutText('child', true), 'Tab')
})

test('글을 쓰지 않을 때 Esc는 주 가지 하나만 남긴다', () => {
  const key = (k) => ({ key: k, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false })
  assert.deepEqual(plain(keymap.keyAction(key('Escape'), false)), { command: { type: 'single' }, preventDefault: true })
  assert.equal(keymap.keyAction(key('Escape'), true).command.type, 'cancel')
})
