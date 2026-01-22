import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import { fetchTaskDetail, completeTask, reopenTask, deleteTask } from '../../api/tasks'
import type { Task } from '../../types/task'
import { getDifficultyStyle, getImportanceStyle } from '../../utils/priorityStyles'
import { createScheduleFromTask } from '../../api/tasks'
import TaskScheduleModal from '../../components/tasks/TaskScheduleModal'
import { useTaskCache } from '../../context/TaskCacheContext'
import { useToast } from '../../context/ToastContext'
import './TaskPages.css'

const TaskDetailPage = () => {
  const { taskId } = useParams()
  const navigate = useNavigate()
  const [task, setTask] = useState<Task | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showScheduleModal, setShowScheduleModal] = useState(false)
  const { tasksById, setTask: cacheSetTask, removeTask } = useTaskCache()
  const { addToast } = useToast()
  const numericId = taskId ? Number(taskId) : null

  const cached = numericId ? tasksById[numericId] : null

  useEffect(() => {
    if (!cached) return
    setTask(cached)
    setIsLoading(false)
  }, [cached])

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
        cacheSetTask(data)
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
  }, [numericId, cacheSetTask])

  const toggleCompletion = async () => {
    if (!numericId) return
    try {
      if (task?.isCompleted) {
        await reopenTask(numericId)
        setTask((prev) => (prev ? { ...prev, isCompleted: false } : prev))
      } else {
        await completeTask(numericId)
        setTask((prev) => (prev ? { ...prev, isCompleted: true } : prev))
      }
    } catch (err) {
      console.error('작업 상태 변경 실패', err)
    }
  }

  const handleDelete = async () => {
    if (!numericId) return
    if (!window.confirm('작업을 삭제하시겠습니까?')) return
    try {
      await deleteTask(numericId, false)
      navigate('/app/tasks')
      removeTask(numericId)
      window.dispatchEvent(new CustomEvent('task:changed', { detail: { taskId: numericId, reason: 'delete' } }))
    } catch (err) {
      console.error('작업 삭제 실패', err)
    }
  }

  const handleAssignSchedule = async (payload: Parameters<typeof createScheduleFromTask>[1]) => {
    if (!numericId) return
    try {
      await createScheduleFromTask(numericId, payload)
      window.dispatchEvent(new CustomEvent('schedule:changed', { detail: { reason: 'task-assigned' } }))
      addToast('일정으로 배정했어요.', 'success')
      navigate('/app/tasks')
    } catch (err) {
      console.error('작업 일정 배정 실패', err)
      addToast('일정으로 배정하지 못했습니다.', 'error')
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
        <p className="task-page__eyebrow">작업 상세</p>
        <h1 className="task-page__title">작업 정보</h1>
        <p className="task-page__description">
          Task API 연동 후 의존성/배정 버튼 등 추가 기능을 붙일 예정입니다.
        </p>
        <div className="task-page__actions">
          <button
            type="button"
            onClick={() => navigate(`/app/tasks/${taskId}/edit`)}
            className="task-page__primary"
          >
            수정
          </button>
          <button type="button" onClick={toggleCompletion} className="task-page__primary">
            {task?.isCompleted ? '미완료로 되돌리기' : '완료 처리'}
          </button>
          <button type="button" onClick={handleDelete} className="task-page__primary">
            삭제
          </button>
          <button type="button" onClick={() => setShowScheduleModal(true)} className="task-page__primary">
            일정으로 배정
          </button>
        </div>
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
        <div className="task-page__placeholder">
          <p><strong>제목</strong>: {task.title}</p>
          <p><strong>설명</strong>: {task.description}</p>
          {task.dueDate && (
            <p>
              <strong>마감</strong>: {dayjs(task.dueDate.dateTime).format('YYYY-MM-DD HH:mm')}
            </p>
          )}
          <p><strong>상태</strong>: {task.isCompleted ? '완료' : '미완료'}</p>
          <p>
            <strong>중요도</strong>:{' '}
            <span className="task-page__pill" style={getImportanceStyle(task.importance)}>
              {task.importance}
            </span>
          </p>
          <p>
            <strong>난이도</strong>:{' '}
            <span className="task-page__pill" style={getDifficultyStyle(task.difficulty)}>
              {task.difficulty}
            </span>
          </p>
        </div>
      )}

      <TaskScheduleModal
        isOpen={showScheduleModal}
        onClose={() => setShowScheduleModal(false)}
        onSubmit={handleAssignSchedule}
      />
    </section>
  )
}

export default TaskDetailPage
