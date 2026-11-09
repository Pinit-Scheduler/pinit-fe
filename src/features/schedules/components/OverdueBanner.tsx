import WorkspaceIcon from '@shared/components/common/WorkspaceIcon'
import type { OverdueSummary } from '../types/schedule'
import './OverdueBanner.css'
import { useTweenedNumber } from '@shared/motion'

type OverdueBannerProps = {
  summary: OverdueSummary
  onNavigateToDate: (dateKey: string) => void
}

/**
 * 미완료 일정 배너 컴포넌트
 * @param summary - 미완료 일정 요약 정보
 * @param onNavigateToDate - 날짜로 이동 핸들러
 * @constructor
 */
const OverdueBanner = ({ summary, onNavigateToDate }: OverdueBannerProps) => {
  // Completing an overdue schedule counts the number down instead of swapping it.
  const shownCount = Math.round(useTweenedNumber(summary.count ?? 0))
  if (!summary.hasOverdue) return null

  const { count, earliestDate } = summary
  const message = count
    ? `이전 날짜에 아직 완료되지 않은 일정이 ${shownCount}개 있어요.`
    : '이전 날짜에 아직 완료되지 않은 일정이 있어요.'

  const handleClick = () => {
    if (earliestDate) {
      onNavigateToDate(earliestDate)
    }
  }

  return (
    <button type="button" className="overdue-banner" onClick={handleClick}>
      <span className="overdue-banner__icon" aria-hidden>
        <WorkspaceIcon name="warning" />
      </span>
      <span className="overdue-banner__text">{message}</span>
    </button>
  )
}

export default OverdueBanner
