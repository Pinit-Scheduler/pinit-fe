import {
  startSchedule,
  suspendSchedule,
  completeSchedule,
  cancelSchedule,
  fetchScheduleDetail,
} from '../api/schedules.ts'
import { fetchActiveScheduleId } from '@features/auth/api/member'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ScheduleState } from '../types/schedule'
import { useScheduleCache } from '@contexts/ScheduleCacheContext'
import { useToast } from '@contexts/ToastContext'
import { dispatchScheduleChanged } from '@shared/utils/events'
import { useScheduleTaskSync } from '@shared/utils/scheduleTaskSync'

const allowedStartStates: ScheduleState[] = ['NOT_STARTED', 'SUSPENDED']
const allowedPauseStates: ScheduleState[] = ['IN_PROGRESS']
const allowedCompleteStates: ScheduleState[] = ['NOT_STARTED', 'IN_PROGRESS']
const allowedCancelStates: ScheduleState[] = [
  'IN_PROGRESS',
  'SUSPENDED',
  'COMPLETED',
]

type UseScheduleActionsResult = {
  currentState: ScheduleState
  isMutating: boolean
  lastMessage: string | null
  lastError: string | null
  retry: () => Promise<void>
  canStart: boolean
  canPause: boolean
  canComplete: boolean
  canCancel: boolean
  start: () => Promise<void>
  pause: () => Promise<void>
  complete: () => Promise<void>
  cancel: () => Promise<void>
}

/**
 * 일정 상태 변경 훅
 * @param scheduleId - 일정 ID
 * @param initialState - 초기 상태
 */
const useScheduleActions = (
  scheduleId: number | null,
  initialState: ScheduleState,
  options: { syncTask?: boolean } = {},
): UseScheduleActionsResult => {
  const [currentState, setCurrentState] = useState<ScheduleState>(initialState)
  const [lastMessage, setLastMessage] = useState<string | null>(null)
  const [lastError, setLastError] = useState<string | null>(null)
  const retryRef = useRef<(() => Promise<void>) | null>(null)
  const {
    updateScheduleState,
    setActiveSchedule,
    setSchedule,
    activeScheduleId,
    schedulesById,
    pendingScheduleId,
    beginMutation,
    endMutation,
  } = useScheduleCache()
  const isMutating = pendingScheduleId !== null
  const { syncTaskStateWithSchedule } = useScheduleTaskSync()
  const { addToast } = useToast()
  const cachedState = scheduleId ? schedulesById[scheduleId]?.state : undefined

  useEffect(() => {
    setCurrentState(initialState)
  }, [initialState, scheduleId])

  useEffect(() => {
    if (cachedState && cachedState !== currentState) {
      setCurrentState(cachedState)
    }
  }, [cachedState, currentState])

  const canStart = useMemo(
    () => allowedStartStates.includes(currentState),
    [currentState],
  )

  const canPause = useMemo(
    () => allowedPauseStates.includes(currentState),
    [currentState],
  )

  const canComplete = useMemo(
    () => allowedCompleteStates.includes(currentState),
    [currentState],
  )

  const canCancel = useMemo(
    () => allowedCancelStates.includes(currentState),
    [currentState],
  )

  const mutate = async (
    handler: (id: number) => Promise<void>,
    nextState: ScheduleState,
    message: string,
  ) => {
    if (!scheduleId) {
      console.warn('⚠️ scheduleId is null, cannot mutate')
      return false
    }
    if (!beginMutation(scheduleId)) return false
    setLastError(null)

    try {
      await handler(scheduleId)
      setCurrentState(nextState)
      updateScheduleState(scheduleId, nextState)
      setLastMessage(message)
      try {
        const detail = await fetchScheduleDetail(scheduleId)
        setSchedule(detail)
        if (options.syncTask !== false && detail.taskId != null) {
          await syncTaskStateWithSchedule(detail.taskId, nextState)
        }
      } catch (error) {
        console.error(
          'Failed to refresh schedule detail after mutation:',
          error,
        )
      }
      dispatchScheduleChanged({
        scheduleId,
        reason: 'state-mutated',
        payload: { state: nextState },
      })
      return true
    } catch (error) {
      console.error(`❌ Mutation failed for schedule ${scheduleId}:`, error)
      const message =
        error instanceof Error ? error.message : '일정 상태를 바꾸지 못했어요.'
      setLastMessage(message)
      setLastError(message)
      addToast('일정 상태 변경에 실패했습니다.', 'error')
      return false
    } finally {
      endMutation(scheduleId)
    }
  }

  const refreshActiveSchedule = async () => {
    try {
      const activeId = await fetchActiveScheduleId()
      if (activeId) {
        const detail = await fetchScheduleDetail(activeId)
        setSchedule(detail)
        setActiveSchedule(activeId)
      } else {
        setActiveSchedule(null)
      }
      setLastError(null)
    } catch (error) {
      console.error('Failed to refresh active schedule after start:', error)
      setLastError(
        '일정은 시작되었지만 현재 상태를 확인하지 못했어요. 다시 확인해 주세요.',
      )
      // Retrying verification must not post another start for an already running schedule.
      retryRef.current = refreshActiveSchedule
    }
  }

  const start = async () => {
    if (!canStart || isMutating) return
    retryRef.current = start
    const succeeded = await mutate(
      startSchedule,
      'IN_PROGRESS',
      '일정을 시작했습니다.',
    )
    if (!succeeded) return
    await refreshActiveSchedule()
  }

  const pause = async () => {
    if (!canPause || isMutating) return
    retryRef.current = pause
    const succeeded = await mutate(
      suspendSchedule,
      'SUSPENDED',
      '일정을 일시 중지했습니다.',
    )
    if (!succeeded) return
    if (scheduleId === activeScheduleId) {
      setActiveSchedule(scheduleId)
    }
  }

  const complete = async () => {
    if (!canComplete || isMutating) return
    retryRef.current = complete
    const succeeded = await mutate(
      completeSchedule,
      'COMPLETED',
      '일정을 완료했습니다.',
    )
    if (!succeeded) return
    if (scheduleId === activeScheduleId) {
      setActiveSchedule(null)
    }
  }

  const cancel = async () => {
    if (!canCancel || isMutating) return
    retryRef.current = cancel
    const succeeded = await mutate(
      cancelSchedule,
      'NOT_STARTED',
      '일정을 취소하고 미시작 상태로 되돌렸습니다.',
    )
    if (!succeeded) return
    if (scheduleId === activeScheduleId) {
      setActiveSchedule(null)
    }
  }

  return {
    currentState,
    isMutating,
    lastMessage,
    lastError,
    retry: async () => {
      await retryRef.current?.()
    },
    canStart,
    canPause,
    canComplete,
    canCancel,
    start,
    pause,
    complete,
    cancel,
  }
}

export default useScheduleActions
