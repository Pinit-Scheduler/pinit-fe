import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import useAnchorRect from '../hooks/useAnchorRect'
import { calloutPlacement, spotlightRect } from '../utils/spotlight'
import type { Viewport } from '../utils/spotlight'
import type { TourStep } from '../utils/tour'
import './SpotlightTour.css'

type SpotlightTourProps = {
  step: TourStep
  index: number
  total: number
  onPrev(): void
  onNext(): void
  onSkip(): void
}

const readViewport = (): Viewport => ({ width: window.innerWidth, height: window.innerHeight })

const useViewport = () => {
  const [viewport, setViewport] = useState(readViewport)
  useEffect(() => {
    const handleResize = () => setViewport(readViewport())
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])
  return viewport
}

/**
 * 회색 반투명 덮개 위에 앵커 요소 하나만 뚫어 강조하고, 기능의 쓰임새와 이점을 말풍선으로 보여 준다.
 * 덮개 레이어가 클릭을 모두 받으므로 투어 중에는 아래 화면을 누를 수 없다.
 */
const SpotlightTour = ({ step, index, total, onPrev, onNext, onSkip }: SpotlightTourProps) => {
  const { rect, resolved } = useAnchorRect(step.anchor, true)
  const viewport = useViewport()
  const [calloutHeight, setCalloutHeight] = useState(0)
  const calloutRef = useRef<HTMLDivElement>(null)
  const nextButtonRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const bodyId = useId()
  const isFirst = index === 0
  const isLast = index === total - 1

  useEffect(() => {
    const node = calloutRef.current
    if (!node) return
    // 관찰을 시작할 때 한 번, 이후 문구가 바뀌어 높이가 달라질 때마다 알려 준다.
    const observer = new ResizeObserver(() => setCalloutHeight(node.offsetHeight))
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  // 말풍선이 보이게 된 뒤에야 focus를 받을 수 있으므로 단계가 바뀌고 앵커가 정해졌을 때 옮긴다.
  useEffect(() => {
    if (resolved) nextButtonRef.current?.focus({ preventScroll: true })
  }, [index, step.key, resolved])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onSkip()
        return
      }
      if (event.key !== 'Tab') return
      // 아래 화면으로 focus가 빠져나가 키보드로 조작되지 않도록 말풍선 버튼 안에서만 돈다.
      const buttons = Array.from(calloutRef.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? [])
      if (buttons.length === 0) return
      const position = buttons.indexOf(document.activeElement as HTMLButtonElement)
      const nextPosition = event.shiftKey
        ? position <= 0
          ? buttons.length - 1
          : position - 1
        : position === -1 || position === buttons.length - 1
          ? 0
          : position + 1
      event.preventDefault()
      buttons[nextPosition].focus()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onSkip])

  const padded = rect ? spotlightRect(rect, viewport) : null
  const spot = padded && padded.width > 0 && padded.height > 0 ? padded : null
  const { placement, top } = calloutPlacement(spot, viewport, calloutHeight)

  return createPortal(
    <div className="spotlight-tour" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={bodyId}>
      {spot ? (
        <div
          className="spotlight-tour__hole"
          style={{ top: spot.top, left: spot.left, width: spot.width, height: spot.height }}
          aria-hidden
        />
      ) : (
        <div className="spotlight-tour__backdrop" aria-hidden />
      )}
      <div
        ref={calloutRef}
        className={['spotlight-tour__callout', `spotlight-tour__callout--${placement}`, resolved && 'is-ready']
          .filter(Boolean)
          .join(' ')}
        style={{ top }}
      >
        <div className="spotlight-tour__meta">
          <span className="spotlight-tour__progress">
            {index + 1} / {total}
          </span>
          {step.isNew && <span className="spotlight-tour__new">NEW</span>}
        </div>
        <h2 id={titleId} className="spotlight-tour__title">
          {step.title}
        </h2>
        <dl id={bodyId} className="spotlight-tour__body">
          <div className="spotlight-tour__item">
            <dt>이 기능은</dt>
            <dd>{step.purpose}</dd>
          </div>
          <div className="spotlight-tour__item">
            <dt>쓰면 좋은 점</dt>
            <dd>{step.benefit}</dd>
          </div>
        </dl>
        <div className="spotlight-tour__actions">
          <button type="button" className="spotlight-tour__skip" onClick={onSkip}>
            건너뛰기
          </button>
          <div className="spotlight-tour__nav">
            <button type="button" className="spotlight-tour__prev" onClick={onPrev} disabled={isFirst}>
              이전
            </button>
            <button type="button" ref={nextButtonRef} className="spotlight-tour__next" onClick={onNext}>
              {isLast ? '완료' : '다음'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

export default SpotlightTour
