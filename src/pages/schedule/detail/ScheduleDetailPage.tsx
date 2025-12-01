import { useNavigate, useParams } from 'react-router-dom'
import useScheduleDetail from '../../../hooks/useScheduleDetail.ts'
import useScheduleActions from '../../../hooks/scheduledetails/useScheduleActions.ts'
import { formatDateTimeWithZone } from '../../../utils/datetime.ts'
import { getImportanceStyle, getUrgencyStyle } from '../../../utils/priorityStyles.ts'
import './ScheduleDetailPage.css'

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
