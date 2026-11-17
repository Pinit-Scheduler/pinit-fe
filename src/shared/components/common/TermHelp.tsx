import { useId, useState, type ReactNode } from 'react'
import './TermHelp.css'

/**
 * 용어 옆의 "?" 표시. 마우스를 올리거나, 키보드로 초점을 주거나, 누르면(모바일) 설명이 뜬다.
 * 초점을 잃거나 Esc를 누르면 닫힌다. `<label>`·`<legend>` 안에서도 쓰도록 누름을 밖으로 넘기지 않는다.
 */
export default function TermHelp({ label, children }: { label: string; children: ReactNode }) {
  const id = useId()
  const [pinned, setPinned] = useState(false)
  return (
    <span className="term-help" data-open={pinned || undefined}>
      <button
        type="button"
        className="term-help__mark"
        aria-label={`${label} 설명`}
        aria-describedby={id}
        aria-expanded={pinned}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          setPinned((open) => !open)
        }}
        onBlur={() => setPinned(false)}
        onKeyDown={(event) => {
          if (event.key !== 'Escape' || !pinned) return
          event.stopPropagation()
          setPinned(false)
        }}
      >
        ?
      </button>
      <span role="tooltip" id={id} className="term-help__tip">
        {children}
      </span>
    </span>
  )
}
