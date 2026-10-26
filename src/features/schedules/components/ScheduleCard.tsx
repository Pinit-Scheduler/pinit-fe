import type { ScheduleSummary } from '../types/schedule'
import './ScheduleCard.css'
import { scheduleTypeLabel, stateIcon, stateLabel } from '@constants/schedules'
import { formatIsoDurationLabel } from '@shared/utils/isoDuration'

type ScheduleCardProps = {
  schedule: ScheduleSummary
  onOpenDetail: (scheduleId: number) => void
  onDelete: (scheduleId: number) => void
  onStart: (scheduleId: number) => void
  onComplete: (scheduleId: number) => void
  onCancel: (scheduleId: number) => void
}

/**
 * 일정 카드 컴포넌트
 * @param schedule - 일정 요약 정보
 * @param onOpenDetail - 상세 보기 핸들러
 * @param onDelete - 삭제 핸들러
 * @param onStart - 시작 핸들러
 * @param onCancel - 취소 핸들러
 * @constructor
 */
const ScheduleCard = ({
  schedule,
  onOpenDetail,
  onDelete,
  onStart,
  onComplete,
  onCancel,
}: ScheduleCardProps) => {
  const { id, title, description, scheduleType, state } = schedule
  const plannedDurationLabel = formatIsoDurationLabel(schedule.plannedDuration)

  const handleClick = () => {
    onOpenDetail(id)
  }

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation() // 카드 클릭 이벤트 방지
    if (window.confirm(`"${title}" 일정을 삭제하시겠습니까?`)) {
      onDelete(id)
    }
  }

  const handleStateIconClick = (e: React.MouseEvent) => {
    e.stopPropagation() // 카드 클릭 이벤트 방지

    if (state === 'NOT_STARTED') {
      // 미시작 → 시작
      onStart(id)
    } else if (state === 'COMPLETED') {
      // 완료 → 즉시 미시작으로 전이
      onCancel(id)
    }
  }

  const isStateClickable = state === 'NOT_STARTED' || state === 'COMPLETED'
  const stateClassName = `schedule-card__state-icon--${state.toLowerCase()}`

  const handleQuickComplete = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (state === 'COMPLETED') return
    onComplete(id)
  }

  return (
    <article
      className="schedule-card"
      aria-label={title}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          handleClick()
        }
      }}
    >
      <div className="schedule-card__main">
        <button
          className={[
            'schedule-card__state-icon',
            stateClassName,
            isStateClickable ? 'schedule-card__state-icon--clickable' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          onClick={handleStateIconClick}
          disabled={!isStateClickable}
          title={stateLabel[state]}
          aria-label={`${stateLabel[state]} 상태`}
        >
          {stateIcon[state]}
        </button>
        <div className="schedule-card__text">
          <div className="schedule-card__title-row">
            <p className="schedule-card__title">{title}</p>
            {scheduleType && <p className="schedule-card__subtitle">{scheduleTypeLabel[scheduleType]}</p>}
            {plannedDurationLabel && <p className="schedule-card__subtitle">{plannedDurationLabel}</p>}
          </div>
          {description && <p className="schedule-card__description">{description}</p>}
        </div>
        <div className="schedule-card__actions">
          {state === 'NOT_STARTED' && (
            <button
              type="button"
              className="schedule-card__quick-complete"
              onClick={handleQuickComplete}
              aria-label="즉시 완료"
            >
              ✓ 즉시 완료
            </button>
          )}
          <button
            className="schedule-card__delete-btn"
            onClick={handleDeleteClick}
            title="삭제"
            aria-label="일정 삭제"
          >
            🗑️
          </button>
        </div>
      </div>
    </article>
  )
}

export default ScheduleCard
