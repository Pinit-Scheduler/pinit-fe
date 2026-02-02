import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import TaskForm from '../components/TaskForm'
import type { TaskFormValues } from '../components/TaskForm'
import { fetchTaskDetail, updateTask } from '../api/tasks'
import { toApiDateWithOffset, toDayjsFromDateWithOffset } from '@shared/utils/datetime'
import type { Task } from '../types/task'
import { useTaskCache } from '@contexts/TaskCacheContext'
import { useToast } from '@contexts/ToastContext'
import { dispatchTaskChanged } from '@shared/utils/events'
import './TaskPages.css'

const TaskEditPage = () => {
  const { taskId } = useParams()
  const navigate = useNavigate()
  const numericId = taskId ? Number(taskId) : null
  const [task, setTask] = useState<Task | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [initialPrevIds, setInitialPrevIds] = useState<number[]>([])
  const [initialNextIds, setInitialNextIds] = useState<number[]>([])
  const { setTask: cacheSetTask } = useTaskCache()
  const { addToast } = useToast()

  useEffect(() => {
    if (!numericId) return
    let mounted = true
    const load = async () => {
      setIsLoading(true)
      setError(null)
      try {
        const data = await fetchTaskDetail(numericId)
        if (!mounted) return
        setTask(data)
        setInitialPrevIds(data.previousTaskIds ?? [])
        setInitialNextIds(data.nextTaskIds ?? [])
      } catch (err) {
        if (!mounted) return
        setError(err instanceof Error ? err.message : '작업을 불러오지 못했습니다.')
      } finally {
        if (mounted) setIsLoading(false)
      }
    }
    load()
    return () => {
      mounted = false
    }
  }, [numericId])

  const handleSubmit = async (values: TaskFormValues) => {
    if (!numericId) return
    try {
      const payload = {
        title: values.title,
        description: values.description,
        dueDate: toApiDateWithOffset(values.dueDate),
        importance: values.importance,
        difficulty: values.difficulty,
        addDependencies: [
          ...values.previousTaskIds
            .filter((id) => !initialPrevIds.includes(id))
            .map((fromId) => ({ fromId, toId: numericId })),
          ...values.nextTaskIds
            .filter((id) => !initialNextIds.includes(id))
            .map((toId) => ({ fromId: numericId, toId })),
        ],
        removeDependencies: [
          ...initialPrevIds
            .filter((id) => !values.previousTaskIds.includes(id))
            .map((fromId) => ({ fromId, toId: numericId })),
          ...initialNextIds
            .filter((id) => !values.nextTaskIds.includes(id))
            .map((toId) => ({ fromId: numericId, toId })),
        ],
      }
      const updated = await updateTask(numericId, payload)
      cacheSetTask(updated)
      dispatchTaskChanged(numericId, 'update')
      addToast('작업을 수정했어요.', 'success')
      navigate('/app/tasks')
    } catch (err) {
      console.error('작업 수정 실패', err)
      addToast('작업을 수정하지 못했습니다.', 'error')
    }
  }

  if (!numericId) {
    return (
      <section className="task-page">
        <div className="task-page__placeholder">
          <p>유효하지 않은 작업 ID입니다.</p>
        </div>
      </section>
    )
  }

  return (
    <section className="task-page">
      <header className="task-page__header">
        <p className="task-page__eyebrow">작업 수정</p>
        <h1 className="task-page__title">작업 업데이트</h1>
        <p className="task-page__description">Task 상세를 불러와 폼에 채워 수정합니다.</p>
      </header>
      {isLoading ? (
        <div className="task-page__placeholder">
          <p>작업 정보를 불러오는 중...</p>
        </div>
      ) : error || !task ? (
        <div className="task-page__placeholder">
          <p>작업 정보를 불러오지 못했습니다.</p>
          <p>{error}</p>
        </div>
      ) : (
        <TaskForm
          initialValues={{
            title: task.title,
            description: task.description,
            dueDate: toDayjsFromDateWithOffset(task.dueDate).format('YYYY-MM-DD'),
            importance: task.importance,
            difficulty: task.difficulty as TaskFormValues['difficulty'],
            previousTaskIds: initialPrevIds,
            nextTaskIds: initialNextIds,
          }}
          onSubmit={handleSubmit}
          submitLabel="작업 수정"
        />
      )}
    </section>
  )
}

export default TaskEditPage
