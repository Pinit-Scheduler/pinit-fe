import { useCallback, useRef, useState } from 'react'
import type { PointerEvent, TouchEvent, RefObject, SyntheticEvent } from 'react'
import type { ScheduleSummary } from '../types/schedule'

const EDGE_GUTTER = 72
const DRAG_ACTIVATE_DISTANCE = 6
const PULL_THRESHOLD = 60

type Direction = 'prev' | 'next'

type DragState = {
  id: number
  startX: number
  startY: number
  moved: boolean
}

type UseScheduleDragOptions = {
  containerRef: RefObject<HTMLDivElement | null>
  hasItems: boolean
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
    onPointerLeave: () => void
    onClickCapture: (event: SyntheticEvent) => void
  }
  containerTouchHandlers: {
    onTouchStart: (event: TouchEvent<HTMLDivElement>) => void
    onTouchMove: (event: TouchEvent<HTMLDivElement>) => void
    onTouchEnd: () => void
  }
}

export const useScheduleDrag = ({ containerRef, hasItems, onMove, onRefresh }: UseScheduleDragOptions): UseScheduleDragReturn => {
  const dragStateRef = useRef<DragState | null>(null)
  const suppressClickRef = useRef(false)
  const pullStartY = useRef<number | null>(null)
  const pullActivated = useRef(false)
  const [edgeTarget, setEdgeTarget] = useState<Direction | null>(null)
  const [draggingScheduleId, setDraggingScheduleId] = useState<number | null>(null)

  const resetDragState = useCallback(() => {
    dragStateRef.current = null
    setDraggingScheduleId(null)
    setEdgeTarget(null)
  }, [])

  const handleDragStart = useCallback((event: PointerEvent<HTMLDivElement>, scheduleId: number) => {
    dragStateRef.current = {
      id: scheduleId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    }
    suppressClickRef.current = false
    setDraggingScheduleId(scheduleId)
    setEdgeTarget(null)
  }, [])

  const handleDragMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const state = dragStateRef.current
    if (!state) return
    const deltaX = event.clientX - state.startX
    const deltaY = event.clientY - state.startY
    if (!state.moved && Math.abs(deltaX) + Math.abs(deltaY) > DRAG_ACTIVATE_DISTANCE) {
      state.moved = true
    }
    const viewportWidth = window.innerWidth
    const nextTarget: Direction | null = event.clientX < EDGE_GUTTER
      ? 'prev'
      : event.clientX > viewportWidth - EDGE_GUTTER
        ? 'next'
        : null
    setEdgeTarget(nextTarget)
  }, [])

  const handleDragEnd = useCallback(
    (event: PointerEvent<HTMLDivElement>, schedule: ScheduleSummary) => {
      const state = dragStateRef.current
      if (!state || state.id !== schedule.id) {
        resetDragState()
        return
      }
      const target = edgeTarget
      if (state.moved) {
        event.preventDefault()
        suppressClickRef.current = true
        window.setTimeout(() => {
          suppressClickRef.current = false
        }, 300)
      }
      resetDragState()
      if (target) {
        void onMove(schedule, target === 'prev' ? -1 : 1)
      }
    },
    [edgeTarget, onMove, resetDragState],
  )

  const getItemHandlers = useCallback(
    (schedule: ScheduleSummary) => ({
      onPointerDown: (event: PointerEvent<HTMLDivElement>) => handleDragStart(event, schedule.id),
      onPointerMove: handleDragMove,
      onPointerUp: (event: PointerEvent<HTMLDivElement>) => handleDragEnd(event, schedule),
      onPointerCancel: resetDragState,
      onPointerLeave: resetDragState,
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
      if (!hasItems) return
      pullStartY.current = e.touches[0].clientY
      pullActivated.current = false
    },
    onTouchMove: (e: TouchEvent<HTMLDivElement>) => {
      if (!hasItems) return
      const container = containerRef.current
      if (!container) return
      if (container.scrollTop > 0) {
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
      if (pullActivated.current) {
        onRefresh()
      }
      pullStartY.current = null
      pullActivated.current = false
    },
  }

  return {
    edgeTarget,
    draggingScheduleId,
    getItemHandlers,
    containerTouchHandlers,
  }
}

export default useScheduleDrag
