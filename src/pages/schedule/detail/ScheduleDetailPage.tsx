import { useNavigate, useParams } from 'react-router-dom'
import useScheduleDetail from '../../../hooks/useScheduleDetail.ts'
import useScheduleActions from '../../../hooks/scheduledetails/useScheduleActions.ts'
import { formatDateTimeWithZone } from '../../../utils/datetime.ts'
import { getImportanceStyle, getUrgencyStyle } from '../../../utils/priorityStyles.ts'
import type { ScheduleSummary } from '../../../types/schedule'
import './ScheduleDetailPage.css'
import '../../../components/schedules/ScheduleForm.css'

const ScheduleDetailPage = () => {
  const { scheduleId } = useParams()
  const navigate = useNavigate()
  const { schedule, isLoading } = useScheduleDetail(scheduleId)
  const scheduleActions = useScheduleActions(schedule?.id ?? null, schedule?.state ?? 'NOT_STARTED')

  if (isLoading || !schedule) {
    return <p className="schedule-detail__loading">일정 정보를 불러오는 중...</p>
  }

  const startTime = formatDateTimeWithZone(schedule.date)
  const deadline = formatDateTimeWithZone(schedule.deadline)
  const importanceStyle = getImportanceStyle(schedule.importance)
  const urgencyStyle = getUrgencyStyle(schedule.urgency)
  const previousTasks: ScheduleSummary[] = schedule.previousTasks ?? []
  const nextTasks: ScheduleSummary[] = schedule.nextTasks ?? []

  return (
    <section className="schedule-detail">
      <button className="schedule-detail__back" onClick={() => navigate(-1)}>
        ← 목록으로
      </button>
      <header className="schedule-detail__header">
        <h1>{schedule.title}</h1>
        <p>{schedule.description}</p>
        <div className="schedule-detail__meta">
          <span className="schedule-detail__state">상태: {schedule.state}</span>
          <span className="schedule-detail__badge" style={importanceStyle}>
            중요도 {schedule.importance}
          </span>
          <span className="schedule-detail__badge" style={urgencyStyle}>
            긴급도 {schedule.urgency}
          </span>
        </div>
      </header>
      <section className="schedule-detail__section">
        <h2>시간</h2>
        <p>
          시작: {startTime}
          <br />마감: {deadline}
        </p>
      </section>
      <section className="schedule-detail__section">
        <h2>이전/이후 일정</h2>
        <div className="schedule-form__dependency-groups">
          <div className="schedule-form__dependency-column">
            <div className="schedule-form__dependency-header">
              <h4>이전에 해야 하는 일정</h4>
            </div>
            {previousTasks.length === 0 ? (
              <p className="schedule-form__dependency-empty">연결된 이전 일정이 없습니다.</p>
            ) : (
              <div className="schedule-form__dependency-tags">
                {previousTasks.map((task) => (
                  <span key={task.id} className="schedule-form__tag">
                    {task.title}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="schedule-form__dependency-column">
            <div className="schedule-form__dependency-header">
              <h4>이후에 해야 하는 일정</h4>
            </div>
            {nextTasks.length === 0 ? (
              <p className="schedule-form__dependency-empty">연결된 이후 일정이 없습니다.</p>
            ) : (
              <div className="schedule-form__dependency-tags">
                {nextTasks.map((task) => (
                  <span key={task.id} className="schedule-form__tag is-next">
                    {task.title}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>
      <footer className="schedule-detail__actions">
        <button type="button" disabled={!scheduleActions.canStart || scheduleActions.isMutating} onClick={scheduleActions.start}>
          시작
        </button>
        <button type="button" disabled={!scheduleActions.canPause || scheduleActions.isMutating} onClick={scheduleActions.pause}>
          일시중지
        </button>
        <button type="button" disabled={!scheduleActions.canComplete || scheduleActions.isMutating} onClick={scheduleActions.complete}>
          완료
        </button>
        <button type="button" disabled={!scheduleActions.canCancel || scheduleActions.isMutating} onClick={scheduleActions.cancel}>
          취소
        </button>
        <button
          type="button"
          onClick={() => {
            if (schedule) {
              navigate(`/app/schedules/${schedule.id}/edit`)
            }
          }}
        >
          수정
        </button>
      </footer>
      {scheduleActions.lastMessage && <p className="schedule-detail__message">{scheduleActions.lastMessage}</p>}
    </section>
  )
}

export default ScheduleDetailPage
