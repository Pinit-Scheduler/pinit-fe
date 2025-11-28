import type { ScheduleSummary } from '../../types/schedule'
import './ScheduleCard.css'

type ScheduleCardProps = {
  schedule: ScheduleSummary
}

const taskTypeLabel: Record<ScheduleSummary['taskType'], string> = {
  DEEP_WORK: '집중 작업',
  QUICK_TASK: '빠른 일정',
  ADMIN_TASK: '행정 작업',
}

const ScheduleCard = ({ schedule }: ScheduleCardProps) => {
  const { title, description, importance, urgency, taskType, state } = schedule

  return (
    <article className="schedule-card" aria-label={title}>
      <header className="schedule-card__header">
        <div>
          <p className="schedule-card__title">{title}</p>
          <p className="schedule-card__subtitle">{taskTypeLabel[taskType]}</p>
        </div>
        <span className={`schedule-card__state schedule-card__state--${state.toLowerCase()}`}>
          {state}
        </span>
      </header>
      <p className="schedule-card__description">{description}</p>
      <footer className="schedule-card__footer">
        <span className="schedule-card__pill">중요도 {importance}</span>
        <span className="schedule-card__pill">긴급도 {urgency}</span>
      </footer>
    </article>
  )
}

export default ScheduleCard

