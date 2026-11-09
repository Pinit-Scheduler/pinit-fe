import { MOTION_ENTER_MS, prefersReducedMotion } from '@shared/motion'

/** --motion-ease, for the Web Animations API (keep in step with src/shared/styles/motion.css). */
const EASE = 'cubic-bezier(0.2, 0, 0, 1)'
/** --motion-distance. */
const DISTANCE = 8

/**
 * Plays a short rise on an element whose content the person just swapped in place,
 * for example the hub overview after choosing another space. The element stays mounted:
 * nothing is re-keyed and no data is thrown away. Under reduced motion it only fades.
 */
export function riseIn(element: Element | null | undefined) {
  if (!element || typeof (element as HTMLElement).animate !== 'function') return
  const frames = prefersReducedMotion()
    ? [{ opacity: 0 }, { opacity: 1 }]
    : [
        { opacity: 0, transform: `translateY(${DISTANCE}px)` },
        { opacity: 1, transform: 'none' },
      ]
  ;(element as HTMLElement).animate(frames, { duration: MOTION_ENTER_MS, easing: EASE })
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
