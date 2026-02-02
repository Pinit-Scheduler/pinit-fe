import { useEffect, useState } from 'react'
import './TaskDependencyModal.css'
import { fetchTasks } from '../../api/tasks'
import type { Task } from '../../types/task'

type TaskDependencyModalProps = {
  isOpen: boolean
  onClose: () => void
  selectedIds: number[]
  onApply: (tasks: Task[]) => void
  title: string
}

const TaskDependencyModal = ({ isOpen, onClose, selectedIds, onApply, title }: TaskDependencyModalProps) => {
  const [tasks, setTasks] = useState<Task[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [localSelection, setLocalSelection] = useState<number[]>(selectedIds)

  useEffect(() => setLocalSelection(selectedIds), [selectedIds])

  useEffect(() => {
    if (!isOpen) return
    let mounted = true
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetchTasks({ page: 0, size: 50, readyOnly: false })
        if (!mounted) return
        setTasks(res.content ?? [])
      } catch (err) {
        if (!mounted) return
        setError(err instanceof Error ? err.message : '작업을 불러오지 못했습니다.')
      } finally {
        if (mounted) setLoading(false)
      }
    }
    load()
    return () => {
      mounted = false
    }
  }, [isOpen])

  const toggle = (id: number) => {
    setLocalSelection((prev) => (prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]))
  }

  const handleApply = () => {
    const selected = tasks.filter((t) => localSelection.includes(t.id))
    onApply(selected)
    onClose()
  }

  if (!isOpen) return null

  return (
    <div className="task-dep-modal__backdrop" onClick={onClose}>
      <div className="task-dep-modal__content" onClick={(e) => e.stopPropagation()}>
        <header className="task-dep-modal__header">
          <h1>{title}</h1>
          <button type="button" onClick={onClose} aria-label="닫기">✕</button>
        </header>
        <div className="task-dep-modal__body">
          {loading ? (
            <p>불러오는 중...</p>
          ) : error ? (
            <p className="task-dep-modal__error">{error}</p>
          ) : tasks.length === 0 ? (
            <p>선택할 작업이 없습니다.</p>
          ) : (
            <ul className="task-dep-modal__list">
              {tasks.map((task) => {
                const checked = localSelection.includes(task.id)
                return (
                  <li key={task.id}>
                    <label className={checked ? 'is-checked' : ''}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(task.id)}
                      />
                      <div>
                        <strong>{task.title}</strong>
                        <small>{task.description}</small>
                      </div>
                    </label>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
        <footer className="task-dep-modal__footer">
          <button type="button" onClick={onClose}>취소</button>
          <button type="button" onClick={handleApply} disabled={localSelection.length === 0}>추가</button>
        </footer>
      </div>
    </div>
  )
}

export default TaskDependencyModal
