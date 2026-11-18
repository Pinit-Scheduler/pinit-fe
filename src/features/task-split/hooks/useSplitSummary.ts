import { useRevalidatingQuery } from '@shared/hooks/useRevalidatingQuery'
import { fetchSplitSummary, type SplitSummary } from '../api/splitRequests'

export const SPLIT_SUMMARY_KEY = 'task-split/summary'

/**
 * 읽지 못했으면 summary는 null이다. 오류를 화면에 알리지 않는다.
 * `setSummary`는 따로 읽은 요약(예: 시작 흐름이 다시 읽은 것)으로 캐시를 채운다. 한 번 더 읽지 않는다.
 */
export const useSplitSummary = (): {
  summary: SplitSummary | null
  refetch: () => void
  setSummary: (summary: SplitSummary) => void
} => {
  const { data, refetch, setData } = useRevalidatingQuery(SPLIT_SUMMARY_KEY, fetchSplitSummary, {
    invalidateOn: ['task'],
    refetchOnFocus: true,
    revalidateOnMount: false,
  })
  return { summary: data ?? null, refetch, setSummary: setData }
}
