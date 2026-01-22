import { useCallback, useEffect, useState } from 'react'
import type { ChangeEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import { completeTask, fetchTasks, reopenTask } from '../../api/tasks'
import type { Task } from '../../types/task'
import { getDifficultyStyle, getImportanceStyle } from '../../utils/priorityStyles'
import { useTaskCache } from '../../context/TaskCacheContext'
import { useToast } from '../../context/ToastContext'
import { dispatchTaskChanged } from '../../utils/events'
import TaskDetailModal from '../../components/tasks/TaskDetailModal'
import './TaskPages.css'

const TaskListPage = () => {
  const navigate = useNavigate()
  const { tasksById, setTask } = useTaskCache()
  const { addToast } = useToast()
  const [tasks, setTasks] = useState<Task[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<number | null>(null)
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null)

  const load = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const response = await fetchTasks({ page: 0, size: 20, readyOnly: false })
      setTasks(response.content ?? [])
      ;(response.content ?? []).forEach(setTask)
    } catch (err) {
      setError(err instanceof Error ? err.message : '작업을 불러오지 못했습니다.')
    } finally {
      setIsLoading(false)
    }
  }, [setTask])

  useEffect(() => {
    load().catch(() => {})
  }, [load])

  useEffect(() => {
    const refetchOnChange = () => load()
    window.addEventListener('task:changed', refetchOnChange)
    window.addEventListener('schedule:changed', refetchOnChange)
    return () => {
      window.removeEventListener('task:changed', refetchOnChange)
      window.removeEventListener('schedule:changed', refetchOnChange)
    }
  }, [load])

  const toggleCompletion = async (task: Task, event: ChangeEvent<HTMLInputElement>) => {
    event.stopPropagation()
    if (togglingId === task.id) return
    setTogglingId(task.id)
    const isCompleted = task.isCompleted
    try {
      if (isCompleted) {
        await reopenTask(task.id)
      } else {
        await completeTask(task.id)
      }
      const updated = { ...task, isCompleted: !isCompleted }
      setTask(updated)
      setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, isCompleted: !isCompleted } : t)))
      dispatchTaskChanged(task.id, isCompleted ? 'reopen' : 'complete')
      addToast(isCompleted ? '작업을 미완료로 전환했어요.' : '작업을 완료했어요.', 'success')
    } catch (err) {
      console.error('작업 완료 상태 변경 실패', err)
      addToast('완료 상태를 변경하지 못했습니다.', 'error')
    } finally {
      setTogglingId(null)
    }
  }

  return (
    <section className="task-page">
      <header className="task-page__header">
        <p className="task-page__eyebrow">작업</p>
        <h1 className="task-page__title">작업 목록</h1>
        <p className="task-page__description">v1 Task API 연동 후 작업/의존성/마감일을 표시합니다.</p>
        <div className="task-page__actions">
          <button type="button" onClick={() => navigate('/app/tasks/new')} className="task-page__primary">
            새 작업 추가
          </button>
        </div>
      </header>
      {isLoading ? (
        <div className="task-page__placeholder">
          <p>작업을 불러오는 중...</p>
        </div>
      ) : error ? (
        <div className="task-page__placeholder">
          <p>작업을 불러오지 못했습니다.</p>
          <p>{error}</p>
        </div>
      ) : tasks.length === 0 ? (
        <div className="task-page__placeholder">
          <p>등록된 작업이 없습니다.</p>
        </div>
      ) : (
        <ul className="task-page__list">
          {tasks.map((task) => {
            const cached = tasksById[task.id]
            const item = cached ?? task
            return (
              <li key={task.id} className="task-page__item" onClick={() => setSelectedTaskId(task.id)}>
                <div className="task-page__item-head">
                  <label className="task-page__checkbox" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={item.isCompleted}
                      onChange={(e) => toggleCompletion(item, e)}
                      disabled={togglingId === task.id}
                    />
                    <span className="task-page__checkbox-mark" aria-hidden />
                  </label>
                  <div>
                    <strong>{item.title}</strong>
                    <p className="task-page__item-desc">{item.description}</p>
                  </div>
                </div>
                <div className="task-page__item-meta">
                  {item.dueDate && (
                    <span className="task-page__pill">
                      마감 {dayjs(item.dueDate.dateTime).format('M/D HH:mm')}
                    </span>
                  )}
                  <span className="task-page__pill" style={getImportanceStyle(item.importance)}>
                    중요도 {item.importance}
                  </span>
                  <span className="task-page__pill" style={getDifficultyStyle(item.difficulty)}>
                    난이도 {item.difficulty}
                  </span>
                  <span className="task-page__pill">{item.isCompleted ? '완료' : '미완료'}</span>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {selectedTaskId && (
        <TaskDetailModal taskId={selectedTaskId} onClose={() => setSelectedTaskId(null)} />
      )}
    </section>
  )
}

export default TaskListPage
