import { useMemo, useState } from 'react'
import TrendSection from '../components/TrendSection.tsx'
import PeriodSummarySection from '../components/PeriodSummarySection.tsx'
import PlanComparisonSection from '../components/PlanComparisonSection'
import RecurrenceStatsSection from '../components/RecurrenceStatsSection.tsx'
import './StatisticsTabPage.css'
import { getTodayWithOffset } from '@shared/utils/datetime'
import { useTimePreferences } from '@contexts/TimePreferencesContext'
import useCurrentDay from '@shared/hooks/useCurrentDay'
import { WeeklyReviewSection } from '@features/calibration'
import { weekStartOf } from '@features/calibration/utils/calibrationView'
import { monthLabel, monthStartOf, shiftMonth } from '../utils/reportView'

const SCOPE_NOTE =
  '모든 스페이스에서 내 기록이에요. 팀 기록은 스페이스에서 볼 수 있어요.'

type View = 'week' | 'month' | 'recurrence'

const VIEWS: { key: View; label: string }[] = [
  { key: 'week', label: '주간' },
  { key: 'month', label: '월간' },
  { key: 'recurrence', label: '반복' },
]

const WeeklyStatisticsView = () => {
  const today = useCurrentDay()
  const [offset, setOffset] = useState(0)
  const start = weekStartOf(today.add(offset, 'week').format('YYYY-MM-DD'))!
  return (
    <>
      <header className="statistics-tab__header">
        <h1>{offset === 0 ? '이번 주 통계' : '주간 통계'}</h1>
        <p>{SCOPE_NOTE}</p>
        <p>{start}부터 7일 · 회원 시간대 기준</p>
        <div className="statistics-tab__controls">
          <button
            type="button"
            onClick={() => setOffset((n) => n - 1)}
            aria-label="지난 주로 이동"
          >
            ← 지난 주
          </button>
          <button
            type="button"
            disabled={offset === 0}
            onClick={() => setOffset((n) => Math.min(0, n + 1))}
            aria-label="다음 주로 이동"
          >
            다음 주 →
          </button>
        </div>
      </header>
      <div data-onboarding-anchor="statistics.cards">
        <PeriodSummarySection unit="WEEK" start={start} />
      </div>
      <PlanComparisonSection unit="WEEK" start={start} />
      <TrendSection unit="WEEK" end={start} />
      <WeeklyReviewSection weekStart={start} />
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
        <p>{SCOPE_NOTE}</p>
        <p>{monthLabel(month)}</p>
        <div className="statistics-tab__controls">
          <div className="statistics-tab__week-controls">
            <button
              type="button"
              onClick={() => setMonthOffset((prev) => prev - 1)}
              aria-label="지난 달로 이동"
            >
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
      <PlanComparisonSection unit="MONTH" start={month} />
      <TrendSection unit="MONTH" end={month} />
    </>
  )
}

const StatisticsTabPage = () => {
  const [view, setView] = useState<View>('week')

  return (
    <section className="statistics-tab">
      <div
        className="statistics-tab__views"
        role="group"
        aria-label="통계 보기"
      >
        {VIEWS.map((item) => (
          <button
            key={item.key}
            type="button"
            aria-pressed={view === item.key}
            onClick={() => setView(item.key)}
          >
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
            <p>{SCOPE_NOTE}</p>
            <p>진행 중인 반복을 얼마나 꾸준히 했는지 보여 줘요.</p>
          </header>
          <RecurrenceStatsSection />
        </>
      )}
    </section>
  )
}

export default StatisticsTabPage
