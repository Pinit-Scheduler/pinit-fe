import useScheduleActions from '../hooks/useScheduleActions.ts'
import type { ScheduleSummary } from '../types/schedule'

type ScheduleItemActionsProps = {
  schedule: ScheduleSummary
  onActionClick: (scheduleId: number, action: () => Promise<void>) => void
}

/**
 * 일정 아이템의 상태 변경 액션 버튼 컴포넌트
 * @param schedule - 일정 요약 정보
 * @param onActionClick - 액션 클릭 핸들러
 * @constructor
 */
const ScheduleItemActions = ({ schedule, onActionClick }: ScheduleItemActionsProps) => {
  const actions = useScheduleActions(schedule.id, schedule.state)

  console.log(`🎯 ScheduleItemActions for schedule ${schedule.id}:`, {
    id: schedule.id,
    title: schedule.title,
    state: schedule.state,
    stateType: typeof schedule.state,
    canStart: actions.canStart,
    canPause: actions.canPause,
    canComplete: actions.canComplete,
    canCancel: actions.canCancel,
    isMutating: actions.isMutating
  })

  // 버튼이 하나도 없으면 경고
  if (!actions.canStart && !actions.canPause && !actions.canComplete && !actions.canCancel) {
    console.warn(`⚠️ No buttons available for schedule ${schedule.id} with state: ${schedule.state}`)
  }

  return (
    <div className="schedules-tab__actions">
      {actions.canStart && (
        <button
          className="schedules-tab__action-btn schedules-tab__action-btn--start"
          onClick={() => onActionClick(schedule.id, actions.start)}
          disabled={actions.isMutating}
          title="시작"
        >
          ▶ 시작
        </button>
      )}
      {actions.canPause && (
        <button
          className="schedules-tab__action-btn schedules-tab__action-btn--pause"
          onClick={() => onActionClick(schedule.id, actions.pause)}
          disabled={actions.isMutating}
          title="일시중지"
        >
          ⏸ 일시중지
        </button>
      )}
      {actions.canComplete && (
        <button
          className="schedules-tab__action-btn schedules-tab__action-btn--complete"
          onClick={() => onActionClick(schedule.id, actions.complete)}
          disabled={actions.isMutating}
          title="완료"
        >
          ✓ 완료
        </button>
      )}
      {actions.canCancel && (
        <button
          className="schedules-tab__action-btn schedules-tab__action-btn--cancel"
          onClick={() => onActionClick(schedule.id, actions.cancel)}
          disabled={actions.isMutating}
          title="취소"
        >
          ✕ 취소
        </button>
      )}
    </div>
  )
}

export default ScheduleItemActions
