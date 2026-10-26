import { useEffect, useState } from 'react'
import { anchorSelector } from '../utils/tour'

/** 앵커를 기다리는 최대 시간. 지나면 강조 없이 가운데 말풍선으로 바꾼다(ADR-0017 §7). */
const ANCHOR_WAIT_MS = 2000

type AnchorState = { anchor: string; rect: DOMRect | null; resolved: boolean }

const sameRect = (a: DOMRect | null, b: DOMRect | null) => {
  if (a === null || b === null) return a === b
  return (
    Math.abs(a.top - b.top) < 0.5 &&
    Math.abs(a.left - b.left) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.height - b.height) < 0.5
  )
}

/**
 * `[data-onboarding-anchor="<anchor>"]` 요소의 화면 좌표를 따라간다.
 * - 화면이 바뀐 직후라 요소가 아직 없을 수 있어 매 프레임 찾는다. 찾으면 한 번 화면 가운데로 스크롤한다.
 * - ANCHOR_WAIT_MS가 지나도 없으면 resolved = true, rect = null이다. 그 뒤에 나타나면 그때부터 강조한다.
 * - 크기 변경과 스크롤(페이지는 `.app-shell__content` 안에서 스크롤되므로 capture 단계)에서 다시 잰다.
 *   비동기 로딩이나 애니메이션으로 요소가 밀리는 경우는 이벤트가 없으므로 매 프레임 확인한다.
 */
const useAnchorRect = (anchor: string, active: boolean): { rect: DOMRect | null; resolved: boolean } => {
  const [state, setState] = useState<AnchorState | null>(null)

  useEffect(() => {
    if (!active) return
    const selector = anchorSelector(anchor)
    const startedAt = performance.now()
    let element: Element | null = null
    let scrolled = false
    let published = false
    let lastRect: DOMRect | null = null
    let frame = 0

    const publish = (rect: DOMRect | null) => {
      if (published && sameRect(rect, lastRect)) return
      published = true
      lastRect = rect
      setState({ anchor, rect, resolved: true })
    }

    const measure = () => {
      if (element?.isConnected) publish(element.getBoundingClientRect())
    }

    const tick = () => {
      if (!element?.isConnected) element = selector ? document.querySelector(selector) : null
      if (element) {
        if (!scrolled) {
          scrolled = true
          element.scrollIntoView({ block: 'center' })
        }
        measure()
      } else if (!published && (selector === null || performance.now() - startedAt >= ANCHOR_WAIT_MS)) {
        publish(null)
      }
      frame = requestAnimationFrame(tick)
    }

    frame = requestAnimationFrame(tick)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [anchor, active])

  if (!active || state === null || state.anchor !== anchor) return { rect: null, resolved: false }
  return { rect: state.rect, resolved: state.resolved }
}

export default useAnchorRect
