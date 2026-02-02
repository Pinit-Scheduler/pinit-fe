import './DonutChart.css'
import type { CSSProperties } from 'react'

type DonutChartProps = {
  deepWorkRatio: number
  adminWorkRatio: number
}

/**
 * 도넛 차트 컴포넌트
 * @param deepWorkRatio - 집중 작업 비율
 * @param adminWorkRatio - 행정 작업 비율
 * @constructor
 */
const DonutChart = ({ deepWorkRatio, adminWorkRatio }: DonutChartProps) => {
  const deepPercentage = Math.round(deepWorkRatio * 100)
  const adminPercentage = Math.round(adminWorkRatio * 100)
  const other = Math.max(0, 100 - deepPercentage - adminPercentage)

  return (
    <section className="donut-chart">
      <div
        className="donut-chart__circle"
        aria-hidden
        style={{
          ...( {
            '--deep': `${deepPercentage}%`,
            '--admin': `${deepPercentage + adminPercentage}%`,
            '--other': '100%',
          } as CSSProperties ),
        }}
      >
        <div className="donut-chart__label">
          <strong>{deepPercentage + adminPercentage}%</strong>
          <span>배분됨</span>
        </div>
      </div>
      <div className="donut-chart__legend">
        <p>집중 작업 {deepPercentage}%</p>
        <p>행정 작업 {adminPercentage}%</p>
        <p>기타 {other}%</p>
      </div>
    </section>
  )
}

export default DonutChart
