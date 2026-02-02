import useScheduleDetail from '../../hooks/useScheduleDetail'
import { deleteSchedule } from '../../api/schedules'
import { useNavigate } from 'react-router-dom'
import { useToast } from '@contexts/ToastContext'
import { formatDateTimeWithZone } from '@shared/utils/datetime'
import { formatDurationLabel } from '@shared/utils/duration'
import { useScheduleCache } from '@contexts/ScheduleCacheContext'
import { useTimePreferences } from '@contexts/TimePreferencesContext'
import './ScheduleDetailModal.css'
import '../ScheduleForm.css'
import { scheduleTypeLabel, stateLabel } from '@constants/schedules'

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
  const { schedule, isLoading, error } = useScheduleDetail(scheduleId.toString())
  const navigate = useNavigate()
  const { addToast } = useToast()
  const { activeScheduleId, setActiveSchedule } = useScheduleCache()
  const { offsetLabel } = useTimePreferences()

  const handleDelete = async () => {
    if (!schedule) return

    if (window.confirm(`"${schedule.title}" 일정을 삭제하시겠습니까?`)) {
      try {
        await deleteSchedule(schedule.id)
        console.log(`✅ Schedule deleted: ${schedule.id}`)
        if (activeScheduleId === schedule.id) {
          setActiveSchedule(null)
        }
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

  if (isLoading) {
    return (
      <div className="schedule-detail-modal__backdrop" onClick={onClose}>
        <div className="schedule-detail-modal__content" onClick={(e) => e.stopPropagation()}>
          <p className="schedule-detail-modal__loading">일정 정보를 불러오는 중...</p>
        </div>
      </div>
    )
  }

  if (error || !schedule) {
    return (
      <div className="schedule-detail-modal__backdrop" onClick={onClose}>
        <div className="schedule-detail-modal__content" onClick={(e) => e.stopPropagation()}>
          <p className="schedule-detail-modal__loading">일정 정보를 불러오지 못했어요.</p>
          <p className="schedule-detail-modal__description">{error}</p>
          <button
            type="button"
            className="schedule-detail-modal__action-btn schedule-detail-modal__action-btn--delete"
            onClick={(e) => {
              e.stopPropagation()
              onClose()
            }}
          >
            닫기
          </button>
        </div>
      </div>
    )
  }

  const startTime = formatDateTimeWithZone(schedule.date)
  const spentTimeLabel = formatDurationLabel(schedule.duration)

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
                {stateLabel[schedule.state]}
              </span>
              {scheduleTypeLabel[schedule.scheduleType] && (
                <span className="schedule-detail-modal__badge">
                  {schedule.scheduleType}
                </span>
              )}
              {typeof schedule.taskId === 'number' && (
                <span className="schedule-detail-modal__badge">
                  작업 #{schedule.taskId}
                </span>
              )}
            </div>
          </section>

          <section className="schedule-detail-modal__section">
            <h3>시간 ({offsetLabel})</h3>
            <p>
              시작: {startTime}
              <br />
              진행 시간: {spentTimeLabel}
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
