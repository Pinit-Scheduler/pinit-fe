import { useNavigate } from 'react-router-dom'
import ScheduleModal from './ScheduleModal.tsx'

const ScheduleCreateModal = () => {
  const navigate = useNavigate()

  const handleClose = () => {
    if (window.history.state && window.history.length > 1) {
      navigate(-1)
    } else {
      navigate('/app/schedules')
    }
  }

  return <ScheduleModal mode="create" onClose={handleClose} />
}

export default ScheduleCreateModal
