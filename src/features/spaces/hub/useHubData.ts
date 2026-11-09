import useReport from '@features/statistics/hooks/useReport'
import {
  fetchSpaceSummaries,
  fetchSpaceSummary,
  fetchWeeklyRecord,
} from '../api'
import type { SpaceSummary, WeeklyRecord } from '../types'

const none = () => Promise.resolve(null)

/**
 * 허브의 세 조회. key에 스페이스를 넣어 다른 스페이스의 응답이 잠깐이라도 보이지 않게 한다.
 * useReport는 작업·일정 변경 이벤트(실시간 changed·멤버십 변경 포함)에 다시 조회한다.
 */
export default function useHubData(
  spaceId: number | null,
  weekStart: string,
  withRecord: boolean,
) {
  const summaries = useReport(() => fetchSpaceSummaries(), 'summaries')
  const summary = useReport<SpaceSummary | null>(
    spaceId === null ? none : () => fetchSpaceSummary(spaceId),
    `summary:${spaceId}`,
  )
  const record = useReport<WeeklyRecord | null>(
    spaceId === null || !withRecord
      ? none
      : () => fetchWeeklyRecord(spaceId, weekStart),
    withRecord ? `record:${spaceId}:${weekStart}` : 'record:none',
  )
  return { summaries, summary, record }
}
