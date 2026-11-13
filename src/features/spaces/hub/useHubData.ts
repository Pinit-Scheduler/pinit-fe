import { useRevalidatingQuery } from '@shared/hooks/useRevalidatingQuery'
import {
  fetchSpaceSummaries,
  fetchSpaceSummary,
  fetchWeeklyRecord,
} from '../api'
import type { SpaceSummaries, SpaceSummary, WeeklyRecord } from '../types'

export type HubQuery<T> = {
  /** This key's data, or null before it first arrives. Never another space's data. */
  data: T | null
  error: string | null
  isLoading: boolean
  reload: () => void
}

const view = <T,>(query: {
  data: T | undefined
  error: string | null
  isInitialLoading: boolean
  refetch: () => void
}): HubQuery<T> => ({
  data: query.data ?? null,
  error: query.error,
  isLoading: query.isInitialLoading,
  reload: query.refetch,
})

const HUB_EVENTS = ['task', 'schedule'] as const

/**
 * 허브의 세 조회. key에 스페이스를 넣어 다른 스페이스의 응답이 잠깐이라도 보이지 않게 한다.
 * 작업·일정 변경 이벤트(실시간 changed·멤버십 변경 포함)에 다시 조회한다. 다시 조회하는 동안에는
 * 지금 숫자를 그대로 두고, 한 번 본 스페이스로 돌아오면 마지막 숫자가 바로 보인다.
 */
export default function useHubData(
  spaceId: number | null,
  weekStart: string,
  withRecord: boolean,
) {
  const summaries = useRevalidatingQuery<SpaceSummaries>(
    'spaces/hub/summaries',
    (signal) => fetchSpaceSummaries(signal),
    {
      invalidateOn: HUB_EVENTS,
      group: 'spaces/hub/',
      errorMessage: '스페이스별 남은 작업 수를 불러오지 못했어요.',
    },
  )
  const summary = useRevalidatingQuery<SpaceSummary>(
    spaceId === null ? null : `spaces/hub/summary:${spaceId}`,
    (signal) => fetchSpaceSummary(spaceId as number, signal),
    {
      invalidateOn: HUB_EVENTS,
      group: 'spaces/hub/',
      errorMessage: '이 스페이스의 작업 수를 불러오지 못했어요.',
    },
  )
  const record = useRevalidatingQuery<WeeklyRecord>(
    spaceId === null || !withRecord
      ? null
      : `spaces/hub/record:${spaceId}:${weekStart}`,
    // The key is null without a space, so the fetcher only runs with one.
    (signal) => fetchWeeklyRecord(spaceId as number, weekStart, signal),
    {
      invalidateOn: HUB_EVENTS,
      group: 'spaces/hub/',
      errorMessage: '팀 기록을 불러오지 못했어요.',
    },
  )
  return { summaries: view(summaries), summary: view(summary), record: view(record) }
}
