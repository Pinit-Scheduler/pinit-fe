import { fetchPeriodStatistics } from '../api/report'
import useReport from '../hooks/useReport'
import { useHeldValue, useSawLoading } from '../hooks/useReportMotion'
import type { StatisticsUnit } from '../types/report'
import {
  SCHEDULE_TYPE_LABEL,
  completionLine,
  formatRate,
} from '../utils/reportView'
import StatisticCard from './StatisticCard'
import TweenedNumber from './TweenedNumber'
import { formatIsoDurationLabel, formatMinutesLabel } from '@shared/utils/isoDuration'
import './ReportSections.css'
import DonutChart from './DonutChart'
import SpaceTimeSection from './SpaceTimeSection'
import { parseIsoDurationMinutes } from '@shared/utils/isoDuration'

type Props = {
  unit: StatisticsUnit
  /** 기간 첫날 YYYY-MM-DD */
  start: string
}

/** 기간 값(ISO Duration)을 이전 값에서 이어지는 라벨로 그린다. 읽을 수 없으면 원래처럼 "-". */
const DurationValue = ({ value }: { value: string | null | undefined }) => {
  const minutes = parseIsoDurationMinutes(value)
  if (minutes === null) return <>{formatIsoDurationLabel(value) ?? '-'}</>
  return <TweenedNumber value={minutes} format={formatMinutesLabel} />
}

/** ADR-0025 §3·§11 기간 통계. 유형별 실행 시간·완료율과 마감 작업 완료율. */
const PeriodSummarySection = ({ unit, start }: Props) => {
  const { data, error, isLoading, isRefreshing, reload } = useReport(
    () => fetchPeriodStatistics(unit, start),
    `period:${unit}:${start}`,
  )
  // 다른 기간으로 넘기는 동안 틀(카드·도넛 자리)만 붙잡아 둔다. 숫자는 숨긴다.
  const { shown, held } = useHeldValue(data)
  const showLoading = isLoading && !data && !shown
  const reveal = useSawLoading(showLoading)

  if (error && !data) {
    return (
      <section className="report-section">
        <p className="report-section__hint" role="alert">
          통계를 불러오지 못했어요. {error}
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
        <p className="report-section__hint">통계를 불러오는 중...</p>
      </section>
    )
  }

  const { schedules, byType, tasksDue } = shown
  const elapsedMinutes = parseIsoDurationMinutes(schedules.elapsed) ?? 0
  const deepMinutes =
    parseIsoDurationMinutes(
      byType.find((type) => type.scheduleType === 'DEEP_WORK')?.elapsed,
    ) ?? 0
  const adminMinutes =
    parseIsoDurationMinutes(
      byType.find((type) => type.scheduleType === 'ADMIN_TASK')?.elapsed,
    ) ?? 0

  return (
    <div
      className={reveal ? 'report-stack report-reveal' : 'report-stack'}
      data-pending={held || undefined}
      aria-busy={held || isRefreshing || undefined}
    >
      {held && <p className="report-sr-only" role="status">통계를 불러오는 중...</p>}
      {error && (
        <div className="report-inline-error report-section__hint" role="alert">
          <span>통계를 불러오지 못했어요. {error}</span>
          <button type="button" onClick={reload}>
            다시 시도
          </button>
        </div>
      )}
      <div className="report-stack" aria-hidden={held || undefined}>
        <div className="statistics-tab__cards">
          <StatisticCard
            label="총 실제 실행 시간"
            value={<DurationValue value={schedules.elapsed} />}
            description={completionLine(
              schedules.completedCount,
              schedules.count,
              schedules.completionRate,
            )}
          />
          {byType.map((type) => (
            <StatisticCard
              key={type.scheduleType}
              label={SCHEDULE_TYPE_LABEL[type.scheduleType]}
              value={<DurationValue value={type.elapsed} />}
              description={completionLine(
                type.completedCount,
                type.count,
                type.completionRate,
              )}
            />
          ))}
        </div>
        <DonutChart
          deepWorkRatio={elapsedMinutes ? deepMinutes / elapsedMinutes : 0}
          adminWorkRatio={elapsedMinutes ? adminMinutes / elapsedMinutes : 0}
          totalMinutes={elapsedMinutes}
        />
        <SpaceTimeSection bySpace={shown.bySpace} start={shown.start} end={shown.end} />
        <section className="report-section">
          <div className="report-section__head">
            <h2>마감 작업</h2>
            <p className="report-section__hint">
              이 기간이 마감인 작업 중 완료한 비율이에요.
            </p>
          </div>
          <p className="report-section__big report-datum">
            {tasksDue.count === 0
              ? '마감인 작업이 없어요'
              : `${tasksDue.completedCount} / ${tasksDue.count}개 완료 (${formatRate(tasksDue.completionRate)})`}
          </p>
        </section>
      </div>
    </div>
  )
}

export default PeriodSummarySection
