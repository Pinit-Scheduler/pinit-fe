import { useParams } from 'react-router-dom'
import ScheduleDetailModal from '../components/modals/ScheduleDetailModal'
import { useRouteSurfaceNavigation } from '@shared/routing/RouteSurface'

const ScheduleDetailPage = () => {
  const { scheduleId } = useParams()
  const { close } = useRouteSurfaceNavigation()
  const id = Number(scheduleId)
  if (!Number.isSafeInteger(id) || id <= 0)
    return <p role="alert">유효하지 않은 일정이에요.</p>
  return (
    <ScheduleDetailModal
      scheduleId={id}
      embedded
      onClose={() => close('/app/schedules')}
    />
  )
}
export default ScheduleDetailPage
