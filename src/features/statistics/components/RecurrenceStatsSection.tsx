import { Link } from 'react-router-dom'
import { fetchRecurrenceStatistics } from '../api/report'
import useReport from '../hooks/useReport'
import { formatRate, pendingTodayLine, streakLine } from '../utils/reportView'
import './ReportSections.css'

/** ADR-0025 §5·§11 반복 시리즈별 완료율과 연속 기록. */
const RecurrenceStatsSection = () => {
  const { data, error, isLoading, reload } = useReport(() => fetchRecurrenceStatistics('ACTIVE'), 'ACTIVE')

  if (isLoading && !data) {
    return (
      <section className="report-section" aria-busy="true">
        <p className="report-section__hint">반복 기록을 불러오는 중...</p>
      </section>
    )
  }

  if (error || !data) {
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

  if (data.recurrences.length === 0) {
    return (
      <section className="report-section">
        <h2>반복 기록</h2>
        <p className="report-section__hint">진행 중인 반복이 없어요. 운동처럼 꾸준히 할 일을 반복으로 만들어 보세요.</p>
        <Link className="report-section__link" to="/app/settings/recurrences">
          반복 관리로 가기
        </Link>
      </section>
    )
  }

  return (
    <section className="report-section">
      <div className="report-section__head">
        <h2>반복 기록</h2>
        <p className="report-section__hint">
          완료율은 지난 회차 기준이에요. 오늘 회차는 아직 놓친 것으로 세지 않고, 이번만 지운 회차는 빼요.
        </p>
      </div>
      <ul className="recurrence-stats">
        {data.recurrences.map((series) => {
          const pending = pendingTodayLine(series)
          return (
            <li key={series.seriesId} className="recurrence-stats__item">
              <div className="recurrence-stats__head">
                <span className="recurrence-stats__title">🔁 {series.title}</span>
                <span className="recurrence-stats__rate">{formatRate(series.completionRate)}</span>
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
