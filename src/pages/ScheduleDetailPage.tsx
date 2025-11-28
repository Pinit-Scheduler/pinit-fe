import dayjs from 'dayjs'
import { useNavigate, useParams } from 'react-router-dom'
import useScheduleDetail from '../hooks/useScheduleDetail'
import useScheduleActions from '../hooks/useScheduleActions'
import './ScheduleDetailPage.css'

const ScheduleDetailPage = () => {
  const { scheduleId } = useParams()
  const navigate = useNavigate()
  const { schedule, isLoading } = useScheduleDetail(scheduleId)
  const scheduleActions = useScheduleActions(schedule?.state ?? 'PENDING')

  if (isLoading || !schedule) {
    return <p className="schedule-detail__loading">일정 정보를 불러오는 중...</p>
  }

  const startTime = dayjs(schedule.date).format('M월 D일 HH:mm')
  const deadline = dayjs(schedule.deadline).format('M월 D일 HH:mm')

  return (
    <section className="schedule-detail">
      <button className="schedule-detail__back" onClick={() => navigate(-1)}>
        ← 목록으로
      </button>
      <header className="schedule-detail__header">
        <h1>{schedule.title}</h1>
        <p>{schedule.description}</p>
        <div className="schedule-detail__meta">
          <span>상태: {schedule.state}</span>
          <span>중요도 {schedule.importance}</span>
          <span>긴급도 {schedule.urgency}</span>
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
        <h2>추정/실제</h2>
        <p>
          추정 {schedule.estimatedMinutes ?? 0}분 · 진행 {schedule.actualMinutes ?? 0}분
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
      </footer>
      {scheduleActions.lastMessage && <p className="schedule-detail__message">{scheduleActions.lastMessage}</p>}
    </section>
  )
}

export default ScheduleDetailPage
