import WorkspaceIcon from '@shared/components/common/WorkspaceIcon'
import { useEffect, useState, useId, useRef } from 'react'
import Modal from '@shared/components/common/Modal'
import { usePresence } from '@shared/motion'
import dayjs from 'dayjs'
import './TaskScheduleModal.css'
import { toApiDateTimeWithZone } from '@shared/utils/datetime'
import type { TaskScheduleRequest } from '../types/task'
import { CONFLICT_RELOADED, isEditConflict } from '@features/spaces/conflicts'

type TaskScheduleModalProps = {
  isOpen: boolean
  onClose: () => void
  expectedVersion?: number
  onSubmit: (
    payload: TaskScheduleRequest,
    expectedVersion?: number,
  ) => Promise<void>
  defaultTitle?: string
  defaultDescription?: string
  taskLabel?: string
  /** 409 뒤 작업을 다시 받아 최신 버전을 돌려준다. 입력은 그대로 두고 자동으로 다시 보내지 않는다. */
  onConflict?: () => Promise<number | undefined>
}

const TaskScheduleModal = ({
  isOpen,
  onClose,
  onSubmit,
  defaultTitle,
  defaultDescription,
  expectedVersion,
  taskLabel,
  onConflict,
}: TaskScheduleModalProps) => {
  const titleId = useId()
  const dateId = useId()
  const initialized = useRef(false)
  const capturedVersion = useRef(expectedVersion)
  const submissionLock = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [date, setDate] = useState(() => dayjs().minute(0).second(0).toDate())
  const [scheduleType, setScheduleType] =
    useState<TaskScheduleRequest['scheduleType']>('DEEP_WORK')
  const [title, setTitle] = useState(defaultTitle ?? '')
  const [description, setDescription] = useState(defaultDescription ?? '')
  const [submitting, setSubmitting] = useState(false)
  // Stays mounted through its exit; the form keeps what was entered while it fades.
  const presence = usePresence(isOpen)

  useEffect(() => {
    if (!isOpen) {
      initialized.current = false
      return
    }
    if (initialized.current) return
    initialized.current = true
    capturedVersion.current = expectedVersion
    setError(null)
    setDate(dayjs().minute(0).second(0).toDate())
    setScheduleType('DEEP_WORK')
    setTitle(defaultTitle ?? '')
    setDescription(defaultDescription ?? '')
  }, [isOpen, defaultDescription, defaultTitle, expectedVersion])

  if (!presence.mounted) return null

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (submissionLock.current) return
    submissionLock.current = true
    setSubmitting(true)
    setError(null)
    try {
      await onSubmit(
        {
          title: title || undefined,
          description: description || undefined,
          scheduleType,
          date: toApiDateTimeWithZone(date),
        },
        capturedVersion.current,
      )
      onClose()
    } catch (failure) {
      if (isEditConflict(failure) && onConflict) {
        try {
          capturedVersion.current = await onConflict()
          setError(CONFLICT_RELOADED)
        } catch {
          setError(
            '다른 참여자가 먼저 수정했어요. 최신 내용을 불러오지 못했으니 닫았다가 다시 열어 주세요.',
          )
        }
      } else
        setError(
          failure instanceof Error
            ? failure.message
            : '일정을 배정하지 못했어요. 입력한 내용은 유지됩니다.',
        )
    } finally {
      submissionLock.current = false
      setSubmitting(false)
    }
  }

  return (
    <Modal
      backdropClassName="task-sched-modal__backdrop"
      className="task-sched-modal__content"
      onClose={submitting ? undefined : onClose}
      labelledBy={titleId}
      closing={presence.closing}
    >
      <header className="task-sched-modal__header">
        <div>
          <p className="task-sched-modal__eyebrow">일정으로 배정</p>
          <h1 id={titleId}>{taskLabel ?? '작업'}</h1>
        </div>
        <button
          disabled={submitting}
          onClick={onClose}
          aria-label="닫기"
          className="task-sched-modal__close"
        >
          <WorkspaceIcon name="close" />
        </button>
      </header>
      <form className="task-sched-modal__body" onSubmit={handleSubmit}>
        <div className="task-sched-modal__field">
          <div className="task-sched-modal__field-head">
            <label htmlFor={dateId}>시작 시각</label>
            <button
              type="button"
              onClick={() => setDate(dayjs().minute(0).second(0).toDate())}
            >
              지금으로 설정
            </button>
          </div>
          <input
            id={dateId}
            type="datetime-local"
            value={dayjs(date).format('YYYY-MM-DDTHH:mm')}
            onChange={(e) => setDate(dayjs(e.target.value).toDate())}
          />
        </div>

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
                className={[
                  'task-sched-modal__chip',
                  scheduleType === opt.value ? 'is-active' : '',
                ]
                  .join(' ')
                  .trim()}
                onClick={() =>
                  setScheduleType(
                    opt.value as TaskScheduleRequest['scheduleType'],
                  )
                }
                aria-pressed={scheduleType === opt.value}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <label className="task-sched-modal__field">
          <span>일정 제목</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="작업 제목을 기본값으로 설정했어요"
          />
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
        {error && (
          <p role="alert" className="space-error">
            {error}
          </p>
        )}
        <footer className="task-sched-modal__footer">
          <button
            type="button"
            disabled={submitting}
            onClick={onClose}
            className="task-sched-modal__ghost"
          >
            취소
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="task-sched-modal__primary"
          >
            {submitting ? '배정 중...' : '일정 생성'}
          </button>
        </footer>
      </form>
    </Modal>
  )
}

export default TaskScheduleModal
