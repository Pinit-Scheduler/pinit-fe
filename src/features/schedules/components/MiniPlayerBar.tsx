import useActiveSchedule from '../hooks/useActiveSchedule.ts'
import useScheduleActions from '../hooks/useScheduleActions.ts'
import { useScheduleCache } from '@contexts/ScheduleCacheContext'
import type { ScheduleState } from '../types/schedule'
import './MiniPlayerBar.css'

const MiniPlayerBar = () => {
  const activeSchedule = useActiveSchedule()
  const { activeScheduleId } = useScheduleCache()
  const scheduleActions = useScheduleActions(
    activeSchedule?.id ?? null,
    (activeSchedule?.state ?? 'NOT_STARTED') as ScheduleState,
  )

  const stateLabel: Record<ScheduleState, string> = {
    NOT_STARTED: '미시작',
    IN_PROGRESS: '진행중',
    COMPLETED: '완료',
    SUSPENDED: '일시정지',
  }

  // 서버가 알려준 현재 활성 일정만 제어하며, IN_PROGRESS/SUSPENDED일 때만 표시
  if (
    !activeSchedule ||
    activeSchedule.id !== activeScheduleId ||
    (activeSchedule.state !== 'IN_PROGRESS' && activeSchedule.state !== 'SUSPENDED')
  ) {
    return null
  }

  return (
    <div className="mini-player-wrapper">
      <aside className="mini-player">
        <div>
          <p className="mini-player__title">진행 중인 일정</p>
          <p className="mini-player__description">{activeSchedule.title}</p>
          <p className="mini-player__meta">
            <span className="mini-player__pill mini-player__pill--state">{stateLabel[activeSchedule.state]}</span>
          </p>
        </div>
        <div className="mini-player__buttons">
          <button
            className="mini-player__button mini-player__button--start"
            onClick={scheduleActions.start}
            disabled={!scheduleActions.canStart}
          >
            ▶
          </button>
          <button
            className="mini-player__button mini-player__button--pause"
            onClick={scheduleActions.pause}
            disabled={!scheduleActions.canPause}
          >
            Ⅱ
          </button>
          <button
            className="mini-player__button mini-player__button--complete"
            onClick={scheduleActions.complete}
            disabled={!scheduleActions.canComplete}
          >
            ✓
          </button>
          <button
            className="mini-player__button mini-player__button--cancel"
            onClick={scheduleActions.cancel}
            disabled={!scheduleActions.canCancel}
          >
            ✕
          </button>
        </div>
      </aside>
    </div>
  )
}

export default MiniPlayerBar
