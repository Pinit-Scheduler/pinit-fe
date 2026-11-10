import { useEffect, useRef, useState } from 'react'
import { MOTION_DISTANCE_PX, playRise } from '@shared/motion'

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
 * dep가 바뀔 때(첫 렌더 제외) 요소를 짧게 다시 들인다. direction이 있으면 그쪽에서 미끄러져 온다.
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
    // 빠르게 여러 번 넘기면 앞선 재생을 끊고 새로 한 번만 재생한다.
    running.current?.cancel()
    // 방향 없이 제자리에서 바뀐 값은 절반 거리만 떠오른다.
    running.current =
      playRise(ref.current, direction ? { direction } : { distance: MOTION_DISTANCE_PX / 2 }) ?? null
    // direction은 dep와 함께 바뀐다. dep가 바뀐 순간의 방향만 쓴다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dep])
  useEffect(() => () => running.current?.cancel(), [])
  return ref
}
