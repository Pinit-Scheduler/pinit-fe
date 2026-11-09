const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])'

const focusables = (root: Element) =>
  Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))

const isLeaving = (row: Element) => row.getAttribute('data-presence') === 'exit'

/**
 * A row that starts leaving becomes inert, and the browser would drop the focus inside it on
 * the body. Move it to the same control in the row that takes its place, else the row above,
 * else `fallback` (the panel heading), so a keyboard user keeps their place in the list.
 * Returns true when it moved the focus.
 */
export function moveFocusOutOfLeavingRow(
  root: HTMLElement | null,
  fallback: (leaving: HTMLElement) => HTMLElement | null,
): boolean {
  const active = document.activeElement
  if (!root || !(active instanceof HTMLElement) || !root.contains(active)) return false
  const leaving = active.closest<HTMLElement>('[data-presence="exit"]')
  if (!leaving || !root.contains(leaving)) return false
  const index = focusables(leaving).indexOf(active)
  const pick = (row: Element | null, step: 'nextElementSibling' | 'previousElementSibling') => {
    for (let candidate = row; candidate; candidate = candidate[step]) {
      if (isLeaving(candidate)) continue
      const controls = focusables(candidate)
      const target = controls[index] ?? controls[0]
      if (target) return target
    }
    return null
  }
  const target =
    pick(leaving.nextElementSibling, 'nextElementSibling') ??
    pick(leaving.previousElementSibling, 'previousElementSibling') ??
    fallback(leaving)
  if (!target) return false
  target.focus()
  return true
}
