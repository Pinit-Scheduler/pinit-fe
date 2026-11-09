import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { MOTION_EXIT_MS } from '@shared/motion'

/**
 * 행 동작 메뉴(⋯).
 * - 항목을 누르면 닫고 초점을 ⋯로 돌린다. 그 뒤 열리는 대화상자가 닫힐 때 초점이 ⋯로 돌아온다.
 * - 메뉴 밖을 누르거나 Tab으로 밖으로 나가면 닫는다. 꺼진 항목·안내 문구를 눌러도 닫히지 않는다.
 * - Esc로 닫으면 초점이 ⋯로 돌아간다.
 * - 열면 ⋯ 아래로 살짝 내려오며 나타나고, 닫으면 짧게 흐려진 뒤 닫힌다. 닫히는 동안은 누를 수 없다.
 */
export default function RowMenu({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  const menu = useRef<HTMLDetailsElement>(null)
  const [open, setOpen] = useState(false)
  const [closing, setClosing] = useState(false)
  const closingRef = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const close = useCallback((focus: boolean) => {
    const details = menu.current
    if (!details || !details.open) return
    // Focus moves at once, so a dialog opened from an item still returns focus to ⋯.
    if (focus) details.querySelector('summary')?.focus()
    if (closingRef.current) return
    // The list fades for one exit, then the native close.
    closingRef.current = true
    setClosing(true)
    timer.current = setTimeout(() => {
      closingRef.current = false
      setClosing(false)
      if (menu.current) menu.current.open = false
    }, MOTION_EXIT_MS)
  }, [])
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => {
      if (menu.current && !menu.current.contains(event.target as Node))
        close(false)
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open, close])
  return (
    <details
      ref={menu}
      className="hub-menu"
      data-state={closing ? 'closing' : undefined}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && menu.current?.open) {
          event.stopPropagation()
          close(true)
        }
      }}
      onBlur={(event) => {
        const next = event.relatedTarget as Node | null
        if (next && !menu.current?.contains(next)) close(false)
      }}
      onClick={(event) => {
        const item = (event.target as HTMLElement).closest<HTMLButtonElement>(
          '.hub-menu__list button',
        )
        if (item && !item.disabled) close(true)
      }}
    >
      <summary
        aria-label={label}
        onClick={(event) => {
          // Closing from ⋯ plays the same exit. Opening stays native.
          if (!menu.current?.open) return
          event.preventDefault()
          close(false)
        }}
      >
        <span aria-hidden>⋯</span>
      </summary>
      <div className="hub-menu__list" inert={closing || undefined}>
        {children}
      </div>
    </details>
  )
}
