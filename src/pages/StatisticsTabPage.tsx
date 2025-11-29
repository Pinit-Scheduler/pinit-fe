import useWeeklyStatistics from '../hooks/useWeeklyStatistics'
import StatisticCard from '../components/statistics/StatisticCard'
import DonutChart from '../components/statistics/DonutChart'
import WeeklyBarChart from '../components/statistics/WeeklyBarChart'
import StatusPanel from '../components/common/StatusPanel'
import './StatisticsTabPage.css'

const formatMinutesToTime = (totalMinutes: number): string => {
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60

  if (hours === 0) {
    return `${minutes}분`
  }

  if (minutes === 0) {
    return `${hours}시간`
  }

  return `${hours}시간 ${minutes}분`
}

const StatisticsTabPage = () => {
  const { stats, isLoading, error, refetch } = useWeeklyStatistics()

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

  const { weekStartLabel, deepWorkMinutes, adminWorkMinutes, totalMinutes, deepWorkRatio, adminWorkRatio } = stats

  return (
    <section className="statistics-tab">
      <header className="statistics-tab__header">
        <h1>이번 주 통계</h1>
        <p>{weekStartLabel}</p>
        <button type="button" onClick={refetch}>새로고침</button>
      </header>
      <div className="statistics-tab__cards">
        <StatisticCard label="집중 작업" value={formatMinutesToTime(deepWorkMinutes)} description="딥워크" />
        <StatisticCard label="행정 작업" value={formatMinutesToTime(adminWorkMinutes)} description="행정 업무" />
        <StatisticCard label="총 작업 시간" value={formatMinutesToTime(totalMinutes)} />
      </div>
      <DonutChart deepWorkRatio={deepWorkRatio} adminWorkRatio={adminWorkRatio} />
      <WeeklyBarChart deepWorkMinutes={deepWorkMinutes} adminWorkMinutes={adminWorkMinutes} totalMinutes={totalMinutes} />
    </section>
  )
}

export default StatisticsTabPage
