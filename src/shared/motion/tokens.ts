/**
 * Motion timings for code that must wait for an animation (delayed unmount, tweens).
 * They mirror the CSS custom properties in src/shared/styles/motion.css. Change both together.
 */
export const MOTION_FAST_MS = 120
export const MOTION_BASE_MS = 180
export const MOTION_ENTER_MS = 240
export const MOTION_EXIT_MS = 160
/** Loading indicators wait this long before they fade in, so quick loads show nothing. */
export const MOTION_STATUS_DELAY_MS = 150

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** cubic-bezier(0.2, 0, 0, 1), the --motion-ease curve, sampled for JS tweens. */
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
