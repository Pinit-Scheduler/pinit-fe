import { useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'
import type dayjs from 'dayjs'
import { TIME_STEP_MINUTES, appliedShiftMinutes, formatShift, stepsFromDelta } from '../utils/timeShift'
import './ScheduleTimeHandle.css'

type ScheduleTimeHandleProps = {
  start: dayjs.Dayjs
  title: string
  disabled?: boolean
  /** 실제로 옮길 분(같은 날 안으로 이미 잘린 값). 0이면 부르지 않는다. */
  onCommit: (minutes: number) => void
}

/**
 * 일정 시작 시각 손잡이. 위아래로 끌면 30분 단위로 시작 시각을 옮긴다.
 * 키보드는 ↑/↓로 고르고 Enter로 적용, Esc로 취소한다.
 * 좌우 끌기(전날·다음날 이동)와 겹치지 않게 포인터 이벤트를 위로 올리지 않는다.
 */
const ScheduleTimeHandle = ({ start, title, disabled = false, onCommit }: ScheduleTimeHandleProps) => {
  const [pending, setPending] = useState<number | null>(null)
  const dragRef = useRef<{ pointerId: number; startY: number } | null>(null)

  const applied = pending === null ? 0 : appliedShiftMinutes(start, pending)
  const preview = start.add(applied, 'minute')

  const finish = (commit: boolean) => {
    dragRef.current = null
    setPending(null)
    if (commit && applied !== 0) onCommit(applied)
  }

  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    if (disabled || event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { pointerId: event.pointerId, startY: event.clientY }
    setPending(0)
  }

  const handlePointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    setPending(stepsFromDelta(event.clientY - drag.startY) * TIME_STEP_MINUTES)
  }

  const handlePointerUp = (event: PointerEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    if (!dragRef.current) return
    finish(true)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      const delta = event.key === 'ArrowUp' ? -TIME_STEP_MINUTES : TIME_STEP_MINUTES
      setPending((current) => appliedShiftMinutes(start, (current ?? 0) + delta))
    } else if (event.key === 'Enter' && pending !== null) {
      event.preventDefault()
      finish(true)
    } else if (event.key === 'Escape' && pending !== null) {
      event.preventDefault()
      event.stopPropagation()
      finish(false)
    }
  }

  const isActive = pending !== null

  return (
    <div className={['schedule-time-handle', isActive && 'is-active'].filter(Boolean).join(' ')}>
      <button
        type="button"
        className="schedule-time-handle__grip"
        disabled={disabled}
        aria-label={`${title} 시작 ${start.format('HH:mm')}. 위아래로 끌거나 화살표 키로 시간을 옮겨요`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => finish(false)}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          if (!dragRef.current && pending !== null) finish(false)
        }}
        onClick={(event) => event.stopPropagation()}
        // 목록의 당겨서 새로고침은 터치 이벤트로 동작한다. 손잡이를 끄는 손가락이 거기 잡히지 않게 막는다.
        onTouchStart={(event) => event.stopPropagation()}
        onTouchMove={(event) => event.stopPropagation()}
        onTouchEnd={(event) => event.stopPropagation()}
      >
        <span aria-hidden>🕒</span>
        <span className="schedule-time-handle__time">{preview.format('HH:mm')}</span>
        <span className="schedule-time-handle__icon" aria-hidden>
          ⇅
        </span>
      </button>
      <span className="schedule-time-handle__hint" aria-live="polite">
        {isActive ? `${formatShift(applied)} → ${preview.format('HH:mm')}` : ''}
      </span>
    </div>
  )
}

export default ScheduleTimeHandle
