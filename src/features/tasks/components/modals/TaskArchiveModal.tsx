import WorkspaceIcon from '@shared/components/common/WorkspaceIcon'
import { useCallback, useEffect, useRef, useState, useId } from 'react'
import type { CSSProperties } from 'react'
import Modal from '@shared/components/common/Modal'
import { arrivalIndex, useArrival, usePresence } from '@shared/motion'
import { fetchTaskArchiveByCursor } from '../../api/tasks'
import type { Task } from '../../types/task'
import { formatDateWithOffset } from '@shared/utils/datetime'
import { getDeadlineStyle } from '@shared/utils/deadlineStyles'
import { getDifficultyStyle, getImportanceStyle } from '@shared/utils/priorityStyles'
import { getRequestFailureMessage } from '@shared/api/errorMessage'
import './TaskArchiveModal.css'

const PAGE_SIZE = 20

type TaskArchiveModalProps = {
  /** Keep the modal rendered and toggle this, so it can fade out. */
  open?: boolean
  onClose: () => void
}

/** Plays its exit before unmounting. Each opening starts a fresh archive read. */
const TaskArchiveModal = ({ open = true, onClose }: TaskArchiveModalProps) => {
  const presence = usePresence(open)
  return presence.mounted ? (
    <ArchiveDialog onClose={onClose} closing={presence.closing} />
  ) : null
}

const ArchiveDialog = ({
  onClose,
  closing,
}: {
  onClose: () => void
  closing: boolean
}) => {
  const titleId = useId()
  const [tasks, setTasks] = useState<Task[]>([])
  const [hasNext, setHasNext] = useState(true)
  const [isLoading, setIsLoading] = useState(false)
  const [initialLoaded, setInitialLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const cursorRef = useRef<string | null>(null)
  const loadingRef = useRef(false)

  const load = useCallback(async ({ reset = false }: { reset?: boolean } = {}) => {
    if (loadingRef.current) return
    loadingRef.current = true
    setIsLoading(true)
    if (reset) {
      setError(null)
      setHasNext(true)
      cursorRef.current = null
    }
    try {
      const response = await fetchTaskArchiveByCursor({ size: PAGE_SIZE, cursor: reset ? null : cursorRef.current })
      setTasks((prev) => (reset ? response.items : [...prev, ...response.items]))
      cursorRef.current = response.nextCursor ?? null
      const nextHasMore = response.hasNext ?? Boolean(response.nextCursor)
      setHasNext(nextHasMore)
      setError(null)
    } catch (err) {
      const message = getRequestFailureMessage(err, '아카이브 작업을 불러오지 못했어요.')
      setError(message)
      setHasNext(false)
    } finally {
      setIsLoading(false)
      loadingRef.current = false
      setInitialLoaded(true)
    }
  }, [])

  useEffect(() => {
    load({ reset: true }).catch(() => {})
  }, [load])

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !isLoading && hasNext) {
          load()
        }
      },
      {
        root: scrollRef.current,
        rootMargin: '120px',
      },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasNext, isLoading, load])

  const handleRetry = () => load({ reset: tasks.length === 0 })
  const arriving = useArrival(!initialLoaded)

  return (
    <Modal
      backdropClassName="task-archive-modal__backdrop"
      className="task-archive-modal__content"
      onClose={onClose}
      labelledBy={titleId}
      closing={closing}
    >
      <header className="task-archive-modal__header">
        <div>
          <p className="task-archive-modal__eyebrow">완료 · 마감 지난 작업</p>
          <h1 id={titleId}>작업 아카이브</h1>
          <p className="task-archive-modal__hint">완료되었고 마감이 지난 작업이 최신순으로 표시됩니다.</p>
        </div>
        <button type="button" className="task-archive-modal__close" onClick={onClose} aria-label="닫기"><WorkspaceIcon name="close" /></button>
      </header>
      <div className="task-archive-modal__body" ref={scrollRef}>
        {error && tasks.length === 0 ? (
          <div className="task-archive-modal__placeholder">
            <p>아카이브를 불러오지 못했습니다.</p>
            <p className="task-archive-modal__error">{error}</p>
            <button type="button" className="task-archive-modal__ghost" onClick={handleRetry}>다시 시도</button>
          </div>
        ) : !initialLoaded ? (
          <div className="task-archive-modal__placeholder task-archive-modal__placeholder--loading">
            불러오는 중...
          </div>
        ) : tasks.length === 0 ? (
          <div className="task-archive-modal__placeholder">아카이브된 작업이 없습니다.</div>
        ) : (
          <ul className="task-archive-modal__list">
            {tasks.map((task, index) => (
              <li
                key={task.id}
                className="task-archive-modal__item"
                data-arrive={arriving || undefined}
                style={
                  arriving
                    ? ({
                        // Later pages rise in at once, without waiting on the first page's stagger.
                        '--arrive-index': index < PAGE_SIZE ? arrivalIndex(index) : 0,
                      } as CSSProperties)
                    : undefined
                }
              >
                <div className="task-archive-modal__item-head">
                  <strong>{task.title}</strong>
                  <p className="task-archive-modal__item-desc">{task.description}</p>
                </div>
                <div className="task-archive-modal__item-meta">
                  {task.dueDate && (
                    <span className="task-archive-modal__pill" style={getDeadlineStyle(task.dueDate)}>
                      마감 {formatDateWithOffset(task.dueDate, 'M/D')}
                    </span>
                  )}
                  <span className="task-archive-modal__pill task-archive-modal__pill--state">완료</span>
                  <span className="task-archive-modal__pill" style={getImportanceStyle()}>
                    중요도 {task.importance}
                  </span>
                  <span className="task-archive-modal__pill" style={getDifficultyStyle()}>
                    난이도 {task.difficulty}
                  </span>
                </div>
              </li>
            ))}
            <div className="task-archive-modal__sentinel" ref={sentinelRef}>
              {/* A later page failed: the rows already read stay, the message and retry go here. */}
              {error ? (
                <span role="alert">
                  <span className="task-archive-modal__error">{error}</span>{' '}
                  <button type="button" className="task-archive-modal__ghost" onClick={handleRetry}>다시 시도</button>
                </span>
              ) : isLoading && hasNext
                ? '추가 아카이브를 불러오는 중...'
                : hasNext
                  ? '계속 불러옵니다...'
                  : '마지막 아카이브까지 모두 확인했어요.'}
            </div>
          </ul>
        )}
      </div>
    </Modal>
  )
}

export default TaskArchiveModal
