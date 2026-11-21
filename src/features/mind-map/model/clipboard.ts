import { clipText, normalizeText, textLength } from './text'
import type { CheckState, MindMapNode } from './tree'

/** 잘라내거나 복사한 가지. id는 붙여 넣을 때마다 새로 만든다. */
export type ClipNode = { text: string; collapsed: boolean; check: CheckState; children: ClipNode[] }
/** `text`는 시스템 클립보드에 쓴 글이다. 붙여 넣는 글이 이것과 같으면 접힘까지 지킨 `nodes`를 쓴다. */
export type Clipboard = { nodes: ClipNode[]; text: string }

const INDENT = '  '
const TAB_WIDTH = 4
const BULLET = /^(?:[-*+•]|\d+[.)])\s+/
const CHECKBOX = /^\[([ xX])\]\s+/

const toClip = (node: MindMapNode): ClipNode => ({
  text: node.text,
  collapsed: node.collapsed,
  check: node.check,
  children: node.children.map(toClip),
})

const checkMark = (check: CheckState) => (check === 'OPEN' ? '[ ] ' : check === 'DONE' ? '[x] ' : '')

/** 들여 쓴 목록 글. 다른 앱에 붙여도 읽히고, 이 화면에 다시 붙이면 같은 나무가 된다. */
export const outlineText = (nodes: readonly ClipNode[]): string => {
  const lines: string[] = []
  const walk = (node: ClipNode, depth: number) => {
    lines.push(`${INDENT.repeat(depth)}- ${checkMark(node.check)}${node.text}`)
    node.children.forEach((child) => walk(child, depth + 1))
  }
  nodes.forEach((node) => walk(node, 0))
  return lines.join('\n')
}

/** 여러 가지를 주어진 차례대로 담는다. */
export const clipboardOfNodes = (list: readonly MindMapNode[]): Clipboard => {
  const nodes = list.map(toClip)
  return { nodes, text: outlineText(nodes) }
}

export const clipboardOf = (node: MindMapNode): Clipboard => clipboardOfNodes([node])

const indentWidth = (line: string): number => {
  let width = 0
  for (const char of line) {
    if (char === ' ') width += 1
    else if (char === '\t') width += TAB_WIDTH
    else break
  }
  return width
}

/**
 * 붙여 넣은 글을 가지로 읽는다. 빈 줄이 아닌 줄마다 가지 하나이고, 더 들여 쓴 줄은 위 줄의 하위 가지다.
 * 줄 앞의 목록 기호(`-` `*` `1.`)는 빼고 `[ ]` `[x]`는 체크박스로 읽는다. 한도를 넘는 글은 자르고 `clipped`로 알린다.
 */
export const parseOutline = (raw: string, maxTextLength: number): { nodes: ClipNode[]; clipped: boolean } => {
  const nodes: ClipNode[] = []
  const stack: { indent: number; node: ClipNode }[] = []
  let clipped = false
  for (const line of raw.split(/\r\n|\r|\n/)) {
    const indent = indentWidth(line)
    let body = line.trim().replace(BULLET, '')
    let check: CheckState = 'NONE'
    const box = CHECKBOX.exec(body)
    if (box) {
      check = box[1] === ' ' ? 'OPEN' : 'DONE'
      body = body.slice(box[0].length)
    }
    let text = normalizeText(body)
    if (text === '') continue
    if (textLength(text) > maxTextLength) {
      text = normalizeText(clipText(text, maxTextLength))
      clipped = true
    }
    const node: ClipNode = { text, collapsed: false, check, children: [] }
    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) stack.pop()
    const parent = stack[stack.length - 1]
    if (parent) parent.node.children.push(node)
    else nodes.push(node)
    stack.push({ indent, node })
  }
  return { nodes, clipped }
}

/** 줄 끝과 줄 끝 공백만 다른 글은 같다(클립보드가 줄 끝을 `\r\n`으로 바꾸기도 한다). */
const comparable = (text: string) =>
  text
    .split(/\r\n|\r|\n/)
    .map((line) => line.trimEnd())
    .join('\n')
    .trim()

/**
 * 붙여 넣을 가지. 글이 없거나(시스템 클립보드를 읽지 못했거나 비었으면) 화면이 복사한 글과 같으면 화면의 클립보드,
 * 다르면 그 글을 읽은 가지다. 붙일 것이 없으면 `null`이다.
 */
export const pasteSource = (
  clipboard: Clipboard | null,
  text: string | undefined,
  maxTextLength: number,
): { nodes: ClipNode[]; clipped: boolean } | null => {
  if (text !== undefined && (clipboard === null || comparable(text) !== comparable(clipboard.text))) {
    const parsed = parseOutline(text, maxTextLength)
    if (parsed.nodes.length > 0) return parsed
  }
  return clipboard && clipboard.nodes.length > 0 ? { nodes: clipboard.nodes, clipped: false } : null
}

export const clipCount = (node: ClipNode): number => node.children.reduce((sum, child) => sum + clipCount(child), 1)

export const clipHeight = (node: ClipNode): number =>
  node.children.reduce((max, child) => Math.max(max, clipHeight(child) + 1), 0)

/** 새 id를 단 가지. 자식이 없으면 접지 않는다. */
export const plant = (node: ClipNode, newId: () => string): MindMapNode => {
  const id = newId()
  const children = node.children.map((child) => plant(child, newId))
  return { id, text: node.text, collapsed: node.collapsed && children.length > 0, check: node.check, children }
}
