import { onScheduleChanged } from '@shared/utils/events'
import { fetchScheduleDetail } from '../api/schedules'
import { useEffect, useState } from 'react'
import { useScheduleCache } from '@contexts/ScheduleCacheContext'
import type { ScheduleResponse } from '../types/schedule'

type UseScheduleDetailReturn = {
  schedule: ScheduleResponse | null
  /** Nothing loaded yet for this id. A refetch of a shown schedule is `isRefreshing` instead. */
  isLoading: boolean
  /** A refetch is running while the schedule stays on screen. */
  isRefreshing: boolean
  error: string | null
  refetch: () => void
  /** 이미 받아 온 최신 상세로 화면 상태만 바꾼다(로딩 상태를 거치지 않는다). */
  replace: (response: ScheduleResponse) => void
}

const isGone = (failure: unknown) => {
  const status =
    typeof failure === 'object' && failure !== null && 'status' in failure
      ? (failure as { status?: unknown }).status
      : undefined
  return status === 403 || status === 404 || status === 410
}

const useScheduleDetail = (
  scheduleId?: string,
  { refreshOnChange = true }: { refreshOnChange?: boolean } = {},
): UseScheduleDetailReturn => {
  const numericId = scheduleId ? Number(scheduleId) : undefined
  const [schedule, setSchedule] = useState<ScheduleResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  // The id the current schedule/error belongs to. Another id never shows this one's content.
  const [loadedId, setLoadedId] = useState<number | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  // The last read for this id said the schedule is gone or no longer visible (403, 404, 410).
  const [gone, setGone] = useState(false)
  const [timestamp, setTimestamp] = useState(() => Date.now())
  const { setSchedule: cacheSchedule, schedulesById } = useScheduleCache()
  // A list or the mini player usually holds this schedule already. The detail view shows it at
  // once instead of a loading line and lets the read refresh it. An edit session (refreshOnChange
  // false) waits for its own read, so its form and version come from the server, not the cache.
  const cached =
    refreshOnChange && numericId !== undefined ? schedulesById?.[numericId] : undefined

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
    if (!numericId) {
      setSchedule(null)
      setIsLoading(false)
      setLoadedId(undefined)
      setError('일정 ID가 유효하지 않습니다.')
      return
    }
    let isMounted = true

    const fetchSchedule = async () => {
      setIsLoading(true)
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
          const message =
            err instanceof Error ? err.message : '일정을 불러오지 못했습니다.'
          setError(message)
          // A failed refresh keeps the schedule on screen. Only a schedule that is gone or no
          // longer visible to this member drops it. Another id's schedule never stays.
          const dropped = isGone(err)
          setGone(dropped)
          setSchedule((previous) =>
            dropped || previous?.id !== numericId ? null : previous,
          )
          setLoadedId(numericId)
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    fetchSchedule()

    return () => {
      isMounted = false
    }
  }, [cacheSchedule, numericId, timestamp])

  useEffect(() => {
    if (refreshOnChange || !numericId || typeof window === 'undefined') return
    let mounted = true
    let sequence = 0
    const verifyAccess = (event: Event) => {
      const removed = (event as CustomEvent<{ scheduleIds?: number[] }>).detail
      if (!removed?.scheduleIds?.includes(numericId)) return
      const current = ++sequence
      // Check access without replacing the edit session's content or version.
      void fetchScheduleDetail(numericId).catch((failure: unknown) => {
        if (!mounted || current !== sequence) return
        const status = typeof failure === 'object' && failure !== null && 'status' in failure
          ? failure.status : undefined
        if (status !== 403 && status !== 404 && status !== 410) return
        setSchedule(null)
        setError('일정이 이동되었거나 접근 권한이 변경됐습니다. 목록에서 다시 확인해 주세요.')
      })
    }
    window.addEventListener('workspace:resources-evicted', verifyAccess)
    window.addEventListener('workspace:access-changed', verifyAccess)
    return () => {
      mounted = false
      window.removeEventListener('workspace:resources-evicted', verifyAccess)
      window.removeEventListener('workspace:access-changed', verifyAccess)
    }
  }, [numericId, refreshOnChange])

  const current = numericId !== undefined && loadedId === numericId
  // The schedule this id last loaded, or the cached copy until the first read lands. While the
  // detail follows changes, a newer cached version (a state change made elsewhere) wins.
  // A first read that failed without saying the schedule is gone keeps the cached copy.
  const loaded = current ? (schedule ?? (gone ? null : (cached ?? null))) : null
  const shown =
    loaded && cached && (cached.version ?? 0) > (loaded.version ?? 0)
      ? cached
      : current
        ? loaded
        : (cached ?? null)
  const seeded = !current && shown !== null
  return {
    schedule: shown,
    isLoading: numericId === undefined ? isLoading : !current && !seeded,
    isRefreshing: (current && isLoading) || seeded,
    error: numericId === undefined || current ? error : null,
    refetch: () => setTimestamp((previous) => previous + 1),
    replace: (response) => {
      setError(null)
      setSchedule(response)
      cacheSchedule(response)
    },
  }
}

export default useScheduleDetail
