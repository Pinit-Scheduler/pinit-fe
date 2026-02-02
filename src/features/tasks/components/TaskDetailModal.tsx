import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { completeTask, createScheduleFromTask, deleteTask, fetchTaskDetail, reopenTask } from '../api/tasks'
import type { Task } from '../types/task'
import { getDifficultyStyle, getImportanceStyle } from '@shared/utils/priorityStyles'
import TaskScheduleModal from './TaskScheduleModal'
import { useTaskCache } from '@contexts/TaskCacheContext'
import { useToast } from '@contexts/ToastContext'
import { dispatchScheduleChanged, dispatchTaskChanged } from '@shared/utils/events'
import { getDeadlineStyle } from '@shared/utils/deadlineStyles'
import { formatDateWithOffset } from '@shared/utils/datetime'
import './TaskDetailModal.css'

type TaskDetailModalProps = {
  taskId: number
  onClose: () => void
}

const TaskDetailModal = ({ taskId, onClose }: TaskDetailModalProps) => {
  const { tasksById, setTask, removeTask } = useTaskCache()
  const { addToast } = useToast()
  const navigate = useNavigate()
  const [task, setTaskState] = useState<Task | null>(tasksById[taskId] ?? null)
  const [isLoading, setIsLoading] = useState(!tasksById[taskId])
  const [error, setError] = useState<string | null>(null)
  const [showScheduleModal, setShowScheduleModal] = useState(false)
  const [isToggling, setIsToggling] = useState(false)

  useEffect(() => {
    const cached = tasksById[taskId]
    if (cached) {
      setTaskState(cached)
      setIsLoading(false)
    }
  }, [taskId, tasksById])

  useEffect(() => {
    let mounted = true
    const load = async () => {
      setIsLoading(true)
      setError(null)
      try {
        const data = await fetchTaskDetail(taskId)
        if (!mounted) return
        setTaskState(data)
        setTask(data)
      } catch (err) {
        if (!mounted) return
        setError(err instanceof Error ? err.message : '작업을 불러오지 못했습니다.')
      } finally {
        if (mounted) setIsLoading(false)
      }
    }
    if (!tasksById[taskId]) {
      load()
    }
    return () => {
      mounted = false
    }
  }, [setTask, taskId, tasksById])

  const toggleCompletion = async () => {
    if (!task) return
    setIsToggling(true)
    try {
      if (task.completed ?? task.isCompleted) {
        await reopenTask(task.id)
      } else {
        await completeTask(task.id)
      }
      const nextCompleted = !(task.completed ?? task.isCompleted ?? false)
      const next = { ...task, completed: nextCompleted, isCompleted: nextCompleted }
      setTaskState(next)
      setTask(next)
      dispatchTaskChanged(task.id, nextCompleted ? 'complete' : 'reopen')
      addToast(nextCompleted ? '작업을 완료했어요.' : '작업을 미완료로 전환했어요.', 'success')
    } catch (err) {
      console.error('작업 상태 변경 실패', err)
      addToast('완료 상태를 변경하지 못했습니다.', 'error')
    } finally {
      setIsToggling(false)
    }
  }

  const handleDelete = async () => {
    if (!task) return
    if (!window.confirm('작업을 삭제하시겠습니까?')) return
    try {
      await deleteTask(task.id, false)
      removeTask(task.id)
      dispatchTaskChanged(task.id, 'delete')
      addToast('작업을 삭제했습니다.', 'success')
      onClose()
    } catch (err) {
      console.error('작업 삭제 실패', err)
      addToast('작업 삭제에 실패했습니다.', 'error')
    }
  }

  const handleAssignSchedule = async (payload: Parameters<typeof createScheduleFromTask>[1]) => {
    if (!task) return
    try {
      await createScheduleFromTask(task.id, payload)
      dispatchScheduleChanged({ reason: 'task-assigned', scheduleId: undefined })
      addToast('일정으로 배정했어요.', 'success')
      setShowScheduleModal(false)
    } catch (err) {
      console.error('작업 일정 배정 실패', err)
      addToast('일정으로 배정하지 못했습니다.', 'error')
    }
  }

  return (
    <div className="task-detail-modal__backdrop" onClick={onClose}>
      <div className="task-detail-modal__content" onClick={(e) => e.stopPropagation()}>
        {isLoading ? (
          <p className="task-detail-modal__loading">작업 정보를 불러오는 중...</p>
        ) : error || !task ? (
          <div className="task-detail-modal__body">
            <p className="task-detail-modal__loading">작업 정보를 불러오지 못했습니다.</p>
            <p className="task-detail-modal__description">{error}</p>
            <button
              type="button"
              className="task-detail-modal__action-btn task-detail-modal__action-btn--delete"
              onClick={onClose}
            >
              닫기
            </button>
          </div>
        ) : (
          <>
            <header className="task-detail-modal__header">
              <h1>작업 상세</h1>
              <button
                className="task-detail-modal__close"
                onClick={(e) => {
                  e.stopPropagation()
                  onClose()
                }}
                aria-label="닫기"
              >
                ✕
              </button>
            </header>
            <div className="task-detail-modal__body">
              <section className="task-detail-modal__section">
                <h2>{task.title}</h2>
                <p className="task-detail-modal__description">{task.description}</p>
                <div className="task-detail-modal__meta">
                  <span className="task-detail-modal__badge task-detail-modal__badge--state">
                    {(task.completed ?? task.isCompleted) ? '완료' : '미완료'}
                  </span>
                  <span className="task-detail-modal__badge" style={getImportanceStyle(task.importance)}>
                    중요도 {task.importance}
                  </span>
                  <span className="task-detail-modal__badge" style={getDifficultyStyle(task.difficulty)}>
                    난이도 {task.difficulty}
                  </span>
                  {task.dueDate && (
                    <span className="task-detail-modal__badge" style={getDeadlineStyle(task.dueDate)}>
                      마감 {formatDateWithOffset(task.dueDate, 'M/D')}
                    </span>
                  )}
                </div>
              </section>

              <section className="task-detail-modal__section">
                <h3>의존성</h3>
                <p className="task-detail-modal__description">
                  이전 작업: {task.previousTaskIds?.length ?? 0}개 / 이후 작업: {task.nextTaskIds?.length ?? 0}개
                </p>
              </section>

              <footer className="task-detail-modal__actions">
                <button
                  type="button"
                  onClick={() => {
                    onClose()
                    navigate(`/app/tasks/${task.id}/edit`)
                  }}
                  className="task-detail-modal__action-btn task-detail-modal__action-btn--edit"
                >
                  ✏️ 수정
                </button>
                <button
                  type="button"
                  onClick={toggleCompletion}
                  className="task-detail-modal__action-btn task-detail-modal__action-btn--primary"
                  disabled={isToggling}
                >
                  {task.isCompleted ? '미완료로 전환' : '완료 처리'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowScheduleModal(true)}
                  className="task-detail-modal__action-btn"
                >
                  📅 일정으로 배정
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  className="task-detail-modal__action-btn task-detail-modal__action-btn--delete"
                >
                  🗑️ 삭제
                </button>
              </footer>
            </div>
          </>
        )}
      </div>
      <TaskScheduleModal
        isOpen={showScheduleModal}
        onClose={() => setShowScheduleModal(false)}
        onSubmit={handleAssignSchedule}
        defaultTitle={task?.title}
        defaultDescription={task?.description}
        taskLabel={task ? `작업 #${task.id}` : undefined}
      />
    </div>
  )
}

export default TaskDetailModal
