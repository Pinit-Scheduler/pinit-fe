import { useNavigate } from 'react-router-dom'
import TaskForm from '../components/TaskForm'
import type { TaskFormValues } from '../components/TaskForm'
import { createTask } from '../api/tasks'
import { useTaskCache } from '@contexts/TaskCacheContext'
import { useToast } from '@contexts/ToastContext'
import { toApiDateWithOffset } from '@shared/utils/datetime'
import { dispatchTaskChanged } from '@shared/utils/events'
import './TaskPages.css'

const TaskCreatePage = () => {
  const navigate = useNavigate()
  const { setTask } = useTaskCache()
  const { addToast } = useToast()

  const handleSubmit = async (values: TaskFormValues) => {
    try {
      const payload = {
        title: values.title,
        description: values.description,
        dueDate: toApiDateWithOffset(values.dueDate),
        importance: values.importance,
        difficulty: values.difficulty,
        addDependencies: [
          // 새 작업 이전에 해야 할 작업: fromId=선행, toId=0
          ...values.previousTaskIds.map((fromId) => ({ fromId, toId: 0 })),
          // 새 작업 이후에 해야 할 작업: fromId=0, toId=후행
          ...values.nextTaskIds.map((toId) => ({ fromId: 0, toId })),
        ],
      }
      const created = await createTask(payload)
      setTask(created)
      dispatchTaskChanged(created.id, 'create')
      navigate('/app/tasks')
    } catch (error) {
      console.error('작업 생성 실패', error)
      addToast('작업을 생성하지 못했습니다.', 'error')
    }
  }

  return (
    <section className="task-page">
      <header className="task-page__header">
        <p className="task-page__eyebrow">새 작업</p>
        <h1 className="task-page__title">작업 추가</h1>
        <p className="task-page__description">Task 폼과 의존성 선택 모달을 연결할 예정입니다.</p>
      </header>
      <TaskForm onSubmit={handleSubmit} submitLabel="작업 생성" />
    </section>
  )
}

export default TaskCreatePage
