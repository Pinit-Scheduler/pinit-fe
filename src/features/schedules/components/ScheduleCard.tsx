import WorkspaceIcon from '@shared/components/common/WorkspaceIcon'
import type { ScheduleSummary } from '../types/schedule'
import './ScheduleCard.css'
import './ScheduleState.css'
import { scheduleTypeLabel, stateIcon, stateLabel } from '@constants/schedules'
import { formatIsoDurationLabel } from '@shared/utils/isoDuration'
import '@features/recurrence/components/RecurrenceRuleFields.css'
import useScheduleActions from '../hooks/useScheduleActions'
import ScheduleCompletionMark from './ScheduleCompletionMark'
import { useState } from 'react'
import type { MouseEvent } from 'react'
import { useLocation } from 'react-router-dom'
import { useScheduleCache } from '@contexts/ScheduleCacheContext'
import { usePresence, MOTION_FAST_MS } from '@shared/motion'
import { cardPath } from '@features/spaces/cardPath'
import SpacePath from '@features/spaces/SpacePath'
import { routeScope } from '@features/spaces/scope'
import { useSpaces } from '@features/spaces/store'

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
  const { schedulesById } = useScheduleCache()
  const { id, title, description, scheduleType } = schedule
  // The state comes from the actions, which merge the cache and the change being saved, so the
  // card answers a click at once instead of waiting for the list to refetch.
  const state = actions.currentState
  const allowedActions = (schedulesById[id] ?? schedule).allowedActions
  const { pathname } = useLocation()
  const { selectedSpaceId, selectedProjectId, spaces, projects } = useSpaces()
  const plannedDurationLabel = formatIsoDurationLabel(schedule.plannedDuration)
  const done = state === 'COMPLETED'

  // Motion bookkeeping, adjusted during render. A card that mounts in a state shows it still;
  // only a change made while the card is on screen animates.
  const [initialState] = useState(state)
  const [hasChanged, setHasChanged] = useState(false)
  if (!hasChanged && state !== initialState) setHasChanged(true)
  const [sawOpen, setSawOpen] = useState(!done)
  if (!sawOpen && !done) setSawOpen(true)
  const [focusMark, setFocusMark] = useState(false)

  // The completed mark erases quickly before the state icon returns.
  const mark = usePresence(done, { exitMs: MOTION_FAST_MS })
  const quickComplete = usePresence(actions.canComplete && state === 'NOT_STARTED')

  const handleClick = () => {
    onOpenDetail(id)
  }

  const handleDeleteClick = (e: MouseEvent) => {
    e.stopPropagation() // 카드 클릭 이벤트 방지
    if (actions.isMutating) return
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

  const handleStateIconClick = (e: MouseEvent) => {
    e.stopPropagation() // 카드 클릭 이벤트 방지
    // 미시작 → 시작
    if (state === 'NOT_STARTED') void actions.start()
  }

  // 완료 → 즉시 미시작으로 전이
  const handleReopen = () => {
    if (done) void actions.cancel()
  }

  const isStateClickable = state === 'NOT_STARTED'
  const stateClassName = `schedule-card__state-icon--${state.toLowerCase()}`

  const handleQuickComplete = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    if (done || actions.isLocked) return
    // The button leaves as the schedule completes. Keyboard focus moves to the card's mark.
    setFocusMark(document.activeElement === e.currentTarget)
    void actions.complete()
  }

  return (
    <article
      className={[
        'schedule-card',
        `schedule-state--${state.toLowerCase()}`,
        done ? 'is-completed' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      aria-label={title}
      onClick={handleClick}
      aria-busy={actions.isMutating || undefined}
    >
      <div className="schedule-card__main">
        <span className="schedule-card__state-slot">
          {mark.mounted ? (
            <ScheduleCompletionMark
              checked={done}
              leaving={mark.closing}
              drawOnMount={sawOpen}
              focusOnMount={focusMark}
              label={`${stateLabel.COMPLETED} 상태`}
              disabled={!actions.canCancel}
              onUncheck={handleReopen}
            />
          ) : (
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
              {/* A new glyph for a new state. It fades in only after a change made on screen. */}
              <span
                key={state}
                className={['schedule-card__glyph', hasChanged ? 'is-fresh' : '']
                  .filter(Boolean)
                  .join(' ')}
              >
                <WorkspaceIcon name={stateIcon[state]} />
              </span>
            </button>
          )}
        </span>
        <div className="schedule-card__text">
          <span className="schedule-card__status">
            <span
              key={state}
              className={hasChanged ? 'schedule-card__swap' : undefined}
            >
              {stateLabel[state]}
            </span>
          </span>
          <div className="schedule-card__title-row">
            <button
              type="button"
              className="schedule-card__title"
              onClick={(event) => {
                event.stopPropagation()
                handleClick()
              }}
            >
              <span className="motion-strike" data-done={done || undefined}>
                {title}
              </span>
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
                {assignee.unassigned ? assignee.label : `담당 ${assignee.label}`}
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
            <SpacePath
              path={cardPath(
                routeScope(pathname),
                { spaceId: selectedSpaceId, projectId: selectedProjectId },
                schedule,
                spaces,
                projects,
              )}
            />
          </div>
          {description && (
            <p className="schedule-card__description">{description}</p>
          )}
        </div>
        <div className="schedule-card__actions">
          {quickComplete.mounted && (
            <button
              type="button"
              className="schedule-card__quick-complete"
              onClick={handleQuickComplete}
              aria-label="즉시 완료"
              // Leaves with a short fade as the schedule completes. Never disabled while saving.
              data-state={quickComplete.closing ? 'closing' : undefined}
              inert={quickComplete.closing || undefined}
            >
              <WorkspaceIcon name="check" /> 즉시 완료
            </button>
          )}
          {onDelete && allowedActions?.delete && (
            <button
              className="schedule-card__delete-btn"
              onClick={handleDeleteClick}
              title="삭제"
              aria-label="일정 삭제"
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
