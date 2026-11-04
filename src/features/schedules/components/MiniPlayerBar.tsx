import WorkspaceIcon from '@shared/components/common/WorkspaceIcon'
import useActiveSchedule from '../hooks/useActiveSchedule.ts'
import useScheduleActions from '../hooks/useScheduleActions.ts'
import { useScheduleCache } from '@contexts/ScheduleCacheContext'
import type { ScheduleState } from '../types/schedule'
import './MiniPlayerBar.css'
import './ScheduleState.css'
import { stateIcon, stateLabel } from '@constants/schedules'
import { useEffect, useRef } from 'react'
import { useRouteSurfaceNavigation } from '@shared/routing/RouteSurface'

const MiniPlayerBar = () => {
  const activeSchedule = useActiveSchedule()
  const { activeScheduleId } = useScheduleCache()
  const { open } = useRouteSurfaceNavigation()
  const wrapperRef = useRef<HTMLDivElement>(null)
  const scheduleActions = useScheduleActions(
    activeSchedule?.id ?? null,
    (activeSchedule?.state ?? 'NOT_STARTED') as ScheduleState,
  )

  const visible = Boolean(
    activeSchedule &&
      activeSchedule.id === activeScheduleId &&
      ['IN_PROGRESS', 'SUSPENDED'].includes(activeSchedule.state),
  )
  useEffect(() => {
    const root = wrapperRef.current
    if (!visible || !root) {
      document.documentElement.style.setProperty(
        '--workspace-player-height',
        '0px',
      )
      return
    }
    const observer = new ResizeObserver(() =>
      document.documentElement.style.setProperty(
        '--workspace-player-height',
        `${root.getBoundingClientRect().height}px`,
      ),
    )
    observer.observe(root)
    return () => {
      observer.disconnect()
      document.documentElement.style.setProperty(
        '--workspace-player-height',
        '0px',
      )
    }
  }, [visible])

  // 서버가 알려준 현재 활성 일정만 제어하며, IN_PROGRESS/SUSPENDED일 때만 표시
  if (
    !activeSchedule ||
    activeSchedule.id !== activeScheduleId ||
    (activeSchedule.state !== 'IN_PROGRESS' &&
      activeSchedule.state !== 'SUSPENDED')
  ) {
    return null
  }
  const isRunning = activeSchedule.state === 'IN_PROGRESS'

  return (
    <div className="mini-player-wrapper" ref={wrapperRef}>
      <aside
        className={`mini-player schedule-state--${activeSchedule.state.toLowerCase()}`}
        aria-label="일정 컨트롤 바"
        aria-busy={scheduleActions.isMutating}
      >
        <button
          className="mini-player__summary"
          type="button"
          aria-label={`${activeSchedule.title}, ${stateLabel[activeSchedule.state]}, 상세 보기`}
          onClick={() => open(`/app/schedules/${activeSchedule.id}`)}
        >
          <span className="mini-player__state-icon" aria-hidden="true">
            <WorkspaceIcon name={stateIcon[activeSchedule.state]} />
          </span>
          <span className="mini-player__copy">
            <span className="mini-player__description">{activeSchedule.title}</span>
            <span className="mini-player__state-text">
              {stateLabel[activeSchedule.state]}
            </span>
          </span>
        </button>
        <div
          className="mini-player__buttons"
          role="group"
          aria-label="일정 조작"
        >
          <button
            className="mini-player__button mini-player__button--toggle"
            onClick={isRunning ? scheduleActions.pause : scheduleActions.start}
            disabled={
              scheduleActions.isMutating ||
              (isRunning ? !scheduleActions.canPause : !scheduleActions.canStart)
            }
            aria-label={isRunning ? '일시정지' : '재개'}
            title={isRunning ? '일시정지' : '재개'}
          >
            <WorkspaceIcon name={isRunning ? 'pause' : 'play'} />
          </button>
          <button
            className="mini-player__button mini-player__button--complete"
            onClick={scheduleActions.complete}
            disabled={
              !scheduleActions.canComplete || scheduleActions.isMutating
            }
            aria-label="완료"
            title="완료"
          >
            <WorkspaceIcon name="check" />
          </button>
          <button
            className="mini-player__button mini-player__button--cancel"
            onClick={scheduleActions.cancel}
            disabled={!scheduleActions.canCancel || scheduleActions.isMutating}
            aria-label="취소하고 미시작으로"
            title="취소 · 미시작으로 되돌리기"
          >
            <WorkspaceIcon name="close" />
          </button>
        </div>
        {scheduleActions.lastError && (
          <div className="mini-player__error" role="alert">
            <span>{scheduleActions.lastError}</span>
            <button
              type="button"
              onClick={scheduleActions.retry}
              disabled={scheduleActions.isMutating}
            >
              다시 시도
            </button>
          </div>
        )}
      </aside>
    </div>
  )
}

export default MiniPlayerBar
