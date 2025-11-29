import { startSchedule, suspendSchedule, completeSchedule, cancelSchedule } from '../api/schedules'
import { useScheduleCache } from '../context/ScheduleCacheContext'
import { useEffect, useMemo, useState } from 'react'
import type { ScheduleState } from '../types/schedule'

// 실제 백엔드 상태에 맞게 수정
// NOT_STARTED: 시작만 가능
const allowedStartStates: ScheduleState[] = ['NOT_STARTED', 'SUSPENDED']
// IN_PROGRESS: 일시정지, 취소, 완료 가능
const allowedPauseStates: ScheduleState[] = ['IN_PROGRESS']
const allowedCompleteStates: ScheduleState[] = ['IN_PROGRESS']
// 취소는 COMPLETED를 제외한 모든 상태에서 가능
const allowedCancelStates: ScheduleState[] = ['NOT_STARTED', 'IN_PROGRESS', 'SUSPENDED', 'COMPLETED']

console.log('📌 Allowed states configuration:', {
  allowedStartStates,
  allowedPauseStates,
  allowedCompleteStates,
  allowedCancelStates
})

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

const useScheduleActions = (scheduleId: number | null, initialState: ScheduleState): UseScheduleActionsResult => {
  const [currentState, setCurrentState] = useState<ScheduleState>(initialState)
  const [isMutating, setIsMutating] = useState(false)
  const [lastMessage, setLastMessage] = useState<string | null>(null)
  const { updateScheduleState } = useScheduleCache()

  useEffect(() => {
    setCurrentState(initialState)
    console.log(`🔄 State changed for schedule ${scheduleId}:`, { from: currentState, to: initialState })
  }, [initialState, scheduleId, currentState])

  const canStart = useMemo(() => {
    const result = allowedStartStates.includes(currentState)
    console.log(`🔍 canStart check:`, { scheduleId, currentState, allowedStartStates, result })
    return result
  }, [currentState, scheduleId])

  const canPause = useMemo(() => {
    const result = allowedPauseStates.includes(currentState)
    console.log(`🔍 canPause check:`, { scheduleId, currentState, allowedPauseStates, result })
    return result
  }, [currentState, scheduleId])

  const canComplete = useMemo(() => {
    const result = allowedCompleteStates.includes(currentState)
    console.log(`🔍 canComplete check:`, { scheduleId, currentState, allowedCompleteStates, result })
    return result
  }, [currentState, scheduleId])

  const canCancel = useMemo(() => {
    const result = allowedCancelStates.includes(currentState)
    console.log(`🔍 canCancel check:`, { scheduleId, currentState, allowedCancelStates, result })
    return result
  }, [currentState, scheduleId])

  const mutate = async (handler: (id: number) => Promise<void>, nextState: ScheduleState, message: string) => {
    if (!scheduleId) {
      console.warn('⚠️ scheduleId is null, cannot mutate')
      return
    }

    console.log(`🔄 Mutating schedule ${scheduleId}: ${currentState} → ${nextState}`)
    setIsMutating(true)

    try {
      await handler(scheduleId)
      console.log(`✅ Mutation success: ${scheduleId} is now ${nextState}`)
      setCurrentState(nextState)
      updateScheduleState(scheduleId, nextState)
      setLastMessage(message)
    } catch (error) {
      console.error(`❌ Mutation failed for schedule ${scheduleId}:`, error)
      setLastMessage(error instanceof Error ? error.message : '작업 실패')
    } finally {
      setIsMutating(false)
    }
  }

  const start = async () => {
    if (!canStart || isMutating) return
    await mutate(startSchedule, 'IN_PROGRESS', '일정을 시작했습니다.')
  }

  const pause = async () => {
    if (!canPause || isMutating) return
    await mutate(suspendSchedule, 'SUSPENDED', '일정을 일시 중지했습니다.')
  }

  const complete = async () => {
    if (!canComplete || isMutating) return
    await mutate(completeSchedule, 'COMPLETED', '일정을 완료했습니다.')
  }

  const cancel = async () => {
    if (!canCancel || isMutating) return
    await mutate(cancelSchedule, 'NOT_STARTED', '일정을 취소하고 미시작 상태로 되돌렸습니다.')
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
