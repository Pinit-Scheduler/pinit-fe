import { useEffect, useMemo, useState } from 'react'
import type dayjs from 'dayjs'
import type { ScheduleSummary } from '../types/schedule'
import { toDateKey } from '../utils/datetime'

const simulateSchedules = async (dateKey: string): Promise<ScheduleSummary[]> => {
  await new Promise((resolve) => setTimeout(resolve, 160))
  return [
    {
      id: 1,
      title: 'UX 정리',
      description: '다음 주 릴리즈를 위한 UX 흐름 정리',
      date: `${dateKey}T09:00:00+09:00[Asia/Seoul]`,
      deadline: `${dateKey}T12:00:00+09:00[Asia/Seoul]`,
      importance: 7,
      urgency: 6,
      taskType: 'DEEP_WORK',
      state: 'PENDING',
    },
    {
      id: 2,
      title: '행정 업무',
      description: '비용 정산서 제출',
      date: `${dateKey}T13:30:00+09:00[Asia/Seoul]`,
      deadline: `${dateKey}T15:00:00+09:00[Asia/Seoul]`,
      importance: 4,
      urgency: 5,
      taskType: 'ADMIN_TASK',
      state: 'IN_PROGRESS',
    },
  ]
}

type UseScheduleListReturn = {
  schedules: ScheduleSummary[]
  isLoading: boolean
  refetch: () => void
}

const useScheduleList = (selectedDate: dayjs.Dayjs): UseScheduleListReturn => {
  const [schedules, setSchedules] = useState<ScheduleSummary[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [timestamp, setTimestamp] = useState(() => Date.now())

  const dateKey = useMemo(() => toDateKey(selectedDate), [selectedDate])

  useEffect(() => {
    let isMounted = true

    const fetchList = async () => {
      setIsLoading(true)
      try {
        const response = await simulateSchedules(dateKey)
        if (isMounted) {
          setSchedules(response)
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    fetchList()

    return () => {
      isMounted = false
    }
  }, [dateKey, timestamp])

  return {
    schedules,
    isLoading,
    refetch: () => setTimestamp(Date.now()),
  }
}

export default useScheduleList

