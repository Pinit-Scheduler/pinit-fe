import type dayjs from 'dayjs'
import type { ScheduleSummary } from '../types/schedule'
import { toApiDateTimeWithZone, toDateKey } from '@shared/utils/datetime'
import { fetchSchedules } from '../api/schedules'
import { useRevalidatingQuery } from '@shared/hooks/useRevalidatingQuery'
import { useSpaces } from '@features/spaces/store'

/** Every cached day list shares this prefix, so one change marks all of them stale. */
export const SCHEDULE_DAY_GROUP = 'schedules/day/'

const EMPTY: ScheduleSummary[] = []

/**
 * One day's schedules, cached per day, zone and space scope for the page session.
 *
 * - A refetch keeps this day's rows on screen (`isRefreshing`); only a day with nothing cached
 *   reports `isLoading`.
 * - Another day's rows never render under this day's heading, not even for one render.
 * - A schedule change marks every cached day stale (a move or a recurrence edit touches several
 *   days). The day on screen refetches at once; a read that started before the change never lands.
 */
const useScheduleList = (
  selectedDate: dayjs.Dayjs,
  { enabled = true }: { enabled?: boolean } = {},
) => {
  const { dateTime, zoneId } = toApiDateTimeWithZone(selectedDate.hour(12))
  const dateKey = toDateKey(selectedDate)
  const { selectedSpaceId, selectedProjectId } = useSpaces()
  // fetchSchedules reads the selected space and project, so they belong to the key.
  const key = enabled
    ? `${SCHEDULE_DAY_GROUP}${dateKey}@${zoneId}/${selectedSpaceId ?? 'all'}/${selectedProjectId ?? 'all'}`
    : null
  const query = useRevalidatingQuery<ScheduleSummary[]>(
    key,
    () => fetchSchedules({ dateTime, zoneId }),
    { invalidateOn: ['schedule'], group: SCHEDULE_DAY_GROUP, errorMessage: '일정을 불러오지 못했어요.' },
  )
  return {
    /** This day's rows, or an empty list before they arrive. Use `data` to tell the two apart. */
    schedules: query.data ?? EMPTY,
    /** undefined until this day has loaded once. */
    data: query.data,
    /** Nothing cached for this day yet. The only time to show a loading panel. */
    isLoading: query.isInitialLoading,
    /** A refetch is running while this day's rows stay on screen. */
    isRefreshing: query.isRefreshing,
    error: query.error,
    refetch: query.refetch,
    setData: query.setData,
  }
}

export default useScheduleList
