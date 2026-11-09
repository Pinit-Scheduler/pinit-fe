import WorkspaceIcon from '@shared/components/common/WorkspaceIcon'
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

  return (
    <div className="schedules-tab__actions">
      {actions.canStart && (
        <button
          className="schedules-tab__action-btn schedules-tab__action-btn--start"
          onClick={() => onActionClick(schedule.id, actions.start)}
          title="시작"
        >
          <WorkspaceIcon name="play" /> 시작
        </button>
      )}
      {actions.canPause && (
        <button
          className="schedules-tab__action-btn schedules-tab__action-btn--pause"
          onClick={() => onActionClick(schedule.id, actions.pause)}
          title="일시중지"
        >
          <WorkspaceIcon name="pause" /> 일시중지
        </button>
      )}
      {actions.canComplete && (
        <button
          className="schedules-tab__action-btn schedules-tab__action-btn--complete"
          onClick={() => onActionClick(schedule.id, actions.complete)}
          title="완료"
        >
          <WorkspaceIcon name="check" /> 완료
        </button>
      )}
      {actions.canCancel && (
        <button
          className="schedules-tab__action-btn schedules-tab__action-btn--cancel"
          onClick={() => onActionClick(schedule.id, actions.cancel)}
          title="취소"
        >
          <WorkspaceIcon name="close" /> 취소
        </button>
      )}
    </div>
  )
}

export default ScheduleItemActions
