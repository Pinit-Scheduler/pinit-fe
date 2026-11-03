import { useParams } from 'react-router-dom'
import { useRouteSurfaceNavigation } from '@shared/routing/RouteSurface'
import TaskDetailModal from '../components/TaskDetailModal'
export default function TaskDetailPage() {
  const { taskId } = useParams(),
    { close } = useRouteSurfaceNavigation()
  const id = Number(taskId)
  return Number.isSafeInteger(id) && id > 0 ? (
    <TaskDetailModal embedded taskId={id} onClose={() => close('/app/tasks')} />
  ) : (
    <p role="alert">유효하지 않은 작업입니다.</p>
  )
}
