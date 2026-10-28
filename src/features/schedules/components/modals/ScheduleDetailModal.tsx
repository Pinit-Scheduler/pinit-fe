import { useId } from 'react'
import Modal from '@shared/components/common/Modal'
import useScheduleDetail from '../../hooks/useScheduleDetail'
import { deleteSchedule } from '../../api/schedules'
import { useNavigate } from 'react-router-dom'
import { useToast } from '@contexts/ToastContext'
import { formatDateTimeWithZone } from '@shared/utils/datetime'
import { formatDurationLabel } from '@shared/utils/duration'
import { formatIsoDurationLabel } from '@shared/utils/isoDuration'
import { useScheduleCache } from '@contexts/ScheduleCacheContext'
import { useTimePreferences } from '@contexts/TimePreferencesContext'
import './ScheduleDetailModal.css'
import '../ScheduleForm.css'
import { scheduleTypeLabel, stateLabel } from '@constants/schedules'
import { useRecurrenceScope } from '@features/recurrence/components/RecurrenceScopeDialog'
import { confirmAndDeleteSeries } from '@features/recurrence/utils/seriesMutations'
import { dispatchScheduleChanged } from '@shared/utils/events'
import { useTrashUndo } from '@features/trash'
import '@features/recurrence/components/RecurrenceRuleFields.css'

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
  const { offerScheduleUndo } = useTrashUndo()
  const { activeScheduleId, setActiveSchedule } = useScheduleCache()
  const { offsetLabel } = useTimePreferences()
  const recurrenceScope = useRecurrenceScope()
  const titleId = useId()

  const handleDelete = async () => {
    if (!schedule) return

    if (schedule.recurrence) {
      const scope = await recurrenceScope.ask('delete', schedule.title)
      if (scope === null) return
      if (scope !== 'THIS') {
        try {
          if (await confirmAndDeleteSeries(schedule.recurrence, scope)) {
            if (activeScheduleId === schedule.id) setActiveSchedule(null)
            dispatchScheduleChanged({ reason: 'recurrence' })
            onClose()
            addToast('반복 일정을 지웠어요.', 'success')
            onRefresh?.()
          }
        } catch (error) {
          console.error('반복 삭제 실패:', error)
          addToast('반복 일정을 지우지 못했어요.', 'error')
        }
        return
      }
    }

    if (schedule.recurrence || window.confirm(`"${schedule.title}" 일정을 휴지통으로 옮길까요?\n30일 안에 되돌릴 수 있어요.`)) {
      try {
        await deleteSchedule(schedule.id)
        console.log(`✅ Schedule deleted: ${schedule.id}`)
        if (activeScheduleId === schedule.id) {
          setActiveSchedule(null)
        }
        onClose()
        offerScheduleUndo(schedule.id, onRefresh)
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
      <Modal backdropClassName="schedule-detail-modal__backdrop" className="schedule-detail-modal__content" onClose={onClose} ariaLabel="일정 상세">
        <p className="schedule-detail-modal__loading">일정 정보를 불러오는 중...</p>
      </Modal>
    )
  }

  if (error || !schedule) {
    return (
      <Modal backdropClassName="schedule-detail-modal__backdrop" className="schedule-detail-modal__content" onClose={onClose} ariaLabel="일정 상세">
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
      </Modal>
    )
  }

  const startTime = formatDateTimeWithZone(schedule.date)
  const spentTimeLabel = formatDurationLabel(schedule.duration)
  const plannedDurationLabel = formatIsoDurationLabel(schedule.plannedDuration)

  return (
    <Modal backdropClassName="schedule-detail-modal__backdrop" className="schedule-detail-modal__content" onClose={onClose} labelledBy={titleId} ariaLabel="일정 상세">
      <header className="schedule-detail-modal__header">
        <h1 id={titleId}>일정 상세</h1>
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
            {plannedDurationLabel && (
              <>
                계획 길이: {plannedDurationLabel}
                <br />
              </>
            )}
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
      {recurrenceScope.dialog}
    </Modal>
  )
}

export default ScheduleDetailModal
