import dayjs from 'dayjs'
import { fetchWeeklySchedules } from '@features/schedules/api/schedules'
import { fetchPeriodStatistics } from '../api/report'
import type { CSSProperties } from 'react'
import useReport from '../hooks/useReport'
import { useArrival } from '@shared/motion'
import { useHeldValue } from '../hooks/useReportMotion'
import { barHiddenPercent, columnRatio } from '../utils/chartMotion'
import TweenedNumber from '@shared/components/motion/TweenedNumber'
import './ReportSections.css'
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
  const { data, error, isLoading, isRefreshing, reload } = useReport(
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
        ...anchors.map((anchor) => fetchWeeklySchedules(anchor, { allSpaces: true, mine: true })),
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
  // 다른 기간으로 넘기는 동안 막대 자리만 붙잡아 둔다. 숫자는 숨긴다.
  const { shown, held } = useHeldValue(data)
  const reveal = useArrival(isLoading && !shown)
  if (error && !data)
    return (
      <section className="workspace-inline-error" role="alert">
        <span>{error ?? '시간 비교를 불러오지 못했어요.'}</span>
        <button onClick={reload}>다시 시도</button>
      </section>
    )
  if (!shown)
    return (
      <section
        className="workspace-panel plan-comparison report-section--loading"
        aria-busy="true"
      >
        <p>계획 시간과 실행 기록을 불러오는 중…</p>
      </section>
    )
  const actual = parseIsoDurationMinutes(shown.report.schedules.elapsed) ?? 0,
    { summary } = shown,
    max = Math.max(1, actual, summary.completedPlanned),
    dayMax = Math.max(1, ...summary.days.map(([, n]) => n))
  const minutes = (value: number) => (
    <TweenedNumber value={value} format={formatMinutesLabel} />
  )
  return (
    <div
      className={reveal ? 'report-stack report-reveal' : 'report-stack'}
      data-pending={held || undefined}
      aria-busy={held || isRefreshing || undefined}
    >
      {held && (
        <p className="sr-only" role="status">
          계획 시간과 실행 기록을 불러오는 중…
        </p>
      )}
      {error && (
        <section className="workspace-inline-error report-inline-error" role="alert">
          <span>{error}</span>
          <button onClick={reload}>다시 시도</button>
        </section>
      )}
      <section className="workspace-panel plan-comparison" inert={held || undefined}>
        <h2>실제 실행 시간과 계획 시간</h2>
        <p>완료한 일정 기준 · 일시정지 시간은 실제 실행 시간에서 제외됩니다.</p>
        <div className="plan-comparison__rows">
          <div>
            <span>실제 실행</span>
            <div className="plan-comparison__track">
              <i
                className="plan-comparison__bar report-mark report-mark--slide"
                style={{ transform: `translateX(-${barHiddenPercent(actual / max)}%)` }}
              />
            </div>
            <strong className="report-datum">{minutes(actual)}</strong>
          </div>
          <div>
            <span>완료 일정의 계획</span>
            <div className="plan-comparison__track">
              <i
                className="plan-comparison__bar is-planned report-mark report-mark--slide"
                style={
                  {
                    '--i': 1,
                    transform: `translateX(-${barHiddenPercent(summary.completedPlanned / max)}%)`,
                  } as CSSProperties
                }
              />
            </div>
            <strong className="report-datum">{minutes(summary.completedPlanned)}</strong>
          </div>
        </div>
        <small className="report-datum">
          기간 전체 일정의 계획 시간 {formatMinutesLabel(summary.totalPlanned)}
          {summary.unknown > 0 &&
            ' · 계획 길이를 알 수 없는 일정 ' + summary.unknown + '개 제외'}
        </small>
      </section>
      {/* inert: 붙잡은 틀 안의 "날짜별 수치 보기"가 다른 기간 값을 읽히거나 포커스를 받지 않게 한다. */}
      <div className="workspace-stat-grid" inert={held || undefined}>
        <section className="workspace-panel plan-comparison">
          <h2>날짜별 계획 시간</h2>
          <p>일정이 배정된 날짜 기준</p>
          <div
            className="plan-daily-bars"
            role="img"
            aria-label="날짜별 계획 시간"
          >
            {summary.days.length ? (
              // 자리(순서)로 키를 준다. 기간을 넘기면 같은 자리의 막대가 이전 높이에서 새 높이로 옮겨 간다.
              summary.days.map(([date, n], index) => {
                const hidden = barHiddenPercent(columnRatio(n, dayMax, 3 / 130)) / 100
                return (
                  <div
                    key={index}
                    title={date + ' · ' + formatMinutesLabel(n)}
                    style={{ '--i': index, '--hidden': hidden } as CSSProperties}
                  >
                    <strong className="plan-daily-bars__value report-datum">
                      {Math.round(n)}분
                    </strong>
                    <span className="plan-daily-bars__track">
                      <i className="plan-daily-bars__bar report-mark report-mark--rise" />
                    </span>
                    <span className="report-datum">{date.slice(5).replace('-', '/')}</span>
                  </div>
                )
              })
            ) : (
              <p className="report-datum">이 기간에 계획한 일정이 없어요.</p>
            )}
          </div>
          <details>
            <summary>날짜별 수치 보기</summary>
            <ul className="report-datum">
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
          <p className="report-datum">
            전체 <TweenedNumber value={summary.total} />개
          </p>
          <div className="plan-state-list">
            {states.map(([state, label], i) => (
              <div key={state}>
                <i style={{ opacity: 1 - i * 0.15 }} />
                <span>{label}</span>
                <strong className="report-datum">
                  <TweenedNumber
                    value={summary.states[state]}
                    format={(n) => Math.round(n) + '개'}
                  />
                </strong>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
