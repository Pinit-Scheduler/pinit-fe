import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent, TouchEvent, RefObject, SyntheticEvent } from 'react'
import type { ScheduleSummary } from '../types/schedule'

const EDGE_GUTTER = 72
const DRAG_ACTIVATE_DISTANCE = 6
const PULL_THRESHOLD = 60
/** A dragged card follows the pointer at this fraction of the distance, up to DRAG_FOLLOW_MAX px. */
const DRAG_FOLLOW = 0.35
const DRAG_FOLLOW_MAX = 48
const DRAG_OFFSET_PROPERTY = '--schedule-drag-x'

/** How far a dragged card leans toward the pointer. Damped and capped, so it reads as feedback. */
export const dragFollowOffset = (deltaX: number) =>
  Math.max(-DRAG_FOLLOW_MAX, Math.min(DRAG_FOLLOW_MAX, Math.round(deltaX * DRAG_FOLLOW)))

type Direction = 'prev' | 'next'

type DragState = {
  id: number
  pointerId: number
  element: HTMLDivElement
  startX: number
  startY: number
  moved: boolean
}

type UseScheduleDragOptions = {
  containerRef: RefObject<HTMLDivElement | null>
  hasItems: boolean
  resetKey?: string
  disabled?: boolean
  onMove: (schedule: ScheduleSummary, offset: 1 | -1) => void | Promise<void>
  onRefresh: () => void
}

type UseScheduleDragReturn = {
  edgeTarget: Direction | null
  draggingScheduleId: number | null
  getItemHandlers: (schedule: ScheduleSummary) => {
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => void
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => void
    onPointerUp: (event: PointerEvent<HTMLDivElement>) => void
    onPointerCancel: () => void
    onLostPointerCapture: () => void
    onDragStart: (event: SyntheticEvent) => void
    onClickCapture: (event: SyntheticEvent) => void
  }
  containerTouchHandlers: {
    onTouchStart: (event: TouchEvent<HTMLDivElement>) => void
    onTouchMove: (event: TouchEvent<HTMLDivElement>) => void
    onTouchEnd: () => void
  }
}

export const useScheduleDrag = ({ containerRef, hasItems, resetKey, disabled = false, onMove, onRefresh }: UseScheduleDragOptions): UseScheduleDragReturn => {
  const dragStateRef = useRef<DragState | null>(null)
  const suppressClickRef = useRef(false)
  const pullStartY = useRef<number | null>(null)
  const pullActivated = useRef(false)
  const [edgeTarget, setEdgeTarget] = useState<Direction | null>(null)
  const [draggingScheduleId, setDraggingScheduleId] = useState<number | null>(null)

  const resetDragState = useCallback(() => {
    const state = dragStateRef.current
    dragStateRef.current = null
    // The card eases back into place (CSS transitions transform once dragging ends).
    state?.element.style?.removeProperty(DRAG_OFFSET_PROPERTY)
    if (state?.element.hasPointerCapture(state.pointerId)) {
      state.element.releasePointerCapture(state.pointerId)
    }
    setDraggingScheduleId(null)
    setEdgeTarget(null)
  }, [])

  useEffect(() => () => {
    resetDragState()
    suppressClickRef.current = false
  }, [resetKey, disabled, resetDragState])

  const targetAt = useCallback((clientX: number): Direction | null => {
    const bounds = containerRef.current?.getBoundingClientRect()
    if (!bounds) return null
    const gutter = Math.min(EDGE_GUTTER, bounds.width / 4)
    return clientX < bounds.left + gutter ? 'prev'
      : clientX > bounds.right - gutter ? 'next' : null
  }, [containerRef])

  const handleDragStart = useCallback((event: PointerEvent<HTMLDivElement>, scheduleId: number) => {
    if (disabled || event.button !== 0 || !event.isPrimary) return
    // A title can be clicked or dragged. State/delete/time controls keep their
    // normal interactions and never become a date drag.
    const control = (event.target as Element).closest('button, a, input, select, textarea, [contenteditable="true"]')
    if (control && !control.classList.contains('schedule-card__title')) return
    dragStateRef.current = {
      id: scheduleId,
      pointerId: event.pointerId,
      element: event.currentTarget,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    }
    suppressClickRef.current = false
  }, [disabled])

  const handleDragMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const state = dragStateRef.current
    if (!state || state.pointerId !== event.pointerId) return
    if (event.pointerType === 'mouse' && !(event.buttons & 1)) {
      resetDragState()
      return
    }
    const deltaX = Math.abs(event.clientX - state.startX)
    const deltaY = Math.abs(event.clientY - state.startY)
    if (!state.moved) {
      if (deltaX + deltaY <= DRAG_ACTIVATE_DISTANCE) return
      // Vertical movement belongs to page scrolling, not date movement.
      if (deltaY >= deltaX) {
        resetDragState()
        return
      }
      state.moved = true
      state.element.setPointerCapture(event.pointerId)
      setDraggingScheduleId(state.id)
      pullActivated.current = false
      pullStartY.current = null
    }
    event.preventDefault()
    // Written to the element directly: following the pointer must not re-render the list.
    state.element.style?.setProperty(
      DRAG_OFFSET_PROPERTY,
      `${dragFollowOffset(event.clientX - state.startX)}px`,
    )
    setEdgeTarget(targetAt(event.clientX))
  }, [resetDragState, targetAt])

  const handleDragEnd = useCallback(
    (event: PointerEvent<HTMLDivElement>, schedule: ScheduleSummary) => {
      const state = dragStateRef.current
      if (!state || state.id !== schedule.id || state.pointerId !== event.pointerId) return
      // Read the release position directly; React's last move state may lag.
      const target = state.moved ? targetAt(event.clientX) : null
      if (state.moved) {
        event.preventDefault()
        suppressClickRef.current = true
      }
      resetDragState()
      if (target && !disabled) void onMove(schedule, target === 'prev' ? -1 : 1)
    },
    [disabled, targetAt, onMove, resetDragState],
  )

  const getItemHandlers = useCallback(
    (schedule: ScheduleSummary) => ({
      onPointerDown: (event: PointerEvent<HTMLDivElement>) => handleDragStart(event, schedule.id),
      onPointerMove: handleDragMove,
      onPointerUp: (event: PointerEvent<HTMLDivElement>) => handleDragEnd(event, schedule),
      onPointerCancel: resetDragState,
      onLostPointerCapture: resetDragState,
      // Prevent native text/link dragging from taking ownership of the mouse.
      onDragStart: (event: SyntheticEvent) => event.preventDefault(),
      onClickCapture: (event: SyntheticEvent) => {
        if (suppressClickRef.current) {
          event.stopPropagation()
          event.preventDefault()
          suppressClickRef.current = false
        }
      },
    }),
    [handleDragEnd, handleDragMove, handleDragStart, resetDragState],
  )

  const containerTouchHandlers = {
    onTouchStart: (e: TouchEvent<HTMLDivElement>) => {
      if (!hasItems || disabled) return
      pullStartY.current = e.touches[0].clientY
      pullActivated.current = false
    },
    onTouchMove: (e: TouchEvent<HTMLDivElement>) => {
      if (!hasItems || disabled) return
      const container = containerRef.current
      if (!container) return
      let scroller: HTMLElement | null = container
      while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) {
        scroller = scroller.parentElement
      }
      if ((scroller?.scrollTop ?? 0) > 0 || dragStateRef.current?.moved) {
        pullStartY.current = null
        pullActivated.current = false
        return
      }
      const startY = pullStartY.current ?? e.touches[0].clientY
      pullStartY.current = startY
      const deltaY = e.touches[0].clientY - startY
      if (deltaY > PULL_THRESHOLD) {
        pullActivated.current = true
      }
    },
    onTouchEnd: () => {
      if (pullActivated.current && !suppressClickRef.current && !disabled) {
        onRefresh()
      }
      pullStartY.current = null
      pullActivated.current = false
    },
  }

  return {
    edgeTarget: disabled ? null : edgeTarget,
    draggingScheduleId: disabled ? null : draggingScheduleId,
    getItemHandlers,
    containerTouchHandlers,
  }
}

export default useScheduleDrag
