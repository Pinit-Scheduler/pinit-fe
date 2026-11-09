import dayjs from 'dayjs'
import { fetchWeeklySchedules } from '@features/schedules/api/schedules'
import { fetchPeriodStatistics } from '../api/report'
import useReport from '../hooks/useReport'
import { useTimePreferences } from '@contexts/TimePreferencesContext'
import {
  parseIsoDurationMinutes,
  formatMinutesLabel,
} from '@shared/utils/isoDuration'
import { toDateKey } from '@shared/utils/datetime'
import type { StatisticsUnit } from '../types/report'
import { summarizePlans } from '../utils/planComparison'
import './PlanComparisonSection.css'
const states = [
  ['NOT_STARTED', '미시작'],
  ['IN_PROGRESS', '진행 중'],
  ['SUSPENDED', '일시정지'],
  ['COMPLETED', '완료'],
] as const
export default function PlanComparisonSection({
  unit,
  start,
}: {
  unit: StatisticsUnit
  start: string
}) {
  const { zoneId } = useTimePreferences()
  const { data, error, isLoading, reload } = useReport(
    async () => {
      const from = dayjs.tz(start + 'T12:00:00', zoneId),
        end = unit === 'WEEK' ? from.add(7, 'day') : from.add(1, 'month')
      const anchors = []
      for (
        let cursor = from.startOf('isoWeek').hour(12);
        cursor.isBefore(end);
        cursor = cursor.add(7, 'day')
      )
        anchors.push(cursor)
      const [report, ...weeks] = await Promise.all([
        fetchPeriodStatistics(unit, start),
        ...anchors.map((anchor) => fetchWeeklySchedules(anchor)),
      ])
      const summary = summarizePlans(
        weeks.flat().map((s) => ({
          id: s.id,
          date: toDateKey(s.date),
          state: s.state,
          plannedMinutes: parseIsoDurationMinutes(s.plannedDuration),
        })),
        start,
        end.format('YYYY-MM-DD'),
      )
      return { report, summary }
    },
    'plan-comparison:' + unit + ':' + start + ':' + zoneId,
  )
  if (isLoading && !data)
    return (
      <section className="workspace-panel plan-comparison" aria-busy="true">
        <p>계획 시간과 실행 기록을 불러오는 중…</p>
      </section>
    )
  if (error || !data)
    return (
      <section className="workspace-inline-error" role="alert">
        <span>{error ?? '시간 비교를 불러오지 못했어요.'}</span>
        <button onClick={reload}>다시 시도</button>
      </section>
    )
  const actual = parseIsoDurationMinutes(data.report.schedules.elapsed) ?? 0,
    { summary } = data,
    max = Math.max(1, actual, summary.completedPlanned),
    dayMax = Math.max(1, ...summary.days.map(([, n]) => n))
  return (
    <>
      <section className="workspace-panel plan-comparison">
        <h2>실제 실행 시간과 계획 시간</h2>
        <p>완료한 일정 기준 · 일시정지 시간은 실제 실행 시간에서 제외됩니다.</p>
        <div className="plan-comparison__rows">
          <div>
            <span>실제 실행</span>
            <div>
              <i style={{ width: (actual / max) * 100 + '%' }} />
            </div>
            <strong>{formatMinutesLabel(actual)}</strong>
          </div>
          <div>
            <span>완료 일정의 계획</span>
            <div>
              <i
                className="is-planned"
                style={{ width: (summary.completedPlanned / max) * 100 + '%' }}
              />
            </div>
            <strong>{formatMinutesLabel(summary.completedPlanned)}</strong>
          </div>
        </div>
        <small>
          기간 전체 일정의 계획 시간 {formatMinutesLabel(summary.totalPlanned)}
          {summary.unknown > 0 &&
            ' · 계획 길이를 알 수 없는 일정 ' + summary.unknown + '개 제외'}
        </small>
      </section>
      <div className="workspace-stat-grid">
        <section className="workspace-panel plan-comparison">
          <h2>날짜별 계획 시간</h2>
          <p>일정이 배정된 날짜 기준</p>
          <div
            className="plan-daily-bars"
            role="img"
            aria-label="날짜별 계획 시간"
          >
            {summary.days.length ? (
              summary.days.map(([date, n]) => (
                <div key={date} title={date + ' · ' + formatMinutesLabel(n)}>
                  <strong>{Math.round(n)}분</strong>
                  <i style={{ height: Math.max(3, (n / dayMax) * 130) }} />
                  <span>{date.slice(5).replace('-', '/')}</span>
                </div>
              ))
            ) : (
              <p>이 기간에 계획한 일정이 없어요.</p>
            )}
          </div>
          <details>
            <summary>날짜별 수치 보기</summary>
            <ul>
              {summary.days.map(([date, n]) => (
                <li key={date}>
                  {date} · {formatMinutesLabel(n)}
                </li>
              ))}
            </ul>
          </details>
        </section>
        <section className="workspace-panel plan-comparison">
          <h2>일정 상태</h2>
          <p>전체 {summary.total}개</p>
          <div className="plan-state-list">
            {states.map(([state, label], i) => (
              <div key={state}>
                <i style={{ opacity: 1 - i * 0.15 }} />
                <span>{label}</span>
                <strong>{summary.states[state]}개</strong>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  )
}
