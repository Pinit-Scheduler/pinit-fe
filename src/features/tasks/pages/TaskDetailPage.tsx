import { useParams, useNavigate } from 'react-router-dom'
import TaskDetailModal from '../components/TaskDetailModal'

const TaskDetailPage = () => {
  const { taskId } = useParams()
  const navigate = useNavigate()
  const numericId = taskId ? Number(taskId) : null

  if (!numericId) {
    return null
  }

  const handleClose = () => {
    if (window.history.state && window.history.length > 1) {
      navigate(-1)
    } else {
      navigate('/app/tasks')
    }
  }

  return <TaskDetailModal taskId={numericId} onClose={handleClose} />
}

export default TaskDetailPage
