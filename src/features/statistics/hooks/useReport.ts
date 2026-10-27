import { useCallback, useEffect, useState } from 'react'
import { onScheduleChanged, onTaskChanged } from '@shared/utils/events'

type UseReportReturn<T> = {
  data: T | null
  error: string | null
  isLoading: boolean
  reload: () => void
}

/**
 * ADR-0025 통계 조회 공통 훅. key가 바뀌거나 일정·작업이 바뀌면 다시 불러온다.
 * load는 key가 같은 동안 같은 요청을 만들어야 한다. 다른 key로 받은 응답은 돌려주지 않는다.
 * 그래서 기간을 넘기면 새 응답이 올 때까지 이전 기간 값 대신 로딩 상태가 보인다.
 */
const useReport = <T,>(load: () => Promise<T>, key: string): UseReportReturn<T> => {
  const [loaded, setLoaded] = useState<{ key: string; value: T } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)
  const reload = useCallback(() => setRefreshKey((value) => value + 1), [])

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    setError(null)
    load()
      .then((response) => {
        if (!cancelled) setLoaded({ key, value: response })
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '통계를 불러오지 못했어요.')
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
    // load는 key로 대표한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, refreshKey])

  useEffect(() => onScheduleChanged(reload), [reload])
  useEffect(() => onTaskChanged(reload), [reload])

  const data = loaded && loaded.key === key ? loaded.value : null
  return { data, error, isLoading, reload }
}

export default useReport
