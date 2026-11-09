import { useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * 행 동작 메뉴(⋯).
 * - 항목을 누르면 닫고 초점을 ⋯로 돌린다. 그 뒤 열리는 대화상자가 닫힐 때 초점이 ⋯로 돌아온다.
 * - 메뉴 밖을 누르거나 Tab으로 밖으로 나가면 닫는다. 꺼진 항목·안내 문구를 눌러도 닫히지 않는다.
 * - Esc로 닫으면 초점이 ⋯로 돌아간다.
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
  const close = (focus: boolean) => {
    if (!menu.current) return
    if (focus) menu.current.querySelector('summary')?.focus()
    menu.current.open = false
  }
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => {
      if (menu.current && !menu.current.contains(event.target as Node))
        menu.current.open = false
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open])
  return (
    <details
      ref={menu}
      className="hub-menu"
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
      <summary aria-label={label}>
        <span aria-hidden>⋯</span>
      </summary>
      <div className="hub-menu__list">{children}</div>
    </details>
  )
}
