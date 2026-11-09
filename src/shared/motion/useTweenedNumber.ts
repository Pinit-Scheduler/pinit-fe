import { useEffect, useState } from 'react'
import { MOTION_ENTER_MS, motionEase, prefersReducedMotion } from './tokens'

/** Value of a tween from `from` to `to` at `elapsed` of `duration` ms, on the --motion-ease curve. */
export const tweenAt = (from: number, to: number, elapsed: number, duration: number) =>
  duration <= 0 ? to : from + (to - from) * motionEase(Math.min(1, elapsed / duration))

/**
 * A number that glides to its new value when it changes (counts, totals, minutes).
 * The first value shows as is. Under reduced motion, or with non-finite values, it jumps.
 * Round or format the result yourself, e.g. Math.round(useTweenedNumber(count)).
 */
export function useTweenedNumber(
  value: number,
  { duration = MOTION_ENTER_MS }: { duration?: number } = {},
) {
  const [shown, setShown] = useState(value)
  const jump = !Number.isFinite(value) || !Number.isFinite(shown) || prefersReducedMotion()

  useEffect(() => {
    if (jump || shown === value) return
    const from = shown
    const start = performance.now()
    let frame = requestAnimationFrame(function step(now) {
      const elapsed = now - start
      setShown(tweenAt(from, value, elapsed, duration))
      if (elapsed < duration) frame = requestAnimationFrame(step)
    })
    return () => cancelAnimationFrame(frame)
    // `shown` is read once as the starting point. Following it would restart the tween every frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, duration, jump])

  return jump ? value : shown
}

export default useTweenedNumber
