import { useEffect, useRef, useState } from 'react'
import { MOTION_ENTER_MS, prefersReducedMotion } from '@shared/motion'

/**
 * 기간을 넘기는 동안 화면 틀을 붙잡아 둔다. value가 null이 되면 마지막 값을 `shown`으로 돌려주고
 * `held`를 켠다. 붙잡은 값은 틀(카드·막대 자리)에만 쓰고 숫자와 글은 숨긴다. 다른 기간의 숫자를 보이지 않는다.
 */
export function useHeldValue<T>(value: T | null): { shown: T | null; held: boolean } {
  const [last, setLast] = useState<T | null>(value)
  if (value !== null && value !== last) setLast(value)
  if (value !== null) return { shown: value, held: false }
  return { shown: last, held: last !== null }
}

/**
 * 이 화면이 자리 표시를 한 번이라도 그렸는지. 그랬다면 내용이 처음 들어올 때만 떠오르게 한다.
 * 캐시 값으로 바로 그린 경우(탭에 다시 온 경우)에는 아무것도 움직이지 않는다.
 */
export function useSawLoading(loading: boolean): boolean {
  const [saw, setSaw] = useState(loading)
  if (loading && !saw) setSaw(true)
  return saw
}

const EASE = 'cubic-bezier(0.2, 0, 0, 1)'

/**
 * dep가 바뀔 때(첫 렌더 제외) 요소를 짧게 다시 들인다. direction이 있으면 그쪽에서 8px 미끄러져 온다.
 * 키를 바꿔 다시 마운트하지 않고 Web Animations로 한 번만 재생한다. 동작 줄이기에서는 투명도만 바뀐다.
 */
export function useChangeFade<E extends HTMLElement>(dep: unknown, direction: -1 | 0 | 1 = 0) {
  const ref = useRef<E>(null)
  const previous = useRef(dep)
  const running = useRef<Animation | null>(null)
  useEffect(() => {
    if (Object.is(previous.current, dep)) return
    const was = previous.current
    previous.current = dep
    // 값이 처음 생긴 순간(null·undefined에서)은 바뀜이 아니라 첫 표시다. 그때는 .report-reveal이 맡는다.
    if (was === null || was === undefined) return
    const element = ref.current
    if (!element || typeof element.animate !== 'function') return
    const travel = prefersReducedMotion() ? 0 : direction * 8
    const from = travel
      ? { opacity: 0, transform: `translateX(${travel}px)` }
      : { opacity: 0, transform: prefersReducedMotion() ? 'none' : 'translateY(4px)' }
    // 빠르게 여러 번 넘기면 앞선 재생을 끊고 새로 한 번만 재생한다.
    running.current?.cancel()
    running.current = element.animate([from, { opacity: 1, transform: 'none' }], {
      duration: MOTION_ENTER_MS,
      easing: EASE,
    })
    // direction은 dep와 함께 바뀐다. dep가 바뀐 순간의 방향만 쓴다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dep])
  useEffect(() => () => running.current?.cancel(), [])
  return ref
}
