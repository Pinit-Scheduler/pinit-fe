import type { ScheduleSummary } from '../../types/schedule'
import './ScheduleCard.css'

type ScheduleCardProps = {
  schedule: ScheduleSummary
  onOpenDetail: (scheduleId: number) => void
  onDelete: (scheduleId: number) => void
}

const taskTypeLabel: Record<NonNullable<ScheduleSummary['taskType']>, string> = {
  DEEP_WORK: '집중 작업',
  QUICK_TASK: '빠른 일정',
  ADMIN_TASK: '행정 작업',
}

const stateLabel: Record<ScheduleSummary['state'], string> = {
  NOT_STARTED: '미시작',
  IN_PROGRESS: '진행중',
  COMPLETED: '완료',
  SUSPENDED: '일시정지',
}

const ScheduleCard = ({ schedule, onOpenDetail, onDelete }: ScheduleCardProps) => {
  const { id, title, description, importance, urgency, taskType, state } = schedule

  const handleClick = () => {
    onOpenDetail(id)
  }

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation() // 카드 클릭 이벤트 방지
    if (window.confirm(`"${title}" 일정을 삭제하시겠습니까?`)) {
      onDelete(id)
    }
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
      <header className="schedule-card__header">
        <div>
          <p className="schedule-card__title">{title}</p>
          {taskType && <p className="schedule-card__subtitle">{taskTypeLabel[taskType]}</p>}
        </div>
        <div className="schedule-card__header-actions">
          <span className={`schedule-card__state schedule-card__state--${state.toLowerCase()}`}>
            {stateLabel[state]}
          </span>
          <button
            className="schedule-card__delete-btn"
            onClick={handleDeleteClick}
            title="삭제"
            aria-label="일정 삭제"
          >
            🗑️
          </button>
        </div>
      </header>
      <p className="schedule-card__description">{description}</p>
      <footer className="schedule-card__footer">
        <div className="schedule-card__meta">
          <span className="schedule-card__pill">중요도 {importance}</span>
          <span className="schedule-card__pill">긴급도 {urgency}</span>
        </div>
      </footer>
    </article>
  )
}

export default ScheduleCard

