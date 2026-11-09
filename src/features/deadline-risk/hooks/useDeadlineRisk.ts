import { useEffect, useState } from 'react'
import { onDataChanged } from '@shared/utils/events'
import { fetchDeadlineRisk } from '../api/deadlineRisk'
import type { DeadlineRiskDays, DeadlineRiskResponse } from '../types/deadlineRisk'

type Result = {
  key: string
  forecast: DeadlineRiskResponse | null
  error: string | null
  isLoading: boolean
}

export default function useDeadlineRisk(days: DeadlineRiskDays, zoneId: string) {
  const [revision, setRevision] = useState(0)
  const key = `${days}/${zoneId}/${revision}`
  const [result, setResult] = useState<Result | null>(null)
  const refresh = () => setRevision((previous) => previous + 1)

  useEffect(() => {
    const invalidate = () => setRevision((previous) => previous + 1)
    const offData = onDataChanged(invalidate)
    window.addEventListener('focus', invalidate)
    return () => {
      offData()
      window.removeEventListener('focus', invalidate)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    const load = async () => {
      setResult({ key, forecast: null, error: null, isLoading: true })
      try {
        const forecast = await fetchDeadlineRisk(days, controller.signal)
        if (!cancelled) setResult({ key, forecast, error: null, isLoading: false })
      } catch {
        if (!cancelled) setResult({
          key,
          forecast: null,
          error: '마감 위험 예보를 불러오지 못했어요. 연결을 확인한 뒤 다시 조회해 주세요.',
          isLoading: false,
        })
      }
    }
    void load()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [key, days])

  // Hide the old range/zone immediately, before the next effect starts.
  const current = result?.key === key ? result : null
  return {
    forecast: current?.forecast ?? null,
    error: current?.error ?? null,
    isLoading: current?.isLoading ?? true,
    refresh,
  }
}
