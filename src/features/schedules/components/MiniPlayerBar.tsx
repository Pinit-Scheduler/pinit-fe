import WorkspaceIcon from '@shared/components/common/WorkspaceIcon'
import useActiveSchedule from '../hooks/useActiveSchedule.ts'
import useScheduleActions from '../hooks/useScheduleActions.ts'
import { useScheduleCache } from '@contexts/ScheduleCacheContext'
import type { ScheduleState } from '../types/schedule'
import './MiniPlayerBar.css'
import './ScheduleState.css'
import { stateIcon, stateLabel } from '@constants/schedules'
import { useEffect, useRef, useState } from 'react'
import { useRouteSurfaceNavigation } from '@shared/routing/RouteSurface'
import { usePresence } from '@shared/motion'

const MiniPlayerBar = () => {
  const activeSchedule = useActiveSchedule()
  const { activeScheduleId } = useScheduleCache()
  const { open } = useRouteSurfaceNavigation()
  const wrapperRef = useRef<HTMLDivElement>(null)
  const scheduleActions = useScheduleActions(
    activeSchedule?.id ?? null,
    (activeSchedule?.state ?? 'NOT_STARTED') as ScheduleState,
  )

  // 서버가 알려준 현재 활성 일정만 제어하며, IN_PROGRESS/SUSPENDED일 때만 표시
  const visible = Boolean(
    activeSchedule &&
      activeSchedule.id === activeScheduleId &&
      ['IN_PROGRESS', 'SUSPENDED'].includes(activeSchedule.state),
  )
  // The bar slides up when a schedule starts and slides away when it ends, instead of popping.
  // While it leaves it keeps showing the last schedule and the state it ended in.
  const presence = usePresence(visible ? activeSchedule : null)
  const liveState = scheduleActions.currentState
  const [endedState, setEndedState] = useState<ScheduleState>(liveState)
  if (visible && !presence.closing && endedState !== liveState) setEndedState(liveState)
  const shownState = presence.closing ? endedState : liveState
  // A state changed while the bar was on screen: the new glyph and label fade in.
  const [stateChanged, setStateChanged] = useState(false)
  const [firstState, setFirstState] = useState<ScheduleState | null>(null)
  if (presence.mounted && firstState === null) setFirstState(shownState)
  if (!presence.mounted && firstState !== null) {
    setFirstState(null)
    setStateChanged(false)
  }
  if (presence.mounted && firstState !== null && !stateChanged && shownState !== firstState)
    setStateChanged(true)

  useEffect(() => {
    const root = wrapperRef.current
    // The page keeps its bottom padding until the bar has finished leaving.
    if (!presence.mounted || !root) {
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
  }, [presence.mounted])

  const schedule = presence.value
  if (!presence.mounted || !schedule) return null
  const isRunning = shownState === 'IN_PROGRESS'
  const leaving = presence.closing

  return (
    <div
      className="mini-player-wrapper"
      ref={wrapperRef}
      inert={leaving || undefined}
    >
      <aside
        className={`mini-player schedule-state--${shownState.toLowerCase()}`}
        aria-label="일정 컨트롤 바"
        aria-busy={scheduleActions.isMutating || undefined}
        data-state={leaving ? 'closing' : 'open'}
      >
        <button
          className="mini-player__summary"
          type="button"
          aria-label={`${schedule.title}, ${stateLabel[shownState]}, 상세 보기`}
          onClick={() => open(`/app/schedules/${schedule.id}`)}
        >
          <span className="mini-player__state-icon" aria-hidden="true">
            <span
              key={shownState}
              className={stateChanged ? 'mini-player__swap' : undefined}
            >
              <WorkspaceIcon name={stateIcon[shownState]} />
            </span>
          </span>
          <span className="mini-player__copy">
            <span className="mini-player__description">{schedule.title}</span>
            <span className="mini-player__state-text">
              <span
                key={shownState}
                className={stateChanged ? 'mini-player__swap' : undefined}
              >
                {stateLabel[shownState]}
              </span>
            </span>
          </span>
        </button>
        {/* Buttons are disabled only by permission. A pending save is guarded in the actions,
            so the bar never dims while it saves. */}
        <div
          className="mini-player__buttons"
          role="group"
          aria-label="일정 조작"
        >
          <button
            className="mini-player__button mini-player__button--toggle"
            onClick={isRunning ? scheduleActions.pause : scheduleActions.start}
            disabled={
              isRunning ? !scheduleActions.canPause : !scheduleActions.canStart
            }
            aria-label={isRunning ? '일시정지' : '재개'}
            title={isRunning ? '일시정지' : '재개'}
          >
            <span
              key={isRunning ? 'pause' : 'play'}
              className={[
                'mini-player__toggle-glyph',
                stateChanged ? 'mini-player__swap' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <WorkspaceIcon name={isRunning ? 'pause' : 'play'} />
            </span>
          </button>
          <button
            className="mini-player__button mini-player__button--complete"
            onClick={scheduleActions.complete}
            disabled={!scheduleActions.canComplete}
            aria-label="완료"
            title="완료"
          >
            <WorkspaceIcon name="check" />
          </button>
          <button
            className="mini-player__button mini-player__button--cancel"
            onClick={scheduleActions.cancel}
            disabled={!scheduleActions.canCancel}
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
