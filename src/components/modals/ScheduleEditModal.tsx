import { useNavigate, useParams } from 'react-router-dom'
import ScheduleModal from './ScheduleModal.tsx'
import useScheduleDetail from '../../hooks/useScheduleDetail.ts'

const ScheduleEditModal = () => {
  const { scheduleId } = useParams()
  const navigate = useNavigate()
  const { schedule, isLoading } = useScheduleDetail(scheduleId)

  const handleClose = () => {
    if (window.history.state && window.history.length > 1) {
      navigate(-1)
    } else if (scheduleId) {
      navigate(`/app/schedules/${scheduleId}`)
    } else {
      navigate('/app/schedules')
    }
  }

  if (!scheduleId) {
    handleClose()
    return null
  }

  if (isLoading || !schedule) {
    return (
      <div className="schedule-modal__backdrop" onClick={handleClose}>
        <div className="schedule-modal__content" onClick={(e) => e.stopPropagation()}>
          <div className="schedule-modal__body">
            <p>일정 정보를 불러오는 중...</p>
          </div>
        </div>
      </div>
    )
  }

  return <ScheduleModal mode="edit" schedule={schedule} onClose={handleClose} />
}

export default ScheduleEditModal
