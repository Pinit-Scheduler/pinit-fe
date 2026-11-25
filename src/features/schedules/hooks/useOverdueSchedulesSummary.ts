import { useMemo } from 'react'
import dayjs from 'dayjs'
import type { OverdueSummary, ScheduleResponse } from '../types/schedule'
import { fetchWeeklySchedules } from '../api/schedules'
import { getTodayWithOffset, toApiDateTimeWithZone, toDateFromApi, toDateKey } from '@shared/utils/datetime'
import { useTimePreferences } from '@contexts/TimePreferencesContext'
import { useRevalidatingQuery } from '@shared/hooks/useRevalidatingQuery'
import { useSpaces } from '@features/spaces/store'
import { ownSchedules, scheduleScopeKey } from '@features/spaces/scope'

type Options = {
  /** 고른 스페이스·프로젝트 대신 모든 스페이스를 읽는다. */
  allSpaces?: boolean
  /** 받은 일정 가운데 내 일정만 센다(`ownSchedules`). */
  own?: boolean
}

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
 * 지난 날짜의 미완료 일정 요약과 재조회 함수.
 * 받은 일정은 그대로 두고 화면에 그릴 때 센다. 내 일정만 세는 기준(회원·스페이스)이 나중에 도착해도 다시 받지 않는다.
 */
const useOverdueSchedulesSummary = ({ allSpaces = false, own = false }: Options = {}) => {
  const { offsetMinutes } = useTimePreferences()
  const { selectedSpaceId, selectedProjectId, memberId, spaces } = useSpaces()
  const today = getTodayWithOffset(offsetMinutes)
  const todayKey = toDateKey(today)
  const key = `schedules/overdue/${todayKey}@${offsetMinutes}/${scheduleScopeKey(allSpaces, selectedSpaceId, selectedProjectId)}`
  const query = useRevalidatingQuery<ScheduleResponse[]>(
    key,
    // 현재 주의 일정을 조회 (v1 주간 API)
    () => fetchWeeklySchedules(toApiDateTimeWithZone(today), { allSpaces }),
    { invalidateOn: ['schedule'] },
  )
  const summary = useMemo(() => {
    // 실패하면 배너를 띄우지 않는다.
    if (query.data === undefined) return NONE
    return summarize(own ? ownSchedules(query.data, memberId, spaces) : query.data, todayKey)
  }, [query.data, own, memberId, spaces, todayKey])
  return {
    summary,
    refetch: query.refetch,
  }
}

export default useOverdueSchedulesSummary
