import type dayjs from 'dayjs'
import { toApiDateTimeWithZone, toDateKey } from '@shared/utils/datetime'
import { fetchWeeklySchedules } from '../api/schedules'
import { monthWeekStarts, summarizeByDate, type DaySummary } from '../utils/monthGrid'
import { useRevalidatingQuery } from '@shared/hooks/useRevalidatingQuery'
import { useSpaces } from '@features/spaces/store'

type UseMonthlySchedulesReturn = {
  summaryByDate: Record<string, DaySummary>
  isLoading: boolean
  error: string | null
  refetch: () => void
}

const EMPTY: Record<string, DaySummary> = {}

/**
 * 월간 달력용 날짜별 일정 요약. 월 범위 API가 없으므로 달력에 보이는 주마다 주간 API를 한 번씩 부른다.
 * 다른 화면에서 일정이 바뀌면(schedule:changed) 다시 받는다. 다시 받는 동안에도 이 달의 숫자는 그대로 둔다.
 */
const useMonthlySchedules = (month: dayjs.Dayjs, enabled = true, mine?: boolean): UseMonthlySchedulesReturn => {
  const monthKey = month.format('YYYY-MM')
  const { selectedSpaceId, selectedProjectId } = useSpaces()
  const zoneId = toApiDateTimeWithZone(month).zoneId
  // month는 렌더마다 새 dayjs 객체지만, 요청은 키(달·범위)가 바뀔 때만 다시 간다.
  // 내 일정/팀 전체를 바꾸면 이전 범위의 결과를 보여 주지 않는다.
  const key = enabled
    ? `schedules/month/${monthKey}@${zoneId}/${String(mine)}/${selectedSpaceId ?? 'all'}/${selectedProjectId ?? 'all'}`
    : null
  const query = useRevalidatingQuery<Record<string, DaySummary>>(
    key,
    async () => {
      const weeks = await Promise.all(
        monthWeekStarts(month).map((week) => fetchWeeklySchedules(toApiDateTimeWithZone(week.hour(12)), { mine })),
      )
      return summarizeByDate(weeks.flat(), (schedule) => toDateKey(schedule.date))
    },
    { invalidateOn: ['schedule'], group: 'schedules/month/', errorMessage: '월간 일정을 불러오지 못했어요.' },
  )
  return {
    summaryByDate: query.data ?? EMPTY,
    // Only marks the grid aria-busy. The counts stay on screen while they refresh.
    isLoading: query.isInitialLoading || query.isRefreshing,
    error: query.error,
    refetch: query.refetch,
  }
}

export default useMonthlySchedules
