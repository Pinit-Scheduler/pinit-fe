import { MOTION_DISTANCE_PX, MOTION_EASE, MOTION_ENTER_MS, prefersReducedMotion } from './tokens'

type RiseOptions = {
  /** Slide in from the left (-1) or the right (1) instead of rising from below. */
  direction?: -1 | 0 | 1
  distance?: number
  fromOpacity?: number
}

/**
 * Plays the motion-rise-in entrance with Web Animations, for content that changed in place
 * and so cannot replay a CSS entrance without being re-keyed. Under reduced motion it only fades.
 */
export function playRise(
  element: Element | null | undefined,
  { direction = 0, distance = MOTION_DISTANCE_PX, fromOpacity = 0 }: RiseOptions = {},
): Animation | undefined {
  if (!element || typeof (element as HTMLElement).animate !== 'function') return undefined
  const from = prefersReducedMotion()
    ? 'none'
    : direction
      ? `translateX(${direction * distance}px)`
      : `translateY(${distance}px)`
  return (element as HTMLElement).animate(
    [
      { opacity: fromOpacity, transform: from },
      { opacity: 1, transform: 'none' },
    ],
    { duration: MOTION_ENTER_MS, easing: MOTION_EASE },
  )
}
