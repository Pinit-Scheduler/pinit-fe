import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { completeTask, reopenTask, searchTasks } from '../api/tasks'
import { fetchTags } from '../api/tags'
import type { Task, TaskTag } from '../types/task'
import { getDifficultyStyle, getImportanceStyle } from '@shared/utils/priorityStyles'
import { useTaskCache } from '@contexts/TaskCacheContext'
import { useToast } from '@contexts/ToastContext'
import { useTimePreferences } from '@contexts/TimePreferencesContext'
import { dispatchTaskChanged, onScheduleChanged, onTaskChanged } from '@shared/utils/events'
import { getDeadlineStyle } from '@shared/utils/deadlineStyles'
import { formatDateWithOffset, getTodayWithOffset } from '@shared/utils/datetime'
import { formatIsoDurationLabel } from '@shared/utils/isoDuration'
import TaskDetailModal from '../components/TaskDetailModal'
import TaskArchiveModal from '../components/modals/TaskArchiveModal'
import TagManagerModal from '../components/modals/TagManagerModal'
import TaskFilterPanel from '../components/TaskFilterPanel'
import {
  activeFilterCount,
  isDefaultFilters,
  mergePage,
  MAX_QUERY_LENGTH,
  restoreFilters,
  SORT_OPTIONS,
  toSearchParams,
  type TaskFilters,
  type TaskSortOrder,
} from '../utils/taskSearch'
import './TaskPages.css'
import '@features/recurrence/components/RecurrenceRuleFields.css'

const PAGE_SIZE = 20
const SCROLL_STORAGE_KEY = 'task-list-scroll-top'
const FILTER_STORAGE_KEY = 'task-list-filters'
const QUERY_DEBOUNCE_MS = 300

const readStoredFilters = () => {
  try {
    return { ...restoreFilters(sessionStorage.getItem(FILTER_STORAGE_KEY)), query: '' }
  } catch {
    return restoreFilters(null)
  }
}

const TaskListPage = () => {
  const { tasksById, setTask } = useTaskCache()
  const { addToast } = useToast()
  const { offsetMinutes } = useTimePreferences()
  const today = useMemo(() => getTodayWithOffset(offsetMinutes).format('YYYY-MM-DD'), [offsetMinutes])
  const [filters, setFilters] = useState<TaskFilters>(readStoredFilters)
  const [queryInput, setQueryInput] = useState(filters.query)
  const [isFilterOpen, setIsFilterOpen] = useState(false)
  const [tags, setTags] = useState<TaskTag[]>([])
  const [isTagManagerOpen, setIsTagManagerOpen] = useState(false)
  const [tasks, setTasks] = useState<Task[]>([])
  const [totalElements, setTotalElements] = useState<number | null>(null)
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
  const requestIdRef = useRef(0)

  const searchParams = useMemo(() => toSearchParams(filters, today), [filters, today])
  const tagNames = useMemo(() => new Map(tags.map((tag) => [tag.id, tag.name])), [tags])
  const filterCount = activeFilterCount(filters)
  const filtered = !isDefaultFilters(filters)

  useEffect(() => {
    try {
      // 검색어는 작업 내용이 들어갈 수 있어 남기지 않는다. 같은 탭에서 다른 계정으로 로그인해도 보이지 않게 한다.
      sessionStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify({ ...filters, query: '' }))
    } catch {
      // 저장소를 못 쓰면 이번 화면에서만 기억한다.
    }
  }, [filters])

  useEffect(() => {
    if (queryInput === filters.query) return
    const timer = window.setTimeout(() => setFilters((prev) => ({ ...prev, query: queryInput })), QUERY_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [queryInput, filters.query])

  const loadTags = useCallback(() => {
    fetchTags()
      .then((list) => {
        setTags(list)
        // 저장해 둔 태그 조건 중 지금 없는 태그는 버린다.
        setFilters((prev) => {
          const kept = prev.tagIds.filter((id) => list.some((tag) => tag.id === id))
          return kept.length === prev.tagIds.length ? prev : { ...prev, tagIds: kept }
        })
      })
      .catch(() => setTags([]))
  }, [])

  useEffect(() => {
    loadTags()
  }, [loadTags])

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
    const requestId = ++requestIdRef.current
    if (replace) {
      setIsLoading(true)
      // 이 요청이 진행 중이던 "더 불러오기"를 대신하므로 그 표시도 끈다.
      setIsLoadingMore(false)
      setError(null)
      setLoadMoreError(null)
    } else {
      setIsLoadingMore(true)
      setLoadMoreError(null)
    }
    try {
      const response = await searchTasks({ page: nextPage, size: PAGE_SIZE, params: searchParams })
      if (requestId !== requestIdRef.current) return
      const incoming = response.content ?? []
      incoming.forEach(setTask)
      setTasks((prev) => (replace ? incoming : mergePage(prev, incoming)))
      setTotalElements(typeof response.totalElements === 'number' ? response.totalElements : null)
      setPage(nextPage)
      updateHasMore(nextPage, incoming.length, response.last, response.totalPages)
    } catch (err) {
      if (requestId !== requestIdRef.current) return
      if (replace) {
        setError(err instanceof Error ? err.message : '작업을 불러오지 못했습니다.')
        setHasMore(false)
      } else {
        const message = err instanceof Error ? err.message : '추가 작업을 불러오지 못했습니다.'
        setLoadMoreError(message)
        addToast(message, 'error')
      }
    } finally {
      if (requestId === requestIdRef.current) {
        if (replace) {
          setIsLoading(false)
        } else {
          setIsLoadingMore(false)
        }
      }
    }
  }, [addToast, setTask, searchParams])

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

  const resetAll = () => {
    setQueryInput('')
    setFilters(restoreFilters(null))
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
      // 이전 작업을 끝내거나 되돌리면 다음 작업의 대기 수가 바뀌므로 목록을 다시 읽는다(dispatch가 refetch를 부른다).
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
      <header className="task-page__header task-page__header--split" data-onboarding-anchor="tasks.header">
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
      <div className="task-search">
        <div className="task-search__bar">
          <input
            type="search"
            className="task-search__input"
            value={queryInput}
            maxLength={MAX_QUERY_LENGTH}
            onChange={(event) => setQueryInput(event.target.value)}
            placeholder="제목이나 설명으로 찾기"
            aria-label="작업 검색"
          />
          <button
            type="button"
            className={['task-search__filter', isFilterOpen || filterCount > 0 ? 'is-active' : ''].filter(Boolean).join(' ')}
            aria-expanded={isFilterOpen}
            onClick={() => setIsFilterOpen((open) => !open)}
          >
            필터{filterCount > 0 ? ` ${filterCount}` : ''}
          </button>
          <select
            className="task-search__sort"
            value={filters.sort}
            onChange={(event) => setFilters((prev) => ({ ...prev, sort: event.target.value as TaskSortOrder }))}
            aria-label="정렬"
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        {isFilterOpen && (
          <TaskFilterPanel
            filters={filters}
            tags={tags}
            onChange={setFilters}
            onManageTags={() => setIsTagManagerOpen(true)}
          />
        )}
        {filtered && !isLoading && !error && (
          <div className="task-search__summary">
            <span>{totalElements ?? tasks.length}건</span>
            <button type="button" className="task-filter__link" onClick={resetAll}>
              초기화
            </button>
          </div>
        )}
      </div>
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
            <p>{filtered ? '조건에 맞는 작업이 없습니다.' : '등록된 작업이 없습니다.'}</p>
          </div>
        ) : (
          <>
            <ul className="task-page__list">
              {tasks.map((task) => {
                const cached = tasksById[task.id]
                const item = cached ? { ...task, ...cached, tags: cached.tags ?? task.tags } : task
                const isDone = item.completed ?? item.isCompleted ?? false
                const waiting = item.inboundDependencyCount ?? 0
                return (
                  <li key={task.id} className="task-page__item" onClick={() => setSelectedTaskId(task.id)}>
                    <div className="task-page__item-head">
                      <label className="task-page__checkbox" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isDone}
                          onChange={(e) => toggleCompletion(item, e)}
                          disabled={togglingId === task.id}
                        />
                        <span className="task-page__checkbox-mark" aria-hidden />
                      </label>
                      <div>
                        <strong>{item.title}</strong>
                        {item.recurrence && (
                          <span className="recurrence-badge" style={{ marginLeft: 6 }} aria-label="반복 작업">
                            🔁 반복
                          </span>
                        )}
                        {item.missed && (
                          <span className="recurrence-badge recurrence-badge--missed" style={{ marginLeft: 6 }}>
                            놓침
                          </span>
                        )}
                        <p className="task-page__item-desc">{item.description}</p>
                        {(item.tags ?? []).length > 0 && (
                          <div className="task-page__tags">
                            {(item.tags ?? []).map((tag) => (
                              <span key={tag.id} className="tag-chip tag-chip--static">
                                #{tagNames.get(tag.id) ?? tag.name}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="task-page__item-meta">
                      {!isDone && waiting > 0 && (
                        <span className="task-page__pill task-page__pill--waiting">이전 작업 {waiting}개 남음</span>
                      )}
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
                      {formatIsoDurationLabel(item.effectiveExpectedDuration) && (
                        <span className="task-page__pill">
                          예상 {formatIsoDurationLabel(item.effectiveExpectedDuration)}
                        </span>
                      )}
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
      {isTagManagerOpen && (
        <TagManagerModal
          onClose={() => {
            setIsTagManagerOpen(false)
            loadPage(0, { replace: true }).catch(() => {})
          }}
          onChanged={(next) => {
            setTags(next)
            setFilters((prev) => ({ ...prev, tagIds: prev.tagIds.filter((id) => next.some((tag) => tag.id === id)) }))
          }}
        />
      )}
    </section>
  )
}

export default TaskListPage
