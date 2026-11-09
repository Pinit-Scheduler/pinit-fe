import dayjs from 'dayjs'
import type { OverdueSummary, ScheduleResponse } from '../types/schedule'
import { fetchWeeklySchedules } from '../api/schedules'
import { getTodayWithOffset, toApiDateTimeWithZone, toDateFromApi, toDateKey } from '@shared/utils/datetime'
import { useTimePreferences } from '@contexts/TimePreferencesContext'
import { useRevalidatingQuery } from '@shared/hooks/useRevalidatingQuery'
import { useSpaces } from '@features/spaces/store'

type Options = { mine?: boolean }

const NONE: OverdueSummary = { hasOverdue: false }

const summarize = (schedules: ScheduleResponse[], todayKey: string): OverdueSummary => {
  // 오늘 이전 날짜의 미완료 일정 필터링
  const overdueSchedules = schedules.filter((schedule: ScheduleResponse) => {
    const scheduleDate = toDateKey(schedule.date)
    const isBeforeToday = dayjs(scheduleDate).isBefore(todayKey, 'day')
    const isNotCompleted = schedule.state !== 'COMPLETED'
    return isBeforeToday && isNotCompleted
  })
  if (overdueSchedules.length === 0) return NONE
  // 가장 오래된 일정 찾기
  const earliest = overdueSchedules.reduce((earliest: ScheduleResponse, current: ScheduleResponse) => {
    return dayjs(toDateFromApi(current.date)).isBefore(toDateFromApi(earliest.date)) ? current : earliest
  }, overdueSchedules[0])
  return {
    hasOverdue: true,
    count: overdueSchedules.length,
    earliestDate: toDateKey(earliest.date),
  }
}

/**
 * 미완료된 일정 요약 정보를 반환하는 커스텀 훅
 * @returns 미완료된 일정 요약 정보, 로딩 상태, 재조회 함수
 */
const useOverdueSchedulesSummary = ({ mine }: Options = {}) => {
  const { offsetMinutes } = useTimePreferences()
  const { selectedSpaceId, selectedProjectId } = useSpaces()
  const today = getTodayWithOffset(offsetMinutes)
  const todayKey = toDateKey(today)
  // 내 일정/팀 전체를 바꾸면 이전 범위의 개수를 보여 주지 않는다.
  const key = `schedules/overdue/${todayKey}@${offsetMinutes}/${String(mine)}/${selectedSpaceId ?? 'all'}/${selectedProjectId ?? 'all'}`
  const query = useRevalidatingQuery<OverdueSummary>(
    key,
    // 현재 주의 일정을 조회 (v1 주간 API)
    async () => summarize(await fetchWeeklySchedules(toApiDateTimeWithZone(today), { mine }), todayKey),
    { invalidateOn: ['schedule'] },
  )
  return {
    // 실패하면 배너를 띄우지 않는다.
    summary: query.data ?? NONE,
    /** Nothing loaded for this audience yet. Refetches keep the last summary (`isRefreshing`). */
    isLoading: query.isInitialLoading,
    isRefreshing: query.isRefreshing,
    refetch: query.refetch,
  }
}

export default useOverdueSchedulesSummary
