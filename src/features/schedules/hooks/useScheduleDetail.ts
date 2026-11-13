import { onScheduleChanged } from '@shared/utils/events'
import { fetchScheduleDetail } from '../api/schedules'
import { getRequestFailureMessage, readFailureMessage } from '@shared/api/errorMessage'
import { useEffect, useState } from 'react'
import { useScheduleCache } from '@contexts/ScheduleCacheContext'
import { isRevokedRead } from '@features/spaces/metadata'
import type { ScheduleResponse } from '../types/schedule'

type UseScheduleDetailReturn = {
  schedule: ScheduleResponse | null
  /** Nothing to show for this id yet: no read has landed and the cache has no copy. */
  isLoading: boolean
  error: string | null
  refetch: () => void
  /** 이미 받아 온 최신 상세로 화면 상태만 바꾼다(로딩 상태를 거치지 않는다). */
  replace: (response: ScheduleResponse) => void
}

const INVALID_ID = '일정 주소가 올바르지 않아요.'

/** The newer of the read and the cached copy. A state change made elsewhere lands in the cache first. */
const newer = (read: ScheduleResponse | null, cached: ScheduleResponse | undefined) =>
  read && (!cached || (cached.version ?? 0) <= (read.version ?? 0)) ? read : (cached ?? null)

const useScheduleDetail = (
  scheduleId?: string,
  { refreshOnChange = true }: { refreshOnChange?: boolean } = {},
): UseScheduleDetailReturn => {
  const numericId = scheduleId ? Number(scheduleId) : NaN
  const valid = Number.isInteger(numericId) && numericId > 0
  const [schedule, setSchedule] = useState<ScheduleResponse | null>(null)
  // The id the current schedule/error belongs to. Another id never shows this one's content.
  const [loadedId, setLoadedId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  // The last read for this id said the schedule is gone (see isRevokedRead).
  const [gone, setGone] = useState(false)
  const [timestamp, setTimestamp] = useState(() => Date.now())
  const { setSchedule: cacheSchedule, schedulesById } = useScheduleCache()
  // A list or the mini player usually holds this schedule already. The detail view shows it at
  // once instead of a loading line and lets the read refresh it. An edit session (refreshOnChange
  // false) waits for its own read, so its form and version come from the server, not the cache.
  const cached = refreshOnChange && valid ? schedulesById[numericId] : undefined

  useEffect(() => {
    if (!refreshOnChange) return
    return onScheduleChanged((detail, details = [detail]) => {
      // This detail deleting its own schedule closes the surface. Reading it again would only
      // answer 404 and swap the closing modal for the not-found panel.
      if (
        details.length > 0 &&
        details.every((item) => item.reason === 'deleted' && item.scheduleId === numericId)
      )
        return
      setTimestamp((previous) => previous + 1)
    })
  }, [numericId, refreshOnChange])

  useEffect(() => {
    if (!valid) return
    let isMounted = true

    const fetchSchedule = async () => {
      setError(null)
      try {
        const response = await fetchScheduleDetail(numericId)
        if (isMounted) {
          setSchedule(response)
          setGone(false)
          setLoadedId(numericId)
          cacheSchedule(response)
        }
      } catch (err) {
        if (isMounted) {
          setError(getRequestFailureMessage(err, '일정을 불러오지 못했어요.'))
          // A failed refresh keeps the schedule on screen. Only a schedule that is gone drops it.
          // Another id's schedule never stays.
          const dropped = isRevokedRead(err)
          setGone(dropped)
          setSchedule((previous) =>
            dropped || previous?.id !== numericId ? null : previous,
          )
          setLoadedId(numericId)
        }
      }
    }

    fetchSchedule()

    return () => {
      isMounted = false
    }
  }, [cacheSchedule, numericId, valid, timestamp])

  useEffect(() => {
    if (refreshOnChange || !valid || typeof window === 'undefined') return
    let mounted = true
    let sequence = 0
    const verifyAccess = (event: Event) => {
      const removed = (event as CustomEvent<{ scheduleIds?: number[] }>).detail
      if (!removed?.scheduleIds?.includes(numericId)) return
      const current = ++sequence
      // Check access without replacing the edit session's content or version.
      void fetchScheduleDetail(numericId).catch((failure: unknown) => {
        if (!mounted || current !== sequence || !isRevokedRead(failure)) return
        setSchedule(null)
        setError(
          readFailureMessage(failure) ??
            '일정이 옮겨졌거나 접근 권한이 바뀌었어요. 목록에서 다시 확인해 주세요.',
        )
      })
    }
    window.addEventListener('workspace:resources-evicted', verifyAccess)
    window.addEventListener('workspace:access-changed', verifyAccess)
    return () => {
      mounted = false
      window.removeEventListener('workspace:resources-evicted', verifyAccess)
      window.removeEventListener('workspace:access-changed', verifyAccess)
    }
  }, [numericId, valid, refreshOnChange])

  const current = valid && loadedId === numericId
  const refetch = () => setTimestamp((previous) => previous + 1)
  const replace = (response: ScheduleResponse) => {
    setError(null)
    setGone(false)
    setSchedule(response)
    cacheSchedule(response)
  }
  if (!valid) return { schedule: null, isLoading: false, error: INVALID_ID, refetch, replace }
  // Until this id's first read lands, the cached copy stands in for it.
  const shown = !current ? (cached ?? null) : gone ? null : newer(schedule, cached)
  return {
    schedule: shown,
    isLoading: !current && shown === null,
    error: current ? error : null,
    refetch,
    replace,
  }
}

export default useScheduleDetail
