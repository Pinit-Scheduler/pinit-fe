import type { ReactNode } from 'react'
import './StatisticCard.css'

type StatisticCardProps = {
  label: string
  value: ReactNode
  description?: string
  tone?: 'positive' | 'negative' | 'neutral'
}

/**
 * 통계 카드 컴포넌트
 * @param label - 통계의 항목 이름 (예: "집중 작업", "행정 작업", "총 작업 시간")
 * @param value - 통계의 값 (예: "10시간 30분", "5시간 15분"). 바뀌는 숫자는 TweenedNumber로 넘긴다
 * @param description - 추가 설명 (예: "딥워크", "행정 업무")
 * @constructor
 */
const StatisticCard = ({ label, value, description, tone = 'neutral' }: StatisticCardProps) => {
  return (
    <article className={['stat-card', `stat-card--${tone}`].join(' ')}>
      <p className="stat-card__label">{label}</p>
      <p className="stat-card__value report-datum">{value}</p>
      {description && <p className="stat-card__description report-datum">{description}</p>}
    </article>
  )
}

export default StatisticCard
