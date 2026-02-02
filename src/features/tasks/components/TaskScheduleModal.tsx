import { useEffect, useState } from 'react'
import dayjs from 'dayjs'
import './TaskScheduleModal.css'
import { toApiDateTimeWithZone } from '@shared/utils/datetime'
import type { TaskScheduleRequest } from '../types/task'

type TaskScheduleModalProps = {
  isOpen: boolean
  onClose: () => void
  onSubmit: (payload: TaskScheduleRequest) => Promise<void>
  defaultTitle?: string
  defaultDescription?: string
  taskLabel?: string
}

const TaskScheduleModal = ({
  isOpen,
  onClose,
  onSubmit,
  defaultTitle,
  defaultDescription,
  taskLabel,
}: TaskScheduleModalProps) => {
  const [date, setDate] = useState(() => dayjs().minute(0).second(0).toDate())
  const [scheduleType, setScheduleType] = useState<TaskScheduleRequest['scheduleType']>('DEEP_WORK')
  const [title, setTitle] = useState(defaultTitle ?? '')
  const [description, setDescription] = useState(defaultDescription ?? '')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    setDate(dayjs().minute(0).second(0).toDate())
    setScheduleType('DEEP_WORK')
    setTitle(defaultTitle ?? '')
    setDescription(defaultDescription ?? '')
  }, [isOpen, defaultDescription, defaultTitle])

  if (!isOpen) return null

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSubmitting(true)
    try {
      await onSubmit({
        title: title || undefined,
        description: description || undefined,
        scheduleType,
        date: toApiDateTimeWithZone(date),
      })
      onClose()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="task-sched-modal__backdrop" onClick={onClose}>
      <div className="task-sched-modal__content" onClick={(e) => e.stopPropagation()}>
        <header className="task-sched-modal__header">
          <div>
            <p className="task-sched-modal__eyebrow">일정으로 배정</p>
            <h1>{taskLabel ?? '작업'}</h1>
          </div>
          <button onClick={onClose} aria-label="닫기" className="task-sched-modal__close">✕</button>
        </header>
        <form className="task-sched-modal__body" onSubmit={handleSubmit}>
          <label className="task-sched-modal__field">
            <div className="task-sched-modal__field-head">
              <span>시작 시각</span>
              <button type="button" onClick={() => setDate(dayjs().minute(0).second(0).toDate())}>
                지금으로 설정
              </button>
            </div>
            <input
              type="datetime-local"
              value={dayjs(date).format('YYYY-MM-DDTHH:mm')}
              onChange={(e) => setDate(dayjs(e.target.value).toDate())}
            />
          </label>

          <div className="task-sched-modal__field">
            <span>유형</span>
            <div className="task-sched-modal__chips">
              {[
                { value: 'DEEP_WORK', label: '집중' },
                { value: 'QUICK_TASK', label: '빠른' },
                { value: 'ADMIN_TASK', label: '행정' },
              ].map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={['task-sched-modal__chip', scheduleType === opt.value ? 'is-active' : ''].join(' ').trim()}
                  onClick={() => setScheduleType(opt.value as TaskScheduleRequest['scheduleType'])}
                  aria-pressed={scheduleType === opt.value}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <label className="task-sched-modal__field">
            <span>일정 제목</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="작업 제목을 기본값으로 설정했어요" />
          </label>
          <label className="task-sched-modal__field">
            <span>일정 설명</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="작업 설명을 기본값으로 설정했어요"
            />
          </label>
          <footer className="task-sched-modal__footer">
            <button type="button" onClick={onClose} className="task-sched-modal__ghost">취소</button>
            <button type="submit" disabled={submitting} className="task-sched-modal__primary">
              {submitting ? '배정 중...' : '일정 생성'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  )
}

export default TaskScheduleModal
