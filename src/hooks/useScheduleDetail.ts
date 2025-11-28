import { useEffect, useState } from 'react'
import type { ScheduleResponse } from '../types/schedule'
import dayjs from 'dayjs'

const simulateScheduleDetail = async (id: number): Promise<ScheduleResponse> => {
  await new Promise((resolve) => setTimeout(resolve, 180))
  const now = dayjs().tz().format('YYYY-MM-DD')
  return {
    id,
    ownerId: 1,
    title: '집중 작업 루틴 맞추기',
    description: '맞물린 선행 일정과 중요도/긴급도 균형 확인',
    date: `${now}T09:00:00+09:00[Asia/Seoul]`,
    deadline: `${now}T12:00:00+09:00[Asia/Seoul]`,
    importance: 7,
    urgency: 6,
    taskType: 'DEEP_WORK',
    state: 'IN_PROGRESS',
    estimatedMinutes: 180,
    actualMinutes: 45,
    createdAt: now,
    updatedAt: now,
  }
}

type UseScheduleDetailReturn = {
  schedule: ScheduleResponse | null
  isLoading: boolean
  refetch: () => void
}

const useScheduleDetail = (scheduleId?: string): UseScheduleDetailReturn => {
  const numericId = scheduleId ? Number(scheduleId) : undefined
  const [schedule, setSchedule] = useState<ScheduleResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [timestamp, setTimestamp] = useState(() => Date.now())

  useEffect(() => {
    if (!numericId) return
    let isMounted = true

    const fetchSchedule = async () => {
      setIsLoading(true)
      try {
        const response = await simulateScheduleDetail(numericId)
        if (isMounted) {
          setSchedule(response)
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    fetchSchedule()

    return () => {
      isMounted = false
    }
  }, [numericId, timestamp])

  return {
    schedule,
    isLoading,
    refetch: () => setTimestamp(Date.now()),
  }
}

export default useScheduleDetail

