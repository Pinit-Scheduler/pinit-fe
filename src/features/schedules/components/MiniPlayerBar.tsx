import useActiveSchedule from '../hooks/useActiveSchedule.ts'
import useScheduleActions from '../hooks/useScheduleActions.ts'
import { useScheduleCache } from '@contexts/ScheduleCacheContext'
import type { ScheduleState } from '../types/schedule'
import './MiniPlayerBar.css'
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

  const stateLabel: Record<ScheduleState, string> = {
    NOT_STARTED: '미시작',
    IN_PROGRESS: '진행중',
    COMPLETED: '완료',
    SUSPENDED: '일시정지',
  }
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

  return (
    <div className="mini-player-wrapper" ref={wrapperRef}>
      <aside
        className="mini-player"
        aria-label="일정 컨트롤 바"
        aria-busy={scheduleActions.isMutating}
      >
        <button
          className="mini-player__summary"
          type="button"
          onClick={() => open(`/app/schedules/${activeSchedule.id}`)}
        >
          <p className="mini-player__title">진행 중인 일정</p>
          <p className="mini-player__description">{activeSchedule.title}</p>
          <p className="mini-player__meta">
            <span className="mini-player__pill mini-player__pill--state">
              {stateLabel[activeSchedule.state]}
            </span>
          </p>
        </button>
        <div
          className="mini-player__buttons"
          role="group"
          aria-label="일정 조작"
        >
          <button
            className="mini-player__button mini-player__button--start"
            onClick={scheduleActions.start}
            disabled={!scheduleActions.canStart || scheduleActions.isMutating}
            aria-label="시작 또는 재개"
            title="시작 또는 재개"
          >
            ▶
          </button>
          <button
            className="mini-player__button mini-player__button--pause"
            onClick={scheduleActions.pause}
            disabled={!scheduleActions.canPause || scheduleActions.isMutating}
            aria-label="일시정지"
            title="일시정지"
          >
            Ⅱ
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
            ✓
          </button>
          <button
            className="mini-player__button mini-player__button--cancel"
            onClick={scheduleActions.cancel}
            disabled={!scheduleActions.canCancel || scheduleActions.isMutating}
            aria-label="취소하고 미시작으로"
            title="취소 · 미시작으로 되돌리기"
          >
            ✕
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
