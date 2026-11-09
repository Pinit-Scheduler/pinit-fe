import { useRef, type ReactNode } from 'react'

/**
 * 행 동작 메뉴(⋯). 항목을 누르거나 초점이 밖으로 나가면 닫히고, Esc로 닫으면 초점이 ⋯로 돌아간다.
 */
export default function RowMenu({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  const menu = useRef<HTMLDetailsElement>(null)
  const close = (focus: boolean) => {
    if (!menu.current) return
    menu.current.open = false
    if (focus) menu.current.querySelector('summary')?.focus()
  }
  return (
    <details
      ref={menu}
      className="hub-menu"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && menu.current?.open) {
          event.stopPropagation()
          close(true)
        }
      }}
      onBlur={(event) => {
        if (!menu.current?.contains(event.relatedTarget as Node | null))
          close(false)
      }}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest('.hub-menu__list button'))
          close(false)
      }}
    >
      <summary aria-label={label}>
        <span aria-hidden>⋯</span>
      </summary>
      <div className="hub-menu__list">{children}</div>
    </details>
  )
}
