import './WeeklyBarChart.css'

type WeeklyBarChartProps = {
  deepWorkMinutes: number
  adminWorkMinutes: number
  quickWorkMinutes: number
  totalMinutes: number
}

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

/**
 * 주간 작업 시간을 막대 그래프로 나타내는 컴포넌트
 * @param deepWorkMinutes - 집중 작업 시간 (분)
 * @param adminWorkMinutes - 행정 작업 시간 (분)
 * @param totalMinutes - 총 작업 시간 (분)
 * @constructor
 */
const WeeklyBarChart = ({
  deepWorkMinutes,
  adminWorkMinutes,
  quickWorkMinutes,
  totalMinutes,
}: WeeklyBarChartProps) => {
  const deepRatio = totalMinutes ? deepWorkMinutes / totalMinutes : 0
  const adminRatio = totalMinutes ? adminWorkMinutes / totalMinutes : 0
  const quickRatio = totalMinutes ? quickWorkMinutes / totalMinutes : 0

  return (
    <section className="weekly-bar">
      <div className="weekly-bar__bar" aria-hidden>
        <span style={{ flexGrow: deepRatio }} className="weekly-bar__segment weekly-bar__segment--deep" />
        <span style={{ flexGrow: adminRatio }} className="weekly-bar__segment weekly-bar__segment--admin" />
        <span style={{ flexGrow: quickRatio }} className="weekly-bar__segment weekly-bar__segment--quick" />
      </div>
      <div className="weekly-bar__legend">
        <p>집중 작업 {formatMinutesToTime(deepWorkMinutes)}</p>
        <p>행정 작업 {formatMinutesToTime(adminWorkMinutes)}</p>
        <p>빠른/기타 작업 {formatMinutesToTime(quickWorkMinutes)}</p>
        <p>총 {formatMinutesToTime(totalMinutes)}</p>
      </div>
    </section>
  )
}

export default WeeklyBarChart
