import { useEffect, useRef, useState } from 'react'
import CompletionCheck from '@shared/components/motion/CompletionCheck'

type ScheduleCompletionMarkProps = {
  /** The state to show. False while the mark plays its erase before it leaves. */
  checked: boolean
  /** The schedule was completed while the card was on screen: fill the box and draw the tick. */
  drawOnMount: boolean
  /** Move focus here when it mounts (the control that completed the schedule just went away). */
  focusOnMount?: boolean
  /** Playing its exit: ignore input. */
  leaving?: boolean
  label: string
  /** Permission only (the server does not allow reopening). Never a pending save. */
  disabled: boolean
  onUncheck: () => void
}

/**
 * The completed mark in a schedule card's state slot. It is the completion moment for schedules:
 * a schedule completed on screen mounts this unchecked for one frame, so the box fills with the
 * accent and the tick draws like a pen stroke. Unchecking it reopens the schedule.
 */
const ScheduleCompletionMark = ({
  checked,
  drawOnMount,
  focusOnMount = false,
  leaving = false,
  label,
  disabled,
  onUncheck,
}: ScheduleCompletionMarkProps) => {
  const [armed, setArmed] = useState(!drawOnMount)
  const rootRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (armed) return
    // Two frames: the unchecked box must be painted once before the checked styles apply,
    // or the browser skips straight to the end state and nothing draws.
    let second = 0
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setArmed(true))
    })
    return () => {
      cancelAnimationFrame(first)
      cancelAnimationFrame(second)
    }
  }, [armed])

  useEffect(() => {
    if (!focusOnMount) return
    rootRef.current?.querySelector('input')?.focus({ preventScroll: true })
    // Only the first mount moves focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <span
      ref={rootRef}
      className="schedule-card__check"
      // The card opens the detail on click. The mark is its own control.
      onClick={(event) => event.stopPropagation()}
      inert={leaving || undefined}
    >
      <CompletionCheck
        shape="square"
        checked={armed && checked}
        disabled={disabled}
        label={label}
        onChange={() => {
          if (!leaving) onUncheck()
        }}
      />
    </span>
  )
}

export default ScheduleCompletionMark
