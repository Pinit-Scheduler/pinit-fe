import { useEffect, useState, useCallback, useRef } from 'react'
import type dayjs from 'dayjs'
import type { ScheduleSummary } from '../types/schedule'
import { toApiDateTimeWithZone, toDateKey } from '@shared/utils/datetime'
import { fetchSchedules } from '../api/schedules'
import { onScheduleChanged } from '@shared/utils/events'

type ListSnapshot = {
  key: string
  schedules: ScheduleSummary[]
  isLoading: boolean
  error: string | null
}

const useScheduleList = (selectedDate: dayjs.Dayjs) => {
  const { dateTime, zoneId } = toApiDateTimeWithZone(selectedDate.hour(12))
  const dateKey = toDateKey(selectedDate)
  const queryKey = `${dateKey}@${zoneId}`
  const cacheRef = useRef<Record<string, ScheduleSummary[]>>({})
  const sequence = useRef(0)
  const [version, setVersion] = useState(0)
  const [snapshot, setSnapshot] = useState<ListSnapshot>({
    key: '', schedules: [], isLoading: true, error: null,
  })

  const refetch = useCallback(() => {
    // A mutation can affect both dates (or a whole recurrence). Invalidate all
    // day snapshots, including days currently off screen. In-flight reads from
    // before the mutation must not be allowed to repopulate them.
    cacheRef.current = {}
    sequence.current += 1
    setSnapshot({ key: queryKey, schedules: [], isLoading: true, error: null })
    setVersion((value) => value + 1)
  }, [queryKey])

  useEffect(() => onScheduleChanged(refetch), [refetch])

  useEffect(() => {
    let cancelled = false
    const request = ++sequence.current
    const cached = cacheRef.current[queryKey]
    setSnapshot({ key: queryKey, schedules: cached ?? [], isLoading: !cached, error: null })

    void fetchSchedules({ dateTime, zoneId }).then(
      (schedules) => {
        if (cancelled || request !== sequence.current) return
        cacheRef.current[queryKey] = schedules
        setSnapshot({ key: queryKey, schedules, isLoading: false, error: null })
      },
      (error: unknown) => {
        if (cancelled || request !== sequence.current) return
        setSnapshot({
          key: queryKey,
          schedules: cached ?? [],
          isLoading: false,
          error: error instanceof Error ? error.message : '일정을 불러오지 못했습니다.',
        })
      },
    )
    return () => { cancelled = true }
  }, [dateTime, zoneId, queryKey, version])

  // Date changes render before effects run. Never label the previous date's
  // rows with the new date, even for that first render.
  const current = snapshot.key === queryKey ? snapshot : {
    schedules: [],
    isLoading: true,
    error: null,
  }
  return { schedules: current.schedules, isLoading: current.isLoading, error: current.error, refetch }
}

export default useScheduleList
