import WorkspaceIcon from '@shared/components/common/WorkspaceIcon'
import { Link } from 'react-router-dom'
import { presenceProps, useArrival, useListPresence } from '@shared/motion'
import { fetchRecurrenceStatistics } from '../api/report'
import useReport from '../hooks/useReport'
import { useChangeFade } from '../hooks/useReportMotion'
import { formatRate, pendingTodayLine, streakLine } from '../utils/reportView'
import TweenedNumber from '@shared/components/motion/TweenedNumber'
import './ReportSections.css'

const rate = (value: number) => formatRate(value)

/** ADR-0025 §5·§11 반복 시리즈별 완료율과 연속 기록. */
const RecurrenceStatsSection = () => {
  const { data, error, isLoading, isRefreshing, reload } = useReport(
    () => fetchRecurrenceStatistics('ACTIVE'),
    'recurrence:ACTIVE',
  )
  const reveal = useArrival(isLoading && !data)
  // 반복이 생기거나 지워지면 행이 떠오르거나 제자리에서 사라진다. 같은 목록이 다시 오면 움직이지 않는다.
  const rows = useListPresence(data?.recurrences, (series) => series.seriesId)
  const empty = data ? data.recurrences.length === 0 : null
  // 마지막 반복이 사라지거나 첫 반복이 생기면 빈 안내와 목록이 짧게 이어진다.
  const ref = useChangeFade<HTMLElement>(empty)

  if (error && !data) {
    return (
      <section className="report-section">
        <p className="report-section__hint" role="alert">
          반복 기록을 불러오지 못했어요. {error}
        </p>
        <button type="button" onClick={reload}>
          다시 시도
        </button>
      </section>
    )
  }

  if (!data) {
    return (
      <section className="report-section report-section--loading" aria-busy="true">
        <p className="report-section__hint">반복 기록을 불러오는 중...</p>
      </section>
    )
  }

  const inlineError = error && (
    <div className="report-inline-error report-section__hint" role="alert">
      <span>반복 기록을 불러오지 못했어요. {error}</span>
      <button type="button" onClick={reload}>
        다시 시도
      </button>
    </div>
  )

  if (data.recurrences.length === 0) {
    return (
      <section
        ref={ref}
        className={reveal ? 'report-section report-reveal' : 'report-section'}
        aria-busy={isRefreshing || undefined}
      >
        <h2>반복 기록</h2>
        {inlineError}
        <p className="report-section__hint">진행 중인 반복이 없어요. 운동처럼 꾸준히 할 일을 반복으로 만들어 보세요.</p>
        <Link className="report-section__link" to="/app/settings/recurrences">
          반복 관리로 가기
        </Link>
      </section>
    )
  }

  return (
    <section
      ref={ref}
      className={reveal ? 'report-section report-reveal' : 'report-section'}
      aria-busy={isRefreshing || undefined}
    >
      <div className="report-section__head">
        <h2>반복 기록</h2>
        <p className="report-section__hint">
          완료율은 지난 회차 기준이에요. 오늘 회차는 아직 놓친 것으로 세지 않고, 이번만 지운 회차는 빼요.
        </p>
      </div>
      {inlineError}
      <ul className="recurrence-stats">
        {rows.map(({ key, item: series, phase }) => {
          const pending = pendingTodayLine(series)
          return (
            <li key={key} className="recurrence-stats__item" {...presenceProps(phase)}>
              <div className="recurrence-stats__head">
                <span className="recurrence-stats__title"><WorkspaceIcon name="repeat" /> {series.title}</span>
                <span className="recurrence-stats__rate">
                  {typeof series.completionRate === 'number' && Number.isFinite(series.completionRate) ? (
                    <TweenedNumber value={series.completionRate} format={rate} />
                  ) : (
                    formatRate(series.completionRate)
                  )}
                </span>
              </div>
              <p className="recurrence-stats__line">{streakLine(series)}</p>
              <p className="recurrence-stats__meta">
                완료 {series.completedCount} · 놓침 {series.missedCount} · 최근 {series.recent.days}일{' '}
                {formatRate(series.recent.completionRate)}
              </p>
              {pending && <p className="recurrence-stats__pending">{pending}</p>}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

export default RecurrenceStatsSection
