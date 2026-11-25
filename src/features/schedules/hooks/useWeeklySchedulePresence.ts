import { useMemo } from 'react'
import type dayjs from 'dayjs'
import { getWeekDays, toApiDateTimeWithZone, toDateKey } from '@shared/utils/datetime'
import type { DateSchedulePresence } from '../types/schedule'
import type { ScheduleResponse } from '../types/schedule'
import { fetchWeeklySchedules } from '../api/schedules'
import { useRevalidatingQuery } from '@shared/hooks/useRevalidatingQuery'
import { useSpaces } from '@features/spaces/store'
import { ownSchedules, scheduleScopeKey } from '@features/spaces/scope'

type Options = {
  weekStart: dayjs.Dayjs
  /** 고른 스페이스·프로젝트 대신 모든 스페이스를 읽는다. */
  allSpaces?: boolean
  /** 받은 일정 가운데 내 일정만 센다(`ownSchedules`). */
  own?: boolean
}

type UseWeeklySchedulePresenceReturn = {
  presenceMap: DateSchedulePresence
  error: string | null
  refetch: () => void
}

const useWeeklySchedulePresence = ({ weekStart, allSpaces = false, own = false }: Options): UseWeeklySchedulePresenceReturn => {
  const dateKeys = useMemo(() => getWeekDays(weekStart).map(toDateKey), [weekStart])
  const time = toApiDateTimeWithZone(weekStart.hour(12))
  const { selectedSpaceId, selectedProjectId, memberId, spaces } = useSpaces()
  // Keyed on the week, not the selected day: picking another day in the same week reads nothing.
  // 내 일정만 세는 것은 받은 뒤에 거르므로 key에 들어가지 않는다.
  const key = `schedules/week/${dateKeys[0]}@${time.zoneId}/${scheduleScopeKey(allSpaces, selectedSpaceId, selectedProjectId)}`
  const query = useRevalidatingQuery<ScheduleResponse[]>(
    key,
    () => fetchWeeklySchedules(time, { allSpaces }),
    { invalidateOn: ['schedule'], group: 'schedules/week/', errorMessage: '주간 일정을 불러오지 못했어요.' },
  )

  const presenceMap = useMemo(() => {
    const map: DateSchedulePresence = {}
    if (query.data === undefined && query.error === null) return map
    // 날짜별 일정 그룹화. 실패했으면 모든 날짜를 false로 둔다.
    const rows = query.data ?? []
    const counted = own ? ownSchedules(rows, memberId, spaces) : rows
    const byDate = counted.reduce<Record<string, ScheduleResponse[]>>((acc, schedule) => {
      const dateKey = toDateKey(schedule.date)
      ;(acc[dateKey] ??= []).push(schedule)
      return acc
    }, {})
    dateKeys.forEach((dateKey) => {
      const forDate = byDate[dateKey] || []
      map[dateKey] = {
        hasSchedule: forDate.length > 0,
        hasOverdue: forDate.some((item) => item.state !== 'COMPLETED'),
      }
    })
    return map
  }, [dateKeys, query.data, query.error, own, memberId, spaces])

  return {
    presenceMap,
    error: query.error,
    refetch: query.refetch,
  }
}

export default useWeeklySchedulePresence
