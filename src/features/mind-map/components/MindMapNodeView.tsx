import { useLayoutEffect, useRef } from 'react'
import type { CSSProperties, PointerEvent } from 'react'
import type { Box } from '../model/editor'
import type { VisibleNode } from '../model/layout'
import { normalizeText } from '../model/text'
import { hiddenCount } from '../model/tree'
import type { MindMapNode } from '../model/tree'

type Props = {
  node: MindMapNode
  place: VisibleNode
  box: Box | undefined
  selected: boolean
  editing: boolean
  readOnly: boolean
  dropTarget: boolean
  nodeRef?: (id: string, el: HTMLElement | null) => void
  onLabelInput?: (text: string) => void
  onCheckClick?: (id: string) => void
  onToggleClick?: (id: string) => void
}

let editableMode: 'plaintext-only' | 'true' | null = null
/** `plaintext-only`를 모르는 브라우저는 `true`로 쓴다(줄바꿈과 서식은 글을 읽을 때 버린다). */
const editable = (): 'plaintext-only' | 'true' => {
  if (editableMode) return editableMode
  const probe = document.createElement('span')
  try {
    probe.contentEditable = 'plaintext-only'
    editableMode = probe.contentEditable === 'plaintext-only' ? 'plaintext-only' : 'true'
  } catch {
    editableMode = 'true'
  }
  return editableMode
}

/** 단추를 눌러도 초점(캔버스나 쓰는 글)이 옮겨 가지 않게 한다. */
const keepFocus = (event: PointerEvent) => event.preventDefault()

const CheckMark = () => (
  <svg viewBox="0 0 10 10" aria-hidden="true">
    <path d="M2 5.2 4.1 7.3 8 2.9" />
  </svg>
)

/** 가지 하나. 쓰는 중이면 라벨이 글 상자가 되고 처음에 글 전체를 고른다. */
export default function MindMapNodeView({
  node,
  place,
  box,
  selected,
  editing,
  readOnly,
  dropTarget,
  nodeRef,
  onLabelInput,
  onCheckClick,
  onToggleClick,
}: Props) {
  const labelRef = useRef<HTMLSpanElement>(null)
  const { id, check, collapsed } = node
  const depth = Math.min(place.depth, 2)
  const hasChildren = node.children.length > 0

  // 쓰기를 시작할 때 한 번만 글을 넣는다. 그 뒤의 글은 브라우저가 다루고 `input`으로 올린다.
  useLayoutEffect(() => {
    const label = labelRef.current
    if (!editing || !label) return
    label.textContent = node.text
    label.focus({ preventScroll: true })
    const range = document.createRange()
    range.selectNodeContents(label)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing])

  const style = {
    '--branch': place.color === null ? 'var(--workspace-muted)' : `var(--workspace-mind-map-branch-${place.color})`,
    transform: `translate(${box?.x ?? 0}px, ${box?.y ?? 0}px)`,
  } as CSSProperties
  const className = [
    'mind-map-node',
    selected && 'is-selected',
    editing && 'is-editing',
    dropTarget && 'is-drop',
  ]
    .filter(Boolean)
    .join(' ')
  const tree = readOnly
    ? {}
    : {
        // 캔버스의 aria-activedescendant가 이 id를 가리킨다.
        id: `mind-map-node-${id}`,
        role: 'treeitem',
        'aria-level': place.depth + 1,
        'aria-setsize': place.siblings,
        'aria-posinset': place.index,
        'aria-selected': selected,
        'aria-expanded': hasChildren ? !collapsed : undefined,
        'aria-checked': check === 'NONE' ? undefined : check === 'DONE',
      }

  return (
    <div
      className={className}
      data-depth={depth}
      data-check={check === 'NONE' ? undefined : check}
      style={style}
      ref={nodeRef ? (el) => nodeRef(id, el) : undefined}
      {...tree}
    >
      {check !== 'NONE' && (
        <span
          className="mind-map-node__check"
          aria-hidden="true"
          onPointerDown={readOnly ? undefined : keepFocus}
          onClick={readOnly ? undefined : () => onCheckClick?.(id)}
        >
          {check === 'DONE' && <CheckMark />}
        </span>
      )}
      <span
        key={editing ? 'editing' : 'shown'}
        ref={labelRef}
        className={'mind-map-node__label' + (normalizeText(node.text) === '' ? ' is-blank' : '')}
        data-placeholder={place.depth === 0 ? '주제 적기' : '할 일 적기'}
        contentEditable={editing ? editable() : undefined}
        role={editing ? 'textbox' : undefined}
        aria-label={editing ? '가지 글' : undefined}
        suppressContentEditableWarning
        spellCheck={editing ? false : undefined}
        onInput={
          editing
            ? (event) => onLabelInput?.((event.currentTarget.textContent ?? '').replace(/[\r\n]/g, ' '))
            : undefined
        }
      >
        {editing ? null : node.text}
      </span>
      {hasChildren &&
        (readOnly ? (
          collapsed && (
            <span className="mind-map-node__toggle" data-closed="">
              {hiddenCount(node)}
            </span>
          )
        ) : (
          <button
            type="button"
            className="mind-map-node__toggle"
            tabIndex={-1}
            aria-label={collapsed ? '가지 펴기' : '가지 접기'}
            data-closed={collapsed ? '' : undefined}
            onPointerDown={keepFocus}
            onClick={() => onToggleClick?.(id)}
          >
            {collapsed ? hiddenCount(node) : '−'}
          </button>
        ))}
    </div>
  )
}
