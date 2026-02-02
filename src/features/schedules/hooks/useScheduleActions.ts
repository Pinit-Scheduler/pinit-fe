import {
  startSchedule,
  suspendSchedule,
  completeSchedule,
  cancelSchedule,
  fetchScheduleDetail,
} from '../api/schedules.ts'
import { fetchActiveScheduleId } from '@features/auth/api/member'
import { useEffect, useMemo, useState } from 'react'
import type { ScheduleState } from '../types/schedule'
import { useScheduleCache } from '@contexts/ScheduleCacheContext'
import { useToast } from '@contexts/ToastContext'
import { dispatchScheduleChanged } from '@shared/utils/events'
import { useScheduleTaskSync } from '@shared/utils/scheduleTaskSync'

const allowedStartStates: ScheduleState[] = ['NOT_STARTED', 'SUSPENDED']
const allowedPauseStates: ScheduleState[] = ['IN_PROGRESS']
const allowedCompleteStates: ScheduleState[] = ['NOT_STARTED', 'IN_PROGRESS']
const allowedCancelStates: ScheduleState[] = ['IN_PROGRESS', 'SUSPENDED', 'COMPLETED']

type UseScheduleActionsResult = {
  currentState: ScheduleState
  isMutating: boolean
  lastMessage: string | null
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
  const [isMutating, setIsMutating] = useState(false)
  const [lastMessage, setLastMessage] = useState<string | null>(null)
  const { updateScheduleState, setActiveSchedule, setSchedule, activeScheduleId, schedulesById } =
    useScheduleCache()
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

  const canStart = useMemo(() => allowedStartStates.includes(currentState), [currentState])

  const canPause = useMemo(() => allowedPauseStates.includes(currentState), [currentState])

  const canComplete = useMemo(() => allowedCompleteStates.includes(currentState), [currentState])

  const canCancel = useMemo(() => allowedCancelStates.includes(currentState), [currentState])

  const mutate = async (handler: (id: number) => Promise<void>, nextState: ScheduleState, message: string) => {
    if (!scheduleId) {
      console.warn('⚠️ scheduleId is null, cannot mutate')
      return
    }

    setIsMutating(true)

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
        console.error('Failed to refresh schedule detail after mutation:', error)
      }
      dispatchScheduleChanged({ scheduleId, reason: 'state-mutated', payload: { state: nextState } })
    } catch (error) {
      console.error(`❌ Mutation failed for schedule ${scheduleId}:`, error)
      setLastMessage(error instanceof Error ? error.message : '작업 실패')
      addToast('일정 상태 변경에 실패했습니다.', 'error')
    } finally {
      setIsMutating(false)
    }
  }

  const start = async () => {
    if (!canStart || isMutating) return
    await mutate(startSchedule, 'IN_PROGRESS', '일정을 시작했습니다.')
    try {
      const activeId = await fetchActiveScheduleId()
      if (activeId) {
        const detail = await fetchScheduleDetail(activeId)
        setSchedule(detail)
        setActiveSchedule(activeId)
      }
    } catch (error) {
      console.error('Failed to refresh active schedule after start:', error)
    }
  }

  const pause = async () => {
    if (!canPause || isMutating) return
    await mutate(suspendSchedule, 'SUSPENDED', '일정을 일시 중지했습니다.')
    if (scheduleId === activeScheduleId) {
      setActiveSchedule(scheduleId)
    }
  }

  const complete = async () => {
    if (!canComplete || isMutating) return
    await mutate(completeSchedule, 'COMPLETED', '일정을 완료했습니다.')
    if (scheduleId === activeScheduleId) {
      setActiveSchedule(null)
    }
  }

  const cancel = async () => {
    if (!canCancel || isMutating) return
    await mutate(cancelSchedule, 'NOT_STARTED', '일정을 취소하고 미시작 상태로 되돌렸습니다.')
    if (scheduleId === activeScheduleId) {
      setActiveSchedule(null)
    }
  }

  return {
    currentState,
    isMutating,
    lastMessage,
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
