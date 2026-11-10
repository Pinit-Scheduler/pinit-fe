import { MOTION_BASE_MS, MOTION_EASE } from '@shared/motion'

/**
 * Fades in text that was replaced in place, so a value that arrives or changes
 * (a form's affiliation line filling in the server's default assignee) does not jump.
 * Opacity only, so it also plays under reduced motion.
 */
export function fadeIn(element: Element | null | undefined) {
  if (!element || typeof (element as HTMLElement).animate !== 'function') return
  ;(element as HTMLElement).animate([{ opacity: 0 }, { opacity: 1 }], {
    duration: MOTION_BASE_MS,
    easing: MOTION_EASE,
  })
}

/**
 * Whether a text that changed in place should fade in.
 * The first value (what the form opened with) never animates: the surface's own entrance covers it.
 */
export function shouldFadeText(before: string | null, after: string): boolean {
  return before !== null && before !== after
}

/**
 * Decides which hub pane to animate after a selection or a narrow-screen pane switch.
 * - Another space chosen: the overview rises (its content changed in place).
 * - On a narrow screen, opening the detail: the overview rises; going back: the rail rises.
 * - The first space arriving (initial load) animates nothing.
 */
export function hubPaneToAnimate(
  before: { spaceId: number | null; detail: boolean },
  after: { spaceId: number | null; detail: boolean },
  narrow: boolean,
): 'overview' | 'rail' | null {
  if (narrow && before.detail && !after.detail) return 'rail'
  if (after.spaceId === null) return null
  if (before.spaceId !== null && before.spaceId !== after.spaceId) return 'overview'
  if (narrow && !before.detail && after.detail) return 'overview'
  return null
}
