import useActiveSchedule from '../../hooks/useActiveSchedule'
import useScheduleActions from '../../hooks/useScheduleActions'
import './MiniPlayerBar.css'

const MiniPlayerBar = () => {
  const activeSchedule = useActiveSchedule()
  const scheduleActions = useScheduleActions(activeSchedule?.id ?? null, activeSchedule?.state ?? 'NOT_STARTED')

  if (!activeSchedule) return null

  return (
    <div className="mini-player-wrapper">
      <aside className="mini-player">
        <div>
          <p className="mini-player__title">진행 중인 일정</p>
          <p className="mini-player__description">{activeSchedule.title}</p>
        </div>
        <div className="mini-player__buttons">
          <button onClick={scheduleActions.start} disabled={!scheduleActions.canStart}>▶</button>
          <button onClick={scheduleActions.pause} disabled={!scheduleActions.canPause}>Ⅱ</button>
          <button onClick={scheduleActions.complete} disabled={!scheduleActions.canComplete}>✓</button>
          <button onClick={scheduleActions.cancel} disabled={!scheduleActions.canCancel}>✕</button>
        </div>
      </aside>
    </div>
  )
}

export default MiniPlayerBar

