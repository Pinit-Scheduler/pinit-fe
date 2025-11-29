import dayjs from 'dayjs'
import { useContext } from 'react'
import { ScheduleModalContext } from '../../context/ScheduleModalContext'
import useScheduleDetail from '../../hooks/useScheduleDetail'
import { deleteSchedule } from '../../api/schedules'
import './ScheduleDetailModal.css'

type ScheduleDetailModalProps = {
  scheduleId: number
  onClose: () => void
  onRefresh?: () => void
}

const ScheduleDetailModal = ({ scheduleId, onClose, onRefresh }: ScheduleDetailModalProps) => {
  const { schedule, isLoading } = useScheduleDetail(scheduleId.toString())
  const modal = useContext(ScheduleModalContext)

  const handleDelete = async () => {
    if (!schedule) return

    if (window.confirm(`"${schedule.title}" 일정을 삭제하시겠습니까?`)) {
      try {
        await deleteSchedule(schedule.id)
        console.log(`✅ Schedule deleted: ${schedule.id}`)
        onClose()
        if (onRefresh) {
          onRefresh()
        }
      } catch (error) {
        console.error(`❌ Delete failed:`, error)
        alert('일정 삭제에 실패했습니다.')
      }
    }
  }

  if (isLoading || !schedule) {
    return (
      <div className="schedule-detail-modal__backdrop" onClick={onClose}>
        <div className="schedule-detail-modal__content" onClick={(e) => e.stopPropagation()}>
          <p className="schedule-detail-modal__loading">일정 정보를 불러오는 중...</p>
        </div>
      </div>
    )
  }

  const startTime = dayjs(schedule.date).format('M월 D일 HH:mm')
  const deadline = dayjs(schedule.deadline).format('M월 D일 HH:mm')

  return (
    <div className="schedule-detail-modal__backdrop" onClick={onClose}>
      <div className="schedule-detail-modal__content" onClick={(e) => e.stopPropagation()}>
        <header className="schedule-detail-modal__header">
          <h1>일정 상세</h1>
          <button
            className="schedule-detail-modal__close"
            onClick={(e) => {
              e.stopPropagation()
              onClose()
            }}
            aria-label="닫기"
          >
            ✕
          </button>
        </header>

        <div className="schedule-detail-modal__body">
          <section className="schedule-detail-modal__section">
            <h2>{schedule.title}</h2>
            <p className="schedule-detail-modal__description">{schedule.description}</p>
            <div className="schedule-detail-modal__meta">
              <span className="schedule-detail-modal__badge schedule-detail-modal__badge--state">
                {schedule.state}
              </span>
              <span className="schedule-detail-modal__badge">중요도 {schedule.importance}</span>
              <span className="schedule-detail-modal__badge">긴급도 {schedule.urgency}</span>
            </div>
          </section>

          <section className="schedule-detail-modal__section">
            <h3>시간</h3>
            <p>
              시작: {startTime}
              <br />
              마감: {deadline}
            </p>
          </section>

          <footer className="schedule-detail-modal__actions">
            <button
              type="button"
              onClick={() => {
                onClose()
                if (schedule) {
                  modal?.openEdit(schedule.id)
                }
              }}
              className="schedule-detail-modal__action-btn schedule-detail-modal__action-btn--edit"
            >
              ✏️ 수정
            </button>
            <button
              type="button"
              onClick={handleDelete}
              className="schedule-detail-modal__action-btn schedule-detail-modal__action-btn--delete"
            >
              🗑️ 삭제
            </button>
          </footer>
        </div>
      </div>
    </div>
  )
}

export default ScheduleDetailModal

