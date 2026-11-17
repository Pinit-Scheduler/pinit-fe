import { useRevalidatingQuery } from '@shared/hooks/useRevalidatingQuery'
import { fetchSplitSummary, type SplitSummary } from '../api/splitRequests'

export const SPLIT_SUMMARY_KEY = 'task-split/summary'

/** 읽지 못했으면 summary는 null이다. 오류를 화면에 알리지 않는다. */
export const useSplitSummary = (): { summary: SplitSummary | null; refetch: () => void } => {
  const { data, refetch } = useRevalidatingQuery(SPLIT_SUMMARY_KEY, fetchSplitSummary, {
    invalidateOn: ['task'],
    refetchOnFocus: true,
    revalidateOnMount: false,
  })
  return { summary: data ?? null, refetch }
}
