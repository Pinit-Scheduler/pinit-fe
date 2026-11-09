import './DonutChart.css'
import TweenedNumber from './TweenedNumber'
import { donutOffsets } from '../utils/chartMotion'
import { useChangeFade } from '../hooks/useReportMotion'

type DonutChartProps = {
  deepWorkRatio: number
  adminWorkRatio: number
  totalMinutes?: number
}

const percent = (value: number) => `${Math.round(value)}%`

// 고리 반지름 71(뷰박스 160, 두께 18)의 둘레. 선 길이를 실제 길이로 맞춰 브라우저마다 같게 그린다.
const RADIUS = 71
const CIRCUMFERENCE = 2 * Math.PI * RADIUS
const dash = (offsetPercent: number) => ({
  strokeDasharray: `${CIRCUMFERENCE} ${CIRCUMFERENCE}`,
  strokeDashoffset: (offsetPercent / 100) * CIRCUMFERENCE,
})

/**
 * 도넛 차트 컴포넌트. 고리는 stroke-dashoffset으로 이전 비율에서 새 비율로 이어진다.
 * @param deepWorkRatio - 집중 작업 비율
 * @param adminWorkRatio - 행정 작업 비율
 * @constructor
 */
const DonutChart = ({
  deepWorkRatio,
  adminWorkRatio,
  totalMinutes,
}: DonutChartProps) => {
  const deepPercentage = Math.round(deepWorkRatio * 100)
  const adminPercentage = Math.round(adminWorkRatio * 100)
  const other = Math.max(0, 100 - deepPercentage - adminPercentage)
  const empty = totalMinutes === 0
  const ref = useChangeFade<HTMLElement>(empty)
  const offsets = donutOffsets(deepPercentage, adminPercentage)

  return (
    <section className="donut-chart" ref={ref}>
      {empty ? (
        <p className="report-datum">이 기간에 완료한 일정의 실행 기록이 없어요.</p>
      ) : (
        <>
          <div className="donut-chart__circle" aria-hidden>
            <svg className="donut-chart__ring" viewBox="0 0 160 160" focusable="false">
              <circle className="donut-chart__track" cx="80" cy="80" r={RADIUS} />
              <circle
                className="donut-chart__arc donut-chart__arc--allocated"
                cx="80"
                cy="80"
                r={RADIUS}
                style={dash(offsets.allocated)}
              />
              <circle
                className="donut-chart__arc donut-chart__arc--deep"
                cx="80"
                cy="80"
                r={RADIUS}
                style={dash(offsets.deep)}
              />
            </svg>
            <div className="donut-chart__label report-datum">
              <strong>
                <TweenedNumber value={deepPercentage + adminPercentage} format={percent} />
              </strong>
              <span>배분됨</span>
            </div>
          </div>
          <div className="donut-chart__legend report-datum">
            <p>
              <i className="donut-chart__key donut-chart__key--deep" aria-hidden />
              집중 작업 <TweenedNumber value={deepPercentage} format={percent} />
            </p>
            <p>
              <i className="donut-chart__key donut-chart__key--admin" aria-hidden />
              행정 작업 <TweenedNumber value={adminPercentage} format={percent} />
            </p>
            <p>
              <i className="donut-chart__key" aria-hidden />
              기타 <TweenedNumber value={other} format={percent} />
            </p>
          </div>
        </>
      )}
    </section>
  )
}

export default DonutChart
