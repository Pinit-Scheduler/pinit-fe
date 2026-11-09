import WorkspaceIcon from '@shared/components/common/WorkspaceIcon'
import type { ScheduleSummary } from '../types/schedule'
import './ScheduleCard.css'
import './ScheduleState.css'
import { scheduleTypeLabel, stateIcon, stateLabel } from '@constants/schedules'
import { formatIsoDurationLabel } from '@shared/utils/isoDuration'
import '@features/recurrence/components/RecurrenceRuleFields.css'
import useScheduleActions from '../hooks/useScheduleActions'
import { CategoryBadge } from '@features/categories'

type ScheduleCardProps = {
  schedule: ScheduleSummary
  onOpenDetail: (scheduleId: number) => void
  onDelete?: (scheduleId: number) => void
  onStart?: (scheduleId: number) => void
  onComplete?: (scheduleId: number) => void
  onCancel?: (scheduleId: number) => void
  /** 팀 전체 보기에서만 넘긴다. 담당자 이름 또는 담당자 미정을 일정 제목 뒤(반복 배지 다음)에 보여 준다. */
  assignee?: { label: string; unassigned: boolean } | null
}

/**
 * 일정 카드 컴포넌트
 * @param schedule - 일정 요약 정보
 * @param onOpenDetail - 상세 보기 핸들러
 * @param onDelete - 삭제 핸들러
 * @param onStart - 시작 핸들러
 * @param onCancel - 취소 핸들러
 * @param assignee - 팀 전체 보기의 담당자 표시
 * @constructor
 */
const ScheduleCard = ({
  schedule,
  onOpenDetail,
  onDelete,
  assignee,
}: ScheduleCardProps) => {
  const actions = useScheduleActions(schedule.id, schedule.state)
  const { id, title, description, scheduleType, state } = schedule
  const plannedDurationLabel = formatIsoDurationLabel(schedule.plannedDuration)

  const handleClick = () => {
    onOpenDetail(id)
  }

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation() // 카드 클릭 이벤트 방지
    // 반복 회차는 화면이 범위(이번만·이번 및 이후·전체)를 묻는다.
    if (
      schedule.recurrence ||
      window.confirm(
        `"${title}" 일정을 휴지통으로 옮길까요?\n30일 안에 되돌릴 수 있어요.`,
      )
    ) {
      onDelete?.(id)
    }
  }

  const handleStateIconClick = (e: React.MouseEvent) => {
    e.stopPropagation() // 카드 클릭 이벤트 방지

    if (state === 'NOT_STARTED') {
      // 미시작 → 시작
      void actions.start()
    } else if (state === 'COMPLETED') {
      // 완료 → 즉시 미시작으로 전이
      void actions.cancel()
    }
  }

  const isStateClickable = state === 'NOT_STARTED' || state === 'COMPLETED'
  const stateClassName = `schedule-card__state-icon--${state.toLowerCase()}`

  const handleQuickComplete = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (state === 'COMPLETED') return
    void actions.complete()
  }

  return (
    <article
      className={`schedule-card schedule-state--${state.toLowerCase()}`}
      aria-label={title}
      onClick={handleClick}
      aria-busy={actions.isMutating}
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
          disabled={!isStateClickable || actions.isMutating}
          title={stateLabel[state]}
          aria-label={`${stateLabel[state]} 상태`}
        >
          <WorkspaceIcon name={stateIcon[state]} />
        </button>
        <div className="schedule-card__text">
          <span className="schedule-card__status">{stateLabel[state]}</span>
          <div className="schedule-card__title-row">
            <button
              type="button"
              className="schedule-card__title"
              onClick={(event) => {
                event.stopPropagation()
                handleClick()
              }}
            >
              {title}
            </button>
            {schedule.recurrence && (
              <span
                className="recurrence-badge"
                title="반복 일정"
                aria-label="반복 일정"
              >
                <WorkspaceIcon name="repeat" /> 반복
              </span>
            )}
            {assignee && (
              <p
                className={[
                  'schedule-card__subtitle',
                  'schedule-card__assignee',
                  assignee.unassigned
                    ? 'schedule-card__assignee--unassigned'
                    : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                {assignee.label}
              </p>
            )}
            {scheduleType && (
              <p className="schedule-card__subtitle">
                {scheduleTypeLabel[scheduleType]}
              </p>
            )}
            {plannedDurationLabel && (
              <p className="schedule-card__subtitle">{plannedDurationLabel}</p>
            )}
            <CategoryBadge kind="schedule" itemId={id} />
          </div>
          {description && (
            <p className="schedule-card__description">{description}</p>
          )}
        </div>
        <div className="schedule-card__actions">
          {actions.canComplete && state === 'NOT_STARTED' && (
            <button
              type="button"
              className="schedule-card__quick-complete"
              onClick={handleQuickComplete}
              aria-label="즉시 완료"
              disabled={actions.isMutating}
            >
              <WorkspaceIcon name="check" /> 즉시 완료
            </button>
          )}
          {onDelete && schedule.allowedActions?.delete && (
            <button
              className="schedule-card__delete-btn"
              onClick={handleDeleteClick}
              title="삭제"
              aria-label="일정 삭제"
              disabled={actions.isMutating}
            >
              <WorkspaceIcon name="trash" />
            </button>
          )}
        </div>
      </div>
      {actions.lastError && (
        <div
          className="schedule-card__error"
          role="alert"
          onClick={(event) => event.stopPropagation()}
        >
          <span>{actions.lastError}</span>
          <button
            type="button"
            onClick={actions.retry}
            disabled={actions.isMutating}
          >
            다시 시도
          </button>
        </div>
      )}
    </article>
  )
}

export default ScheduleCard
