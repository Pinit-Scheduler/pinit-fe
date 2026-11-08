import { getMetadata } from '@features/spaces/metadata'
import {
  startSchedule,
  suspendSchedule,
  completeSchedule,
  cancelSchedule,
  fetchScheduleDetail,
} from '../api/schedules.ts'
import { fetchActiveScheduleId } from '@features/auth/api/member'
import { useEffect, useRef, useState } from 'react'
import type { ScheduleState, ScheduleResponse } from '../types/schedule'
import { useScheduleCache } from '@contexts/ScheduleCacheContext'
import { useToast } from '@contexts/ToastContext'
import { dispatchScheduleChanged } from '@shared/utils/events'
import { useScheduleTaskSync } from '@shared/utils/scheduleTaskSync'

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

  const schedule =
    scheduleId == null
      ? undefined
      : (schedulesById[scheduleId] ?? getMetadata('schedule', scheduleId))
  const canStart = schedule?.allowedActions?.start === true
  const canPause = schedule?.allowedActions?.suspend === true
  const canComplete = schedule?.allowedActions?.complete === true
  const canCancel = schedule?.allowedActions?.cancel === true

  const mutate = async (
    handler: (id: number) => Promise<ScheduleResponse>,
    message: string,
  ) => {
    if (!scheduleId) {
      console.warn('⚠️ scheduleId is null, cannot mutate')
      return false
    }
    if (!beginMutation(scheduleId)) return false
    setLastError(null)

    try {
      const saved = await handler(scheduleId)
      setCurrentState(saved.state)
      setSchedule(saved)
      setLastMessage(message)
      try {
        const detail = await fetchScheduleDetail(scheduleId)
        setSchedule(detail)
        if (options.syncTask !== false && detail.taskId != null) {
          await syncTaskStateWithSchedule(detail.taskId, detail.state)
        }
      } catch (error) {
        console.error(
          'Failed to refresh schedule detail after mutation:',
          error,
        )
        setLastError(
          '상태는 저장되었지만 최신 정보를 불러오지 못했어요. 다시 확인해 주세요.',
        )
        retryRef.current = async () => {
          const detail = await fetchScheduleDetail(scheduleId)
          setSchedule(detail)
          if (options.syncTask !== false && detail.taskId != null)
            await syncTaskStateWithSchedule(detail.taskId, detail.state)
          setLastError(null)
          dispatchScheduleChanged({ scheduleId, reason: 'state-verified' })
        }
      }
      dispatchScheduleChanged({
        scheduleId,
        reason: 'state-mutated',
        payload: { state: saved.state },
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
      (id) => startSchedule(id, undefined, schedule?.version),
      '일정을 시작했습니다.',
    )
    if (!succeeded) return
    await refreshActiveSchedule()
  }

  const pause = async () => {
    if (!canPause || isMutating) return
    retryRef.current = pause
    const succeeded = await mutate(
      (id) => suspendSchedule(id, undefined, schedule?.version),
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
      (id) => completeSchedule(id, undefined, schedule?.version),
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
      (id) => cancelSchedule(id, schedule?.version),
      '일정을 취소하고 미시작 상태로 되돌렸습니다.',
    )
    if (!succeeded) return
    if (scheduleId === activeScheduleId) {
      setActiveSchedule(null)
    }
  }

  return {
    currentState: cachedState ?? currentState,
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
