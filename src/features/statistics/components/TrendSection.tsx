import { fetchStatisticsTrend } from '../api/report'
import useReport from '../hooks/useReport'
import type { StatisticsUnit } from '../types/report'
import { formatRate, trendBars } from '../utils/reportView'
import { formatMinutesToTime } from '@shared/utils/statisticsTransform'
import './ReportSections.css'

type Props = {
  unit: StatisticsUnit
  /** 마지막 기간 첫날 YYYY-MM-DD. 생략하면 지금이 속한 기간 */
  end?: string
}

/** ADR-0025 §4·§11 추세. 기간별 총 실행 시간 막대와 일정 완료율. */
const TrendSection = ({ unit, end }: Props) => {
  const { data, error, isLoading, reload } = useReport(() => fetchStatisticsTrend(unit, end), `${unit}:${end ?? ''}`)
  const title = unit === 'WEEK' ? '최근 8주 흐름' : '최근 6개월 흐름'

  if (isLoading && !data) {
    return (
      <section className="report-section" aria-busy="true">
        <h2>{title}</h2>
        <p className="report-section__hint">흐름을 불러오는 중...</p>
      </section>
    )
  }

  if (error || !data) {
    return (
      <section className="report-section">
        <h2>{title}</h2>
        <p className="report-section__hint" role="alert">
          흐름을 불러오지 못했어요. {error}
        </p>
        <button type="button" onClick={reload}>
          다시 시도
        </button>
      </section>
    )
  }

  const bars = trendBars(unit, data.periods)

  return (
    <section className="report-section">
      <div className="report-section__head">
        <h2>{title}</h2>
        <p className="report-section__hint">막대는 완료한 일정의 실행 시간, 아래 숫자는 일정 완료율이에요.</p>
      </div>
      <ol className="trend-chart" aria-label={title}>
        {bars.map((bar) => (
          <li
            key={bar.start}
            className={bar.current ? 'trend-chart__item is-current' : 'trend-chart__item'}
            aria-label={`${bar.label} ${formatMinutesToTime(bar.minutes)}, 완료율 ${formatRate(bar.completionRate)}`}
          >
            <span className="trend-chart__value">{bar.minutes > 0 ? formatMinutesToTime(bar.minutes) : ''}</span>
            <span className="trend-chart__track">
              <span className="trend-chart__bar" style={{ height: `${Math.round(bar.ratio * 100)}%` }} />
            </span>
            <span className="trend-chart__label">{bar.label}</span>
            <span className="trend-chart__rate">{formatRate(bar.completionRate)}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}

export default TrendSection
