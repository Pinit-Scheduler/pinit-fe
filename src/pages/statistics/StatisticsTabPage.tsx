import { useMemo, useState } from 'react'
import useWeeklyStatistics from '../../hooks/useWeeklyStatistics.ts'
import StatisticCard from '../../components/statistics/StatisticCard.tsx'
import DonutChart from '../../components/statistics/DonutChart.tsx'
import WeeklyBarChart from '../../components/statistics/WeeklyBarChart.tsx'
import StatusPanel from '../../components/common/StatusPanel.tsx'
import './StatisticsTabPage.css'
import { formatMinutesToTime } from '../../utils/statisticsTransform.ts'
import { getTodayKST } from '../../utils/datetime.ts'

const StatisticsTabPage = () => {
  const today = useMemo(() => getTodayKST(), [])
  const [anchorDay, setAnchorDay] = useState(today)
  const { current: stats, previous, isLoading, error, refetch } = useWeeklyStatistics({ weekStart: anchorDay })

  const goPrevWeek = () => setAnchorDay((prev) => prev.subtract(7, 'day'))
  const goNextWeek = () => {
    setAnchorDay((prev) => {
      const next = prev.add(7, 'day')
      return next.isAfter(today, 'day') ? prev : next
    })
  }
  const isNextDisabled = anchorDay.isSame(today, 'day') || anchorDay.isAfter(today, 'day')

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
    totalMinutes,
    deepWorkRatio,
    adminWorkRatio,
  } = stats

  const deepChange = describeChange(deepWorkMinutes, previous?.deepWorkMinutes)
  const adminChange = describeChange(adminWorkMinutes, previous?.adminWorkMinutes)
  const totalChange = describeChange(totalMinutes, previous?.totalMinutes)

  return (
    <section className="statistics-tab">
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
      <div className="statistics-tab__cards stats-transition" key={weekStartLabel}>
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
          label="총 작업 시간"
          value={formatMinutesToTime(totalMinutes)}
          description={totalChange.text}
          tone={totalChange.tone}
        />
      </div>
      <DonutChart deepWorkRatio={deepWorkRatio} adminWorkRatio={adminWorkRatio} />
      <WeeklyBarChart deepWorkMinutes={deepWorkMinutes} adminWorkMinutes={adminWorkMinutes} totalMinutes={totalMinutes} />
    </section>
  )
}

export default StatisticsTabPage
