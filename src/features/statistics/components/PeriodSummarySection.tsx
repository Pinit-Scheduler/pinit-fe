import { fetchPeriodStatistics } from '../api/report'
import useReport from '../hooks/useReport'
import type { StatisticsUnit } from '../types/report'
import { SCHEDULE_TYPE_LABEL, completionLine, formatRate } from '../utils/reportView'
import StatisticCard from './StatisticCard'
import { formatIsoDurationLabel } from '@shared/utils/isoDuration'
import './ReportSections.css'

type Props = {
  unit: StatisticsUnit
  /** 기간 첫날 YYYY-MM-DD */
  start: string
}

/** ADR-0025 §3·§11 기간 통계. 유형별 실행 시간·완료율과 마감 작업 완료율. */
const PeriodSummarySection = ({ unit, start }: Props) => {
  const { data, error, isLoading, reload } = useReport(() => fetchPeriodStatistics(unit, start), `${unit}:${start}`)

  if (isLoading && !data) {
    return (
      <section className="report-section" aria-busy="true">
        <p className="report-section__hint">통계를 불러오는 중...</p>
      </section>
    )
  }

  if (error || !data) {
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

  const { schedules, byType, tasksDue } = data

  return (
    <>
      <div className="statistics-tab__cards stats-transition" key={data.start}>
        <StatisticCard
          label="총 작업 시간"
          value={formatIsoDurationLabel(schedules.elapsed) ?? '-'}
          description={completionLine(schedules.completedCount, schedules.count, schedules.completionRate)}
        />
        {byType.map((type) => (
          <StatisticCard
            key={type.scheduleType}
            label={SCHEDULE_TYPE_LABEL[type.scheduleType]}
            value={formatIsoDurationLabel(type.elapsed) ?? '-'}
            description={completionLine(type.completedCount, type.count, type.completionRate)}
          />
        ))}
      </div>
      <section className="report-section">
        <div className="report-section__head">
          <h2>마감 작업</h2>
          <p className="report-section__hint">이 기간이 마감인 작업 중 완료한 비율이에요.</p>
        </div>
        <p className="report-section__big">
          {tasksDue.count === 0
            ? '마감인 작업이 없어요'
            : `${tasksDue.completedCount} / ${tasksDue.count}개 완료 (${formatRate(tasksDue.completionRate)})`}
        </p>
      </section>
    </>
  )
}

export default PeriodSummarySection
