import { useMemo } from 'react'
import type dayjs from 'dayjs'
import type { ScheduleResponse } from '../types/schedule'
import { toApiDateTimeWithZone, toDateKey } from '@shared/utils/datetime'
import { fetchWeeklySchedules } from '../api/schedules'
import { monthWeekStarts, summarizeByDate, type DaySummary } from '../utils/monthGrid'
import { useRevalidatingQuery } from '@shared/hooks/useRevalidatingQuery'
import { useSpaces } from '@features/spaces/store'
import { ownSchedules, scheduleScopeKey } from '@features/spaces/scope'

type UseMonthlySchedulesReturn = {
  summaryByDate: Record<string, DaySummary>
  isLoading: boolean
  error: string | null
  refetch: () => void
}

type Options = {
  /** 고른 스페이스·프로젝트 대신 모든 스페이스를 읽는다. */
  allSpaces?: boolean
  /** 받은 일정 가운데 내 일정만 센다(`ownSchedules`). */
  own?: boolean
}

const EMPTY: Record<string, DaySummary> = {}

/**
 * 월간 달력용 날짜별 일정 요약. 월 범위 API가 없으므로 달력에 보이는 주마다 주간 API를 한 번씩 부른다.
 * 다른 화면에서 일정이 바뀌면(schedule:changed) 다시 받는다. 다시 받는 동안에도 이 달의 숫자는 그대로 둔다.
 * 받은 일정은 그대로 두고 화면에 그릴 때 센다. 내 일정만 세는 기준(회원·스페이스)이 나중에 도착하면 받아 둔 응답을
 * 다시 거른다(거르려고 다시 받을 필요는 없다. `schedule:changed`가 오면 다른 변경처럼 백그라운드로 다시 받는다).
 */
const useMonthlySchedules = (
  month: dayjs.Dayjs,
  enabled = true,
  { allSpaces = false, own = false }: Options = {},
): UseMonthlySchedulesReturn => {
  const monthKey = month.format('YYYY-MM')
  const { selectedSpaceId, selectedProjectId, memberId, spaces } = useSpaces()
  const zoneId = toApiDateTimeWithZone(month).zoneId
  // month는 렌더마다 새 dayjs 객체지만, 요청은 키(달·범위)가 바뀔 때만 다시 간다.
  const key = enabled
    ? `schedules/month/${monthKey}@${zoneId}/${scheduleScopeKey(allSpaces, selectedSpaceId, selectedProjectId)}`
    : null
  const query = useRevalidatingQuery<ScheduleResponse[]>(
    key,
    async () => {
      const weeks = await Promise.all(
        monthWeekStarts(month).map((week) => fetchWeeklySchedules(toApiDateTimeWithZone(week.hour(12)), { allSpaces })),
      )
      return weeks.flat()
    },
    { invalidateOn: ['schedule'], group: 'schedules/month/', errorMessage: '월간 일정을 불러오지 못했어요.' },
  )
  const summaryByDate = useMemo(() => {
    if (query.data === undefined) return EMPTY
    const counted = own ? ownSchedules(query.data, memberId, spaces) : query.data
    return summarizeByDate(counted, (schedule) => toDateKey(schedule.date))
  }, [query.data, own, memberId, spaces])
  return {
    summaryByDate,
    // Only marks the grid aria-busy. The counts stay on screen while they refresh.
    isLoading: query.isInitialLoading || query.isRefreshing,
    error: query.error,
    refetch: query.refetch,
  }
}

export default useMonthlySchedules
