import { useCallback, useEffect, useRef, useState } from 'react'
import { searchTasks } from '../api/tasks'
import type { Task } from '../types/task'
import { useTaskCache } from '@contexts/TaskCacheContext'
import { getTodayWithOffset } from '@shared/utils/datetime'
import { useTimePreferences } from '@contexts/TimePreferencesContext'
import { onScheduleChanged, onTaskChanged } from '@shared/utils/events'
import { useRouteSurfaceNavigation } from '@shared/routing/RouteSurface'
import {
  CategoryFilter,
  CategoryManager,
  useCategories,
  type CategoryFilterValue,
} from '@features/categories'
import WorkspaceTaskCard from '../components/WorkspaceTaskCard'
import TaskArchiveModal from '../components/modals/TaskArchiveModal'
import TaskFilterPanel from '../components/TaskFilterPanel'
import {
  activeFilterCount,
  isDefaultFilters,
  mergePage,
  MAX_QUERY_LENGTH,
  restoreFilters,
  SORT_OPTIONS,
  toSearchParams,
  type TaskSortOrder,
} from '../utils/taskSearch'
import './TaskPages.css'

const PAGE_SIZE = 20
const FILTER_KEY = 'task-list-filters'
const readFilters = () => {
  try {
    return {
      ...restoreFilters(sessionStorage.getItem(FILTER_KEY)),
      query: '',
      tagIds: [],
    }
  } catch {
    return restoreFilters(null)
  }
}
export default function TaskListPage() {
  const { open } = useRouteSurfaceNavigation(),
    { setTask } = useTaskCache(),
    { offsetMinutes } = useTimePreferences()
  const { taskAssignments } = useCategories()
  const [filters, setFilters] = useState(readFilters),
    [queryInput, setQueryInput] = useState(''),
    [category, setCategory] = useState<CategoryFilterValue>('all')
  const [filterOpen, setFilterOpen] = useState(false),
    [managerOpen, setManagerOpen] = useState(false),
    [archiveOpen, setArchiveOpen] = useState(false)
  const [tasks, setTasks] = useState<Task[]>([]),
    [total, setTotal] = useState<number | null>(null),
    [loading, setLoading] = useState(true),
    [loadingMore, setLoadingMore] = useState(false),
    [error, setError] = useState<string | null>(null),
    [moreError, setMoreError] = useState<string | null>(null),
    [page, setPage] = useState(0),
    [hasMore, setHasMore] = useState(false)
  const request = useRef<AbortController | null>(null),
    sentinel = useRef<HTMLDivElement | null>(null)
  const today = getTodayWithOffset(offsetMinutes).format('YYYY-MM-DD')
  const params = JSON.stringify(toSearchParams(filters, today))
  useEffect(() => {
    const timer = window.setTimeout(
      () => setFilters((prev) => ({ ...prev, query: queryInput })),
      300,
    )
    return () => clearTimeout(timer)
  }, [queryInput])
  useEffect(() => {
    try {
      sessionStorage.setItem(
        FILTER_KEY,
        JSON.stringify({ ...filters, query: '', tagIds: [] }),
      )
    } catch {
      /* optional preference */
    }
  }, [filters])
  const load = useCallback(
    async (nextPage: number, replace = true) => {
      request.current?.abort()
      const controller = new AbortController()
      request.current = controller
      if (replace) {
        setLoading(true)
        setError(null)
        setMoreError(null)
      } else {
        setLoadingMore(true)
        setMoreError(null)
      }
      try {
        const search = JSON.parse(params) as [string, string][]
        let response = await searchTasks({
          page: nextPage,
          size: PAGE_SIZE,
          params: search,
          signal: controller.signal,
        })
        let incoming = response.content
        if (category !== 'all') {
          // Category is a separate owner-scoped contract. Traverse every server result before filtering;
          // filtering only the first page would incorrectly report missing tasks as absent.
          let cursor = nextPage
          const seen = new Set(incoming.map((t) => t.id))
          while (
            !(
              response.last ??
              (response.totalPages !== undefined
                ? cursor + 1 >= response.totalPages
                : response.content.length < PAGE_SIZE)
            )
          ) {
            response = await searchTasks({
              page: ++cursor,
              size: PAGE_SIZE,
              params: search,
              signal: controller.signal,
            })
            const next = response.content.filter((t) => !seen.has(t.id))
            if (!next.length) break
            next.forEach((t) => seen.add(t.id))
            incoming = [...incoming, ...next]
          }
          incoming = incoming.filter((t) =>
            category === 'none'
              ? taskAssignments[t.id] === undefined
              : taskAssignments[t.id] === category,
          )
        }
        if (controller.signal.aborted) return
        incoming.forEach(setTask)
        setTasks((prev) => (replace ? incoming : mergePage(prev, incoming)))
        setPage(nextPage)
        setHasMore(
          category === 'all' &&
            !(
              response.last ??
              (response.totalPages !== undefined
                ? nextPage + 1 >= response.totalPages
                : incoming.length < PAGE_SIZE)
            ),
        )
        setTotal(
          category === 'all'
            ? (response.totalElements ?? null)
            : incoming.length,
        )
      } catch (err) {
        if (controller.signal.aborted) return
        const message =
          err instanceof Error ? err.message : '작업을 불러오지 못했어요.'
        if (replace) setError(message)
        else setMoreError(message)
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false)
          setLoadingMore(false)
        }
      }
    },
    [params, category, taskAssignments, setTask],
  )
  useEffect(() => {
    void load(0)
    return () => request.current?.abort()
  }, [load])
  useEffect(() => {
    const refresh = () => void load(0)
    const offTask = onTaskChanged(refresh),
      offSchedule = onScheduleChanged(refresh)
    return () => {
      offTask()
      offSchedule()
    }
  }, [load])
  useEffect(() => {
    const node = sentinel.current
    if (!node || loading || loadingMore || !hasMore) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) void load(page + 1, false)
      },
      { rootMargin: '160px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [hasMore, loading, loadingMore, load, page, tasks.length])
  const count = activeFilterCount(filters) + (category === 'all' ? 0 : 1),
    filtered = !isDefaultFilters(filters) || category !== 'all'
  const reset = () => {
    setQueryInput('')
    setFilters({ ...restoreFilters(null), tagIds: [] })
    setCategory('all')
  }
  return (
    <section className="task-page">
      <header
        className="task-page__header task-page__header--split"
        data-onboarding-anchor="tasks.header"
      >
        <div>
          <p className="task-page__eyebrow">작업</p>
          <h1 className="task-page__title">작업 목록</h1>
        </div>
        <div className="task-page__actions">
          <button
            className="workspace-button"
            onClick={() => setArchiveOpen(true)}
          >
            작업 아카이브
          </button>
          <button
            className="workspace-button workspace-button--primary"
            onClick={() => open('/app/tasks/new')}
          >
            작업 추가
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
            onChange={(e) => setQueryInput(e.target.value)}
            placeholder="제목이나 설명으로 찾기"
            aria-label="작업 검색"
          />
          <CategoryFilter value={category} onChange={setCategory} />
          <button
            className="task-search__filter"
            aria-expanded={filterOpen}
            onClick={() => setFilterOpen(!filterOpen)}
          >
            필터{count > 0 ? ' ' + count : ''}
          </button>
          <select
            className="task-search__sort"
            aria-label="정렬"
            value={filters.sort}
            onChange={(e) =>
              setFilters({ ...filters, sort: e.target.value as TaskSortOrder })
            }
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <button
            className="workspace-button"
            onClick={() => setManagerOpen(true)}
          >
            카테고리 관리
          </button>
        </div>
        {filterOpen && (
          <TaskFilterPanel filters={filters} onChange={setFilters} />
        )}
        {filtered && !loading && !error && (
          <div className="task-search__summary">
            <span>{total ?? tasks.length}건</span>
            <button className="task-filter__link" onClick={reset}>
              초기화
            </button>
          </div>
        )}
      </div>
      <div className="task-page__content">
        {loading ? (
          <div className="task-page__placeholder" role="status">
            작업을 불러오는 중...
          </div>
        ) : error ? (
          <div className="workspace-inline-error" role="alert">
            <p>{error}</p>
            <button onClick={() => void load(0)}>다시 시도</button>
          </div>
        ) : tasks.length === 0 ? (
          <div className="task-page__placeholder">
            {filtered
              ? '조건에 맞는 작업이 없습니다.'
              : '등록된 작업이 없습니다.'}
          </div>
        ) : (
          <>
            <div className="task-page__list">
              {tasks.map((task) => (
                <WorkspaceTaskCard
                  key={task.id}
                  task={task}
                  onOpen={() => open('/app/tasks/' + task.id)}
                />
              ))}
            </div>
            {moreError && (
              <div role="alert" className="task-page__sentinel">
                {moreError}
                <button onClick={() => void load(page + 1, false)}>
                  다시 시도
                </button>
              </div>
            )}
            {hasMore && !moreError && (
              <div ref={sentinel} className="task-page__sentinel">
                {loadingMore ? (
                  '추가 작업을 불러오는 중...'
                ) : (
                  <button onClick={() => void load(page + 1, false)}>
                    더 보기
                  </button>
                )}
              </div>
            )}
            {!hasMore && (
              <div className="task-page__sentinel">
                마지막 작업까지 모두 불러왔습니다.
              </div>
            )}
          </>
        )}
      </div>
      {archiveOpen && (
        <TaskArchiveModal onClose={() => setArchiveOpen(false)} />
      )}
      {managerOpen && <CategoryManager onClose={() => setManagerOpen(false)} />}
    </section>
  )
}
