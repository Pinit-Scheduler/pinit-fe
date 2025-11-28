import { useEffect, useMemo, useState } from 'react'
import type { ScheduleState } from '../types/schedule'

const allowedStartStates: ScheduleState[] = ['PENDING', 'SUSPENDED']
const allowedCompleteStates: ScheduleState[] = ['IN_PROGRESS']
const allowedPauseStates: ScheduleState[] = ['IN_PROGRESS']
const allowedCancelStates: ScheduleState[] = ['PENDING', 'IN_PROGRESS']

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

const useScheduleActions = (initialState: ScheduleState): UseScheduleActionsResult => {
  const [currentState, setCurrentState] = useState<ScheduleState>(initialState)
  const [isMutating, setIsMutating] = useState(false)
  const [lastMessage, setLastMessage] = useState<string | null>(null)

  useEffect(() => {
    setCurrentState(initialState)
  }, [initialState])

  const canStart = useMemo(() => allowedStartStates.includes(currentState), [currentState])
  const canPause = useMemo(() => allowedPauseStates.includes(currentState), [currentState])
  const canComplete = useMemo(() => allowedCompleteStates.includes(currentState), [currentState])
  const canCancel = useMemo(() => allowedCancelStates.includes(currentState), [currentState])

  const simulateRequest = async (nextState: ScheduleState, message: string) => {
    setIsMutating(true)
    await new Promise((resolve) => setTimeout(resolve, 150))
    setCurrentState(nextState)
    setLastMessage(message)
    setIsMutating(false)
  }

  const start = async () => {
    if (!canStart || isMutating) return
    await simulateRequest('IN_PROGRESS', '일정을 시작했습니다.')
  }

  const pause = async () => {
    if (!canPause || isMutating) return
    await simulateRequest('SUSPENDED', '일정을 일시 중지했습니다.')
  }

  const complete = async () => {
    if (!canComplete || isMutating) return
    await simulateRequest('COMPLETED', '일정을 완료했습니다.')
  }

  const cancel = async () => {
    if (!canCancel || isMutating) return
    await simulateRequest('CANCELED', '일정을 취소했습니다.')
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

