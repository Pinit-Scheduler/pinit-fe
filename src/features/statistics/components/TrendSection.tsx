import type { CSSProperties } from 'react'
import { fetchStatisticsTrend } from '../api/report'
import useReport from '../hooks/useReport'
import { useHeldValue, useSawLoading } from '../hooks/useReportMotion'
import type { StatisticsUnit } from '../types/report'
import { barHiddenPercent } from '../utils/chartMotion'
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
  const { data, error, isLoading, isRefreshing, reload } = useReport(
    () => fetchStatisticsTrend(unit, end),
    `trend:${unit}:${end ?? ''}`,
  )
  const { shown, held } = useHeldValue(data)
  const reveal = useSawLoading(isLoading && !shown)
  const title = unit === 'WEEK' ? '최근 8주 흐름' : '최근 6개월 흐름'

  if (error && !data) {
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

  if (!shown) {
    return (
      <section className="report-section report-section--loading" aria-busy="true">
        <h2>{title}</h2>
        <p className="report-section__hint">흐름을 불러오는 중...</p>
      </section>
    )
  }

  const bars = trendBars(unit, shown.periods)

  return (
    <section
      className={reveal ? 'report-section report-reveal' : 'report-section'}
      data-pending={held || undefined}
      aria-busy={held || isRefreshing || undefined}
    >
      <div className="report-section__head">
        <h2>{title}</h2>
        <p className="report-section__hint">막대는 완료한 일정의 실행 시간, 아래 숫자는 일정 완료율이에요.</p>
      </div>
      {held && <p className="sr-only" role="status">흐름을 불러오는 중...</p>}
      {error && (
        <div className="report-inline-error report-section__hint" role="alert">
          <span>흐름을 불러오지 못했어요. {error}</span>
          <button type="button" onClick={reload}>
            다시 시도
          </button>
        </div>
      )}
      <ol className="trend-chart" aria-label={title} aria-hidden={held || undefined}>
        {/* 자리(순서)로 키를 준다. 기간을 넘기면 같은 자리의 막대가 이전 높이에서 새 높이로 옮겨 간다. */}
        {bars.map((bar, index) => (
          <li
            key={index}
            className={bar.current ? 'trend-chart__item is-current' : 'trend-chart__item'}
            aria-label={`${bar.label} ${formatMinutesToTime(bar.minutes)}, 완료율 ${formatRate(bar.completionRate)}`}
            style={{ '--i': index } as CSSProperties}
          >
            <span className="trend-chart__value report-datum">{bar.minutes > 0 ? formatMinutesToTime(bar.minutes) : ''}</span>
            <span className="trend-chart__track">
              <span
                className="trend-chart__bar report-mark report-mark--rise"
                style={{ transform: `translateY(${barHiddenPercent(bar.ratio)}%)` }}
              />
            </span>
            <span className="trend-chart__label report-datum">{bar.label}</span>
            <span className="trend-chart__rate report-datum">{formatRate(bar.completionRate)}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}

export default TrendSection
