import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { completeTask, fetchTasks, reopenTask } from '../api/tasks'
import type { Task } from '../types/task'
import { getDifficultyStyle, getImportanceStyle } from '@shared/utils/priorityStyles'
import { useTaskCache } from '@contexts/TaskCacheContext'
import { useToast } from '@contexts/ToastContext'
import { dispatchTaskChanged, onScheduleChanged, onTaskChanged } from '@shared/utils/events'
import { getDeadlineStyle } from '@shared/utils/deadlineStyles'
import { formatDateWithOffset } from '@shared/utils/datetime'
import TaskDetailModal from '../components/TaskDetailModal'
import TaskArchiveModal from '../components/modals/TaskArchiveModal'
import './TaskPages.css'

const PAGE_SIZE = 20
const SCROLL_STORAGE_KEY = 'task-list-scroll-top'

const TaskListPage = () => {
  const { tasksById, setTask } = useTaskCache()
  const { addToast } = useToast()
  const [tasks, setTasks] = useState<Task[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<number | null>(null)
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null)
  const [isArchiveOpen, setIsArchiveOpen] = useState(false)
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const lastScrollTopRef = useRef(0)

  const updateHasMore = (nextPage: number, receivedCount: number, last?: boolean | null, totalPages?: number | null) => {
    if (typeof last === 'boolean') {
      setHasMore(!last)
      return
    }
    if (typeof totalPages === 'number') {
      setHasMore(nextPage + 1 < totalPages)
      return
    }
    setHasMore(receivedCount >= PAGE_SIZE)
  }

  const loadPage = useCallback(async (nextPage: number, { replace }: { replace: boolean }) => {
    if (replace) {
      setIsLoading(true)
      setError(null)
      setLoadMoreError(null)
    } else {
      setIsLoadingMore(true)
      setLoadMoreError(null)
    }
    try {
      const response = await fetchTasks({ page: nextPage, size: PAGE_SIZE, readyOnly: false })
      const incoming = response.content ?? []
      incoming.forEach(setTask)
      setTasks((prev) => {
        if (replace) return incoming
        const ids = new Set(prev.map((task) => task.id))
        const merged = [...prev]
        incoming.forEach((task) => {
          if (!ids.has(task.id)) {
            merged.push(task)
            ids.add(task.id)
          }
        })
        return merged
      })
      setPage(nextPage)
      updateHasMore(nextPage, incoming.length, response.last, response.totalPages)
    } catch (err) {
      if (replace) {
        setError(err instanceof Error ? err.message : '작업을 불러오지 못했습니다.')
      } else {
        const message = err instanceof Error ? err.message : '추가 작업을 불러오지 못했습니다.'
        setLoadMoreError(message)
        addToast(message, 'error')
      }
      if (replace) setHasMore(false)
    } finally {
      if (replace) {
        setIsLoading(false)
      } else {
        setIsLoadingMore(false)
      }
    }
  }, [addToast, setTask])

  useEffect(() => {
    loadPage(0, { replace: true }).catch(() => {})
  }, [loadPage])

  useEffect(() => {
    const refetchOnChange = () => loadPage(0, { replace: true })
    const offTask = onTaskChanged(refetchOnChange)
    const offSchedule = onScheduleChanged(refetchOnChange)
    return () => {
      offTask()
      offSchedule()
    }
  }, [loadPage])

  const loadMore = useCallback(() => {
    if (isLoading || isLoadingMore || !hasMore) return
    loadPage(page + 1, { replace: false }).catch(() => {})
  }, [hasMore, isLoading, isLoadingMore, loadPage, page])

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) loadMore()
      },
      {
        root: contentRef.current,
        rootMargin: '120px',
      },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [loadMore])

  useEffect(() => {
    const saved = sessionStorage.getItem(SCROLL_STORAGE_KEY)
    if (!saved) return
    const scrollTop = Number(saved)
    if (Number.isNaN(scrollTop)) return
    const container = contentRef.current
    if (!container) return
    requestAnimationFrame(() => {
      container.scrollTop = scrollTop
    })
  }, [])

  useEffect(() => {
    return () => {
      sessionStorage.setItem(SCROLL_STORAGE_KEY, String(lastScrollTopRef.current))
    }
  }, [])

  const handleScroll = () => {
    const container = contentRef.current
    if (!container) return
    lastScrollTopRef.current = container.scrollTop
  }

  const toggleCompletion = async (task: Task, event: ChangeEvent<HTMLInputElement>) => {
    event.stopPropagation()
    if (togglingId === task.id) return
    setTogglingId(task.id)
    const isCompleted = task.completed ?? task.isCompleted ?? false
    try {
      if (isCompleted) {
        await reopenTask(task.id)
      } else {
        await completeTask(task.id)
      }
      const updated = { ...task, completed: !isCompleted, isCompleted: !isCompleted }
      setTask(updated)
      setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, completed: !isCompleted, isCompleted: !isCompleted } : t)))
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
      <header className="task-page__header task-page__header--split">
        <div className="task-page__title-block">
          <p className="task-page__eyebrow">작업</p>
          <h1 className="task-page__title">작업 목록</h1>
        </div>
        <div className="task-page__actions">
          <button type="button" className="task-page__primary" onClick={() => setIsArchiveOpen(true)}>
            작업 아카이브
          </button>
        </div>
      </header>
      <div className="task-page__content" ref={contentRef} onScroll={handleScroll}>
        {isLoading ? (
          <div className="task-page__placeholder">
            <p>작업을 불러오는 중...</p>
          </div>
        ) : error ? (
          <div className="task-page__placeholder">
            <p>작업을 불러오지 못했습니다.</p>
            <p>{error}</p>
            <button type="button" className="task-page__primary" onClick={() => loadPage(0, { replace: true })}>
              다시 시도
            </button>
          </div>
        ) : tasks.length === 0 ? (
          <div className="task-page__placeholder">
            <p>등록된 작업이 없습니다.</p>
          </div>
        ) : (
          <>
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
                          checked={item.completed ?? item.isCompleted ?? false}
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
                        <span className="task-page__pill" style={getDeadlineStyle(item.dueDate)}>
                          마감 {formatDateWithOffset(item.dueDate, 'M/D')}
                        </span>
                      )}
                      <span className="task-page__pill" style={getImportanceStyle(item.importance)}>
                        중요도 {item.importance}
                      </span>
                      <span className="task-page__pill" style={getDifficultyStyle(item.difficulty)}>
                        난이도 {item.difficulty}
                      </span>
                    </div>
                  </li>
                )
              })}
            </ul>
            {loadMoreError && !isLoadingMore && (
              <div className="task-page__sentinel">
                <p>추가 작업을 불러오지 못했습니다.</p>
                <button type="button" className="task-page__retry" onClick={loadMore}>
                  다시 시도
                </button>
              </div>
            )}
            {(hasMore || isLoadingMore) && !loadMoreError && (
              <div className="task-page__sentinel" ref={sentinelRef}>
                {isLoadingMore ? '추가 작업을 불러오는 중...' : '더 불러오는 중...'}
              </div>
            )}
            {!hasMore && !isLoadingMore && !loadMoreError && (
              <div className="task-page__sentinel">마지막 작업까지 모두 불러왔습니다.</div>
            )}
          </>
        )}
      </div>
      {selectedTaskId && (
        <TaskDetailModal taskId={selectedTaskId} onClose={() => setSelectedTaskId(null)} />
      )}
      {isArchiveOpen && (
        <TaskArchiveModal onClose={() => setIsArchiveOpen(false)} />
      )}
    </section>
  )
}

export default TaskListPage
