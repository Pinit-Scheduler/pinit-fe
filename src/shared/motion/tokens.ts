/**
 * Motion values for code that must wait for or play an animation (delayed unmount, tweens,
 * Web Animations). They mirror the CSS custom properties in src/shared/styles/motion.css. Change both together.
 */
export const MOTION_FAST_MS = 120
export const MOTION_BASE_MS = 180
export const MOTION_ENTER_MS = 240
export const MOTION_EXIT_MS = 160
/** --motion-ease. */
export const MOTION_EASE = 'cubic-bezier(0.2, 0, 0, 1)'
/** --motion-distance: how far a rise travels. */
export const MOTION_DISTANCE_PX = 8
/** --motion-stagger: delay between rows that arrive together. */
export const MOTION_STAGGER_MS = 24
/** --motion-flash: how long a highlight on a changed row lasts. */
export const MOTION_FLASH_MS = 1200
/** --motion-strike-delay: the strike line starts this long after the completion check. */
export const MOTION_STRIKE_DELAY_MS = 80
/**
 * A row just completed keeps its place this long before a refresh may take it off a list:
 * the strike finishes, then the row rests in its completed style for an exit's length.
 */
export const COMPLETION_HOLD_MS = MOTION_STRIKE_DELAY_MS + MOTION_ENTER_MS + MOTION_EXIT_MS

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** The MOTION_EASE curve, sampled for JS tweens. */
export const motionEase = (t: number) => {
  if (t <= 0) return 0
  if (t >= 1) return 1
  // Solve x(s) = t for the bezier parameter s, then return y(s).
  const x1 = 0.2, y1 = 0, x2 = 0, y2 = 1
  const bx = (s: number) => 3 * x1 * s * (1 - s) ** 2 + 3 * x2 * s ** 2 * (1 - s) + s ** 3
  const by = (s: number) => 3 * y1 * s * (1 - s) ** 2 + 3 * y2 * s ** 2 * (1 - s) + s ** 3
  let lo = 0, hi = 1, s = t
  for (let i = 0; i < 24; i++) {
    s = (lo + hi) / 2
    if (bx(s) < t) lo = s
    else hi = s
  }
  return by(s)
}
