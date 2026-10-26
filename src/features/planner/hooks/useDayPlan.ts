import { useEffect, useState } from 'react'
import { fetchSchedules } from '@features/schedules/api/schedules'
import type { ScheduleResponse } from '@features/schedules/types/schedule'
import { fetchDayPlan } from '../api/plans'
import type { DayPlanResponse } from '../types/plan'

type UseDayPlanParams = {
  date: string
  zoneId: string
  horizonDays: number
  /** 값이 바뀌면 다시 불러온다 */
  refreshKey: number
}

type UseDayPlanReturn = {
  plan: DayPlanResponse | null
  /** 시간창이 걸친 날짜(계획일, 자정을 넘으면 다음 날)의 기존 일정 */
  schedules: ScheduleResponse[]
  isLoading: boolean
  error: string | null
}

const fetchSchedulesOn = (date: string, zoneId: string) =>
  fetchSchedules({ dateTime: `${date}T12:00:00`, zoneId })

/** 하루 계획 제안과, 같은 시간대에 이미 있는 일정을 함께 불러온다. */
const useDayPlan = ({ date, zoneId, horizonDays, refreshKey }: UseDayPlanParams): UseDayPlanReturn => {
  const [plan, setPlan] = useState<DayPlanResponse | null>(null)
  const [schedules, setSchedules] = useState<ScheduleResponse[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setIsLoading(true)
      setError(null)
      try {
        const [nextPlan, sameDay] = await Promise.all([
          fetchDayPlan({ date, zoneId, horizonDays }),
          fetchSchedulesOn(date, zoneId),
        ])
        // 취침이 기상보다 이르면 시간창이 다음 날까지 이어지므로 그날 일정도 장애물로 보여 준다.
        const windowEndDate = nextPlan.window.end.dateTime.slice(0, 10)
        const nextDay = windowEndDate > date ? await fetchSchedulesOn(windowEndDate, zoneId) : []
        if (cancelled) return
        const byId = new Map<number, ScheduleResponse>()
        ;[...sameDay, ...nextDay].forEach((schedule) => byId.set(schedule.id, schedule))
        setPlan(nextPlan)
        // 같은 zoneId로 요청한 응답이라 로컬 시각 문자열 순서가 시간 순서다.
        setSchedules([...byId.values()].sort((a, b) => a.date.dateTime.localeCompare(b.date.dateTime)))
      } catch (err) {
        if (cancelled) return
        setPlan(null)
        setSchedules([])
        setError(err instanceof Error ? err.message : '계획을 불러오지 못했습니다.')
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [date, zoneId, horizonDays, refreshKey])

  return { plan, schedules, isLoading, error }
}

export default useDayPlan
