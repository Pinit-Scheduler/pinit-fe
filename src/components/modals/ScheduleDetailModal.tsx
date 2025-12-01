import useScheduleDetail from '../../hooks/useScheduleDetail'
import { deleteSchedule } from '../../api/schedules'
import { useNavigate } from 'react-router-dom'
import { useToast } from '../../context/ToastContext'
import { formatDateTimeWithZone } from '../../utils/datetime'
import { getImportanceStyle, getUrgencyStyle } from '../../utils/priorityStyles.ts'
import './ScheduleDetailModal.css'

type ScheduleDetailModalProps = {
  scheduleId: number
  onClose: () => void
  onRefresh?: () => void
}

/**
 * 일정 상세 모달 컴포넌트
 * @param scheduleId - 일정 ID
 * @param onClose - 모달 닫기 콜백
 * @param onRefresh - 일정 목록 새로고침 콜백 (선택적)
 * @constructor
 */
const ScheduleDetailModal = ({ scheduleId, onClose, onRefresh }: ScheduleDetailModalProps) => {
  const { schedule, isLoading } = useScheduleDetail(scheduleId.toString())
  const navigate = useNavigate()
  const { addToast } = useToast()

  const handleDelete = async () => {
    if (!schedule) return

    if (window.confirm(`"${schedule.title}" 일정을 삭제하시겠습니까?`)) {
      try {
        await deleteSchedule(schedule.id)
        console.log(`✅ Schedule deleted: ${schedule.id}`)
        onClose()
        addToast('일정이 삭제되었습니다.', 'success')
        if (onRefresh) {
          onRefresh()
        }
      } catch (error) {
        console.error(`❌ Delete failed:`, error)
        addToast('일정 삭제에 실패했습니다.', 'error')
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

  const startTime = formatDateTimeWithZone(schedule.date)
  const deadline = formatDateTimeWithZone(schedule.deadline)
  const importanceStyle = getImportanceStyle(schedule.importance)
  const urgencyStyle = getUrgencyStyle(schedule.urgency)

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
              <span className="schedule-detail-modal__badge" style={importanceStyle}>
                중요도 {schedule.importance}
              </span>
              <span className="schedule-detail-modal__badge" style={urgencyStyle}>
                긴급도 {schedule.urgency}
              </span>
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
                navigate(`/app/schedules/${schedule.id}/edit`)
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
