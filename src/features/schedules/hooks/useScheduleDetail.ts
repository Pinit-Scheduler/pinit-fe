import { onScheduleChanged } from '@shared/utils/events'
import { fetchScheduleDetail } from '../api/schedules'
import { useEffect, useState } from 'react'
import { useScheduleCache } from '@contexts/ScheduleCacheContext'
import type { ScheduleResponse } from '../types/schedule'

type UseScheduleDetailReturn = {
  schedule: ScheduleResponse | null
  isLoading: boolean
  error: string | null
  refetch: () => void
  /** 이미 받아 온 최신 상세로 화면 상태만 바꾼다(로딩 상태를 거치지 않는다). */
  replace: (response: ScheduleResponse) => void
}

const useScheduleDetail = (
  scheduleId?: string,
  { refreshOnChange = true }: { refreshOnChange?: boolean } = {},
): UseScheduleDetailReturn => {
  const numericId = scheduleId ? Number(scheduleId) : undefined
  const [schedule, setSchedule] = useState<ScheduleResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [timestamp, setTimestamp] = useState(() => Date.now())
  const { setSchedule: cacheSchedule } = useScheduleCache()

  useEffect(() => {
    if (!refreshOnChange) return
    return onScheduleChanged(() => setTimestamp((previous) => previous + 1))
  }, [refreshOnChange])

  useEffect(() => {
    if (!numericId) {
      setSchedule(null)
      setIsLoading(false)
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
          cacheSchedule(response)
        }
      } catch (err) {
        if (isMounted) {
          const message =
            err instanceof Error ? err.message : '일정을 불러오지 못했습니다.'
          setError(message)
          setSchedule(null)
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

  return {
    schedule,
    isLoading,
    error,
    refetch: () => setTimestamp((previous) => previous + 1),
    replace: (response) => {
      setError(null)
      setSchedule(response)
      cacheSchedule(response)
    },
  }
}

export default useScheduleDetail
