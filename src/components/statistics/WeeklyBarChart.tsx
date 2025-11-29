import './WeeklyBarChart.css'

type WeeklyBarChartProps = {
  deepWorkMinutes: number
  adminWorkMinutes: number
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

const WeeklyBarChart = ({ deepWorkMinutes, adminWorkMinutes, totalMinutes }: WeeklyBarChartProps) => {
  const deepRatio = totalMinutes ? deepWorkMinutes / totalMinutes : 0
  const adminRatio = totalMinutes ? adminWorkMinutes / totalMinutes : 0

  return (
    <section className="weekly-bar">
      <div className="weekly-bar__bar" aria-hidden>
        <span style={{ flexGrow: deepRatio }} className="weekly-bar__segment weekly-bar__segment--deep" />
        <span style={{ flexGrow: adminRatio }} className="weekly-bar__segment weekly-bar__segment--admin" />
      </div>
      <div className="weekly-bar__legend">
        <p>집중 작업 {formatMinutesToTime(deepWorkMinutes)}</p>
        <p>행정 작업 {formatMinutesToTime(adminWorkMinutes)}</p>
        <p>총 {formatMinutesToTime(totalMinutes)}</p>
      </div>
    </section>
  )
}

export default WeeklyBarChart

