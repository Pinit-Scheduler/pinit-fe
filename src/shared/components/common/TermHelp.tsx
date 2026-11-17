import { useId, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { tipShift } from './termHelpPlacement'
import './TermHelp.css'

const matches = (element: Element | null, selector: string) => {
  try {
    return element?.matches(selector) ?? false
  } catch {
    return false
  }
}

/** 말풍선을 자르는 가장 가까운 상자(넘침을 감추거나 스크롤하는 조상)와 화면이 겹치는 가로 범위. */
const clipBounds = (from: Element) => {
  let left = 0
  let right = document.documentElement.clientWidth || window.innerWidth
  for (let node = from.parentElement; node && node !== document.body; node = node.parentElement) {
    if (getComputedStyle(node).overflowX === 'visible') continue
    const rect = node.getBoundingClientRect()
    left = Math.max(left, rect.left)
    right = Math.min(right, rect.right)
    break
  }
  return { left, right }
}

/**
 * 용어 옆의 "?" 표시. 마우스를 올리거나, 키보드로 초점을 주거나, 누르면(모바일) 설명이 뜬다.
 * 초점을 잃거나 Esc를 누르면 닫힌다. 설명이 떠 있을 때의 Esc는 설명만 닫고 바깥(창)으로 넘기지 않는다.
 * 말풍선은 화면과 그것을 자르는 상자 안에 들어오게 옆으로 민다. `<label>`·`<legend>` 안에서도 쓰도록
 * 누름을 밖으로 넘기지 않는다.
 */
export default function TermHelp({ label, children }: { label: string; children: ReactNode }) {
  const id = useId()
  const [pinned, setPinned] = useState(false)
  // Esc로 닫은 뒤에는 초점·마우스가 남아 있어도 감춘다. 초점을 잃거나 마우스가 떠나면 푼다.
  const [dismissed, setDismissed] = useState(false)
  const [shift, setShift] = useState(0)
  const rootRef = useRef<HTMLSpanElement>(null)
  const markRef = useRef<HTMLButtonElement>(null)
  const tipRef = useRef<HTMLSpanElement>(null)

  // 뜨기 직전에 잰다. 감춘 말풍선도 자리를 차지해 너비를 잴 수 있다.
  const place = () => {
    const mark = markRef.current
    const tip = tipRef.current
    if (!mark || !tip) return
    const rect = mark.getBoundingClientRect()
    setShift(tipShift(rect.left + rect.width / 2, tip.offsetWidth, clipBounds(tip)))
  }

  const shown = () =>
    pinned || matches(markRef.current, ':focus-visible') || matches(rootRef.current, ':hover')

  return (
    <span
      ref={rootRef}
      className="term-help"
      data-open={pinned || undefined}
      data-dismissed={dismissed || undefined}
      onPointerEnter={place}
      onPointerLeave={() => setDismissed(false)}
    >
      <button
        ref={markRef}
        type="button"
        className="term-help__mark"
        aria-label={`${label} 설명`}
        aria-describedby={id}
        aria-expanded={pinned}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          place()
          setDismissed(false)
          setPinned((open) => !open)
        }}
        onFocus={place}
        onBlur={() => {
          setPinned(false)
          setDismissed(false)
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Escape' || dismissed || !shown()) return
          event.stopPropagation()
          setPinned(false)
          setDismissed(true)
        }}
      >
        ?
      </button>
      <span
        ref={tipRef}
        role="tooltip"
        id={id}
        className="term-help__tip"
        style={{ '--term-help-shift': `${shift}px` } as CSSProperties}
      >
        {children}
      </span>
    </span>
  )
}
