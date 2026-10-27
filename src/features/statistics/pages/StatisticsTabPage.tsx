import { useEffect, useMemo, useState } from 'react'
import useWeeklyStatistics from '../hooks/useWeeklyStatistics.ts'
import StatisticCard from '../components/StatisticCard.tsx'
import DonutChart from '../components/DonutChart.tsx'
import WeeklyBarChart from '../components/WeeklyBarChart.tsx'
import TrendSection from '../components/TrendSection.tsx'
import PeriodSummarySection from '../components/PeriodSummarySection.tsx'
import RecurrenceStatsSection from '../components/RecurrenceStatsSection.tsx'
import StatusPanel from '@shared/components/common/StatusPanel'
import './StatisticsTabPage.css'
import { formatMinutesToTime } from '@shared/utils/statisticsTransform'
import { getTodayWithOffset } from '@shared/utils/datetime'
import { useToast } from '@contexts/ToastContext'
import { useTimePreferences } from '@contexts/TimePreferencesContext'
import { WeeklyReviewSection } from '@features/calibration'
import { weekStartOf } from '@features/calibration/utils/calibrationView'
import { monthLabel, monthStartOf, shiftMonth } from '../utils/reportView'

type View = 'week' | 'month' | 'recurrence'

const VIEWS: { key: View; label: string }[] = [
  { key: 'week', label: '주간' },
  { key: 'month', label: '월간' },
  { key: 'recurrence', label: '반복' },
]

const describeChange = (currentValue: number, previousValue?: number | null) => {
  if (previousValue === undefined || previousValue === null) return { text: '지난 주 데이터 없음', tone: 'neutral' as const }
  if (previousValue === 0) {
    if (currentValue === 0) return { text: '지난 주 대비 0%', tone: 'neutral' as const }
    return { text: '지난 주 대비 +100% (신규)', tone: 'positive' as const }
  }
  const diff = currentValue - previousValue
  const percent = Math.round((diff / previousValue) * 100)
  if (percent === 0) return { text: '지난 주 대비 변동 없음', tone: 'neutral' as const }
  return {
    text: `지난 주 대비 ${percent > 0 ? '+' : ''}${percent}%`,
    tone: percent > 0 ? ('positive' as const) : ('negative' as const),
  }
}

const WeeklyStatisticsView = () => {
  const { offsetMinutes } = useTimePreferences()
  const today = useMemo(() => {
    return getTodayWithOffset(offsetMinutes)
  }, [offsetMinutes])
  const [anchorOffsetDays, setAnchorOffsetDays] = useState(0)
  const anchorDay = useMemo(() => today.add(anchorOffsetDays, 'day'), [anchorOffsetDays, today])
  const { current: stats, previous, isLoading, error, refetch } = useWeeklyStatistics({ weekStart: anchorDay })
  const { addToast } = useToast()
  const reviewWeekStart = useMemo(() => weekStartOf(anchorDay.format('YYYY-MM-DD')), [anchorDay])

  useEffect(() => {
    if (error) {
      addToast(error, 'error')
    }
  }, [error, addToast])

  const goPrevWeek = () => setAnchorOffsetDays((prev) => prev - 7)
  const goNextWeek = () => setAnchorOffsetDays((prev) => Math.min(prev + 7, 0))
  const isNextDisabled = anchorOffsetDays === 0

  if (isLoading) {
    return <StatusPanel variant="loading" title="통계를 불러오는 중" />
  }

  if (error || !stats) {
    return (
      <StatusPanel
        variant="error"
        title="통계를 불러오는데 실패했어요"
        description={error ?? '다시 시도해 주세요.'}
        action={<button onClick={refetch}>재시도</button>}
      />
    )
  }

  const {
    weekStartLabel,
    deepWorkMinutes,
    adminWorkMinutes,
    quickWorkMinutes,
    totalMinutes,
    deepWorkRatio,
    adminWorkRatio,
  } = stats

  const deepChange = describeChange(deepWorkMinutes, previous?.deepWorkMinutes)
  const adminChange = describeChange(adminWorkMinutes, previous?.adminWorkMinutes)
  const quickChange = describeChange(quickWorkMinutes, previous?.quickWorkMinutes)
  const totalChange = describeChange(totalMinutes, previous?.totalMinutes)

  return (
    <>
      <header className="statistics-tab__header">
        <h1>이번 주 통계</h1>
        <p>{weekStartLabel}</p>
        <div className="statistics-tab__controls">
          <div className="statistics-tab__week-controls">
            <button type="button" onClick={goPrevWeek} aria-label="지난 주로 이동">
              ← 지난 주
            </button>
            <button type="button" onClick={goNextWeek} disabled={isNextDisabled} aria-label="다음 주로 이동">
              다음 주 →
            </button>
          </div>
          <button type="button" onClick={refetch}>새로고침</button>
        </div>
      </header>
      <div className="statistics-tab__cards stats-transition" key={weekStartLabel} data-onboarding-anchor="statistics.cards">
        <StatisticCard
          label="집중 작업"
          value={formatMinutesToTime(deepWorkMinutes)}
          description={deepChange.text}
          tone={deepChange.tone}
        />
        <StatisticCard
          label="행정 작업"
          value={formatMinutesToTime(adminWorkMinutes)}
          description={adminChange.text}
          tone={adminChange.tone}
        />
        <StatisticCard
          label="빠른 작업"
          value={formatMinutesToTime(quickWorkMinutes)}
          description={quickChange.text}
          tone={quickChange.tone}
        />
        <StatisticCard
          label="총 작업 시간"
          value={formatMinutesToTime(totalMinutes)}
          description={totalChange.text}
          tone={totalChange.tone}
        />
      </div>
      <DonutChart deepWorkRatio={deepWorkRatio} adminWorkRatio={adminWorkRatio} />
      <WeeklyBarChart
        deepWorkMinutes={deepWorkMinutes}
        adminWorkMinutes={adminWorkMinutes}
        quickWorkMinutes={quickWorkMinutes}
        totalMinutes={totalMinutes}
      />
      {reviewWeekStart && <TrendSection unit="WEEK" end={reviewWeekStart} />}
      {reviewWeekStart && <WeeklyReviewSection weekStart={reviewWeekStart} />}
    </>
  )
}

const MonthlyStatisticsView = () => {
  const { offsetMinutes } = useTimePreferences()
  const currentMonth = useMemo(
    () => monthStartOf(getTodayWithOffset(offsetMinutes).format('YYYY-MM-DD')),
    [offsetMinutes],
  )
  const [monthOffset, setMonthOffset] = useState(0)
  const month = shiftMonth(currentMonth, monthOffset)

  return (
    <>
      <header className="statistics-tab__header">
        <h1>{monthOffset === 0 ? '이번 달 통계' : '월간 통계'}</h1>
        <p>{monthLabel(month)}</p>
        <div className="statistics-tab__controls">
          <div className="statistics-tab__week-controls">
            <button type="button" onClick={() => setMonthOffset((prev) => prev - 1)} aria-label="지난 달로 이동">
              ← 지난 달
            </button>
            <button
              type="button"
              onClick={() => setMonthOffset((prev) => Math.min(prev + 1, 0))}
              disabled={monthOffset === 0}
              aria-label="다음 달로 이동"
            >
              다음 달 →
            </button>
          </div>
        </div>
      </header>
      <PeriodSummarySection unit="MONTH" start={month} />
      <TrendSection unit="MONTH" end={month} />
    </>
  )
}

const StatisticsTabPage = () => {
  const [view, setView] = useState<View>('week')

  return (
    <section className="statistics-tab">
      <div className="statistics-tab__views" role="group" aria-label="통계 보기">
        {VIEWS.map((item) => (
          <button key={item.key} type="button" aria-pressed={view === item.key} onClick={() => setView(item.key)}>
            {item.label}
          </button>
        ))}
      </div>
      {view === 'week' && <WeeklyStatisticsView />}
      {view === 'month' && <MonthlyStatisticsView />}
      {view === 'recurrence' && (
        <>
          <header className="statistics-tab__header">
            <h1>반복 통계</h1>
            <p>진행 중인 반복을 얼마나 꾸준히 했는지 보여 줘요.</p>
          </header>
          <RecurrenceStatsSection />
        </>
      )}
    </section>
  )
}

export default StatisticsTabPage
