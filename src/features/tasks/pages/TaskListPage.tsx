import { useProjectFilter, useSpaces } from '@features/spaces/store'
import type { CSSProperties } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { searchTasks } from '../api/tasks'
import type { Task, TaskListResponse } from '../types/task'
import { useTaskCache } from '@contexts/TaskCacheContext'
import { getTodayWithOffset } from '@shared/utils/datetime'
import { useTimePreferences } from '@contexts/TimePreferencesContext'
import { onDataChanged } from '@shared/utils/events'
import { useRevalidatingQuery } from '@shared/hooks/useRevalidatingQuery'
import {
  arrivalIndex,
  COMPLETION_HOLD_MS,
  presenceProps,
  useArrival,
  useListPresence,
  usePresence,
  useTweenedNumber,
} from '@shared/motion'
import { useRouteSurfaceNavigation } from '@shared/routing/RouteSurface'
import {
  CategoryFilter,
  CategoryManager,
  useCategories,
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
import { isCompletionOnly } from '../utils/taskListRefresh'
import { getRequestFailureMessage } from '@shared/api/errorMessage'
import './TaskPages.css'

const PAGE_SIZE = 20
const FILTER_KEY = 'task-list-filters'
const LOAD_ERROR = '작업을 불러오지 못했어요.'

type TaskListData = {
  tasks: Task[]
  /** Server total for a paged list. A project filter counts at render instead. */
  total: number | null
  /** Pages already on screen. A refresh re-reads all of them, so no loaded row drops away. */
  pages: number
  hasMore: boolean
}

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
const isLastPage = (response: TaskListResponse, page: number) =>
  response.last ??
  (response.totalPages !== undefined
    ? page + 1 >= response.totalPages
    : response.content.length < PAGE_SIZE)
const errorText = (error: unknown) =>
  getRequestFailureMessage(error, `${LOAD_ERROR} 인터넷 연결을 확인한 뒤 다시 시도해 주세요.`)

/** The result count. It shows as is when it appears and glides when a change moves it. */
function TaskCount({ value }: { value: number }) {
  return <span>{Math.round(useTweenedNumber(value))}건</span>
}

export default function TaskListPage() {
  const { open } = useRouteSurfaceNavigation(),
    { setTask } = useTaskCache(),
    { offsetMinutes } = useTimePreferences()
  const {
    taskAssignments,
    hasLoaded: assignmentsLoaded,
    error: assignmentsError,
  } = useCategories()
  const { selectedSpaceId } = useSpaces()
  const [filters, setFilters] = useState(readFilters),
    [queryInput, setQueryInput] = useState('')
  const [category, setCategory] = useProjectFilter()
  const [filterOpen, setFilterOpen] = useState(false),
    [managerOpen, setManagerOpen] = useState(false),
    [archiveOpen, setArchiveOpen] = useState(false)
  const sentinel = useRef<HTMLDivElement | null>(null)
  // Pages on screen for a key. A refresh re-reads all of them, so no loaded row drops away.
  const pagesShown = useRef<{ key: string; pages: number }>({ key: '', pages: 1 })
  const today = getTodayWithOffset(offsetMinutes).format('YYYY-MM-DD')
  const params = JSON.stringify(toSearchParams(filters, today))
  // A project filter reads every page and narrows by assignment at render (audit A7), so a
  // category reload never re-creates the request. The key names everything the request
  // reads; searchTasks sends the selected space and project itself.
  const full = category !== 'all'
  const key = `tasks/list/${selectedSpaceId ?? 'all'}/${typeof category === 'number' ? category : 'any'}/${full ? 'full' : 'paged'}?${params}`

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

  const { data, error, isRefreshing, refetch, setData } =
    useRevalidatingQuery<TaskListData>(
      key,
      async (signal) => {
        const search = JSON.parse(params) as [string, string][]
        const read = (page: number) =>
          searchTasks({ page, size: PAGE_SIZE, params: search, signal })
        if (full) {
          // Project assignments are server facts. Traverse every server result before filtering;
          // filtering only the first page would incorrectly report missing tasks as absent.
          let cursor = 0
          let response = await read(cursor)
          let tasks = response.content
          const seen = new Set(tasks.map((t) => t.id))
          while (!isLastPage(response, cursor)) {
            response = await read(++cursor)
            const next = response.content.filter((t) => !seen.has(t.id))
            if (!next.length) break
            next.forEach((t) => seen.add(t.id))
            tasks = [...tasks, ...next]
          }
          tasks.forEach(setTask)
          return { tasks, total: null, pages: cursor + 1, hasMore: false }
        }
        const shown = () =>
          pagesShown.current.key === key ? Math.max(1, pagesShown.current.pages) : 1
        const responses = await Promise.all(
          Array.from({ length: shown() }, (_, page) => read(page)),
        )
        // "More" may have landed while this refresh ran. Read its pages too, so the refresh
        // does not take the rows it just added off the screen again.
        while (
          responses.length < shown() &&
          !isLastPage(responses[responses.length - 1], responses.length - 1)
        )
          responses.push(await read(responses.length))
        const pages = responses.length
        const tasks = responses.reduce<Task[]>(
          (merged, response) => mergePage(merged, response.content),
          [],
        )
        tasks.forEach(setTask)
        const last = responses[responses.length - 1]
        return {
          tasks,
          total: last.totalElements ?? null,
          pages,
          hasMore: !isLastPage(last, pages - 1),
        }
      },
      { errorMessage: errorText },
    )
  useEffect(() => {
    pagesShown.current = { key, pages: data?.pages ?? 1 }
  }, [data, key])

  // One refresh per action (events are coalesced). A completion waits for its own motion first.
  useEffect(() => {
    let timer: number | undefined
    const off = onDataChanged((batch) => {
      window.clearTimeout(timer)
      if (isCompletionOnly(batch))
        timer = window.setTimeout(refetch, COMPLETION_HOLD_MS)
      else refetch()
    })
    return () => {
      off()
      window.clearTimeout(timer)
    }
  }, [refetch])

  // "More" belongs to the key it was asked for, so a filter change starts clean.
  const [more, setMore] = useState<{
    key: string
    loading: boolean
    error: string | null
  }>({ key, loading: false, error: null })
  const loadingMore = more.key === key && more.loading
  const moreError = more.key === key ? more.error : null
  const moreRequest = useRef<AbortController | null>(null)
  useEffect(
    () => () => {
      moreRequest.current?.abort()
      moreRequest.current = null
    },
    [key],
  )
  const loadMore = useCallback(async () => {
    if (!data?.hasMore || moreRequest.current) return
    const controller = new AbortController()
    moreRequest.current = controller
    const page = data.pages
    setMore({ key, loading: true, error: null })
    try {
      const response = await searchTasks({
        page,
        size: PAGE_SIZE,
        params: JSON.parse(params) as [string, string][],
        signal: controller.signal,
      })
      if (controller.signal.aborted) return
      response.content.forEach(setTask)
      pagesShown.current = { key, pages: page + 1 }
      setData((prev) =>
        prev && prev.pages === page
          ? {
              tasks: mergePage(prev.tasks, response.content),
              total: response.totalElements ?? prev.total,
              pages: page + 1,
              hasMore: !isLastPage(response, page),
            }
          : (prev as TaskListData),
      )
      setMore({ key, loading: false, error: null })
    } catch (err) {
      if (controller.signal.aborted) return
      setMore({ key, loading: false, error: errorText(err) })
    } finally {
      if (moreRequest.current === controller) moreRequest.current = null
    }
  }, [data, key, params, setData, setTask])

  const hasMore = Boolean(data?.hasMore)
  const loadedCount = data?.tasks.length ?? 0
  useEffect(() => {
    const node = sentinel.current
    if (!node || loadingMore || !hasMore) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) void loadMore()
      },
      { rootMargin: '160px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [hasMore, loadingMore, loadMore, loadedCount])

  // A project filter waits for the first assignment snapshot; without it every task would
  // briefly look unassigned.
  const assignmentsReady =
    !full || assignmentsLoaded || assignmentsError !== null
  const visible = useMemo(
    () =>
      !data || !assignmentsReady
        ? undefined
        : category === 'all'
          ? data.tasks
          : data.tasks.filter((t) =>
              category === 'none'
                ? taskAssignments[t.id] === undefined
                : taskAssignments[t.id] === category,
            ),
    [data, assignmentsReady, category, taskAssignments],
  )
  const failed = error !== null && data === undefined
  const initialLoading = visible === undefined && !failed
  const listKey = `${key}|${category}`
  const rows = useListPresence(visible, (task) => task.id, {
    resetKey: listKey,
  })
  const arriving = useArrival(initialLoading, listKey)
  const total =
    visible === undefined
      ? 0
      : category === 'all'
        ? (data?.total ?? visible.length)
        : visible.length

  const filterPanel = usePresence(filterOpen)
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
            className={'task-search__filter' + (filterOpen ? ' is-open' : '')}
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
            프로젝트 관리
          </button>
        </div>
        {filterPanel.mounted && (
          <TaskFilterPanel
            filters={filters}
            onChange={setFilters}
            closing={filterPanel.closing}
          />
        )}
        {filtered && visible !== undefined && (
          <div className="task-search__summary">
            <TaskCount value={total} />
            <button className="task-filter__link" onClick={reset}>
              초기화
            </button>
          </div>
        )}
      </div>
      <div className="task-page__content" aria-busy={isRefreshing || undefined}>
        {/* A refresh that failed while results are on screen (even an empty result): keep them. */}
        {error && visible !== undefined && (
          <div
            className="workspace-inline-error task-page__notice"
            role="alert"
          >
            <p>{error}</p>
            <button onClick={refetch}>다시 시도</button>
          </div>
        )}
        {initialLoading ? (
          <div
            className="task-page__placeholder task-page__placeholder--loading"
            role="status"
          >
            작업을 불러오는 중...
          </div>
        ) : visible === undefined ? (
          <div className="workspace-inline-error" role="alert">
            <p>{error}</p>
            <button onClick={refetch}>다시 시도</button>
          </div>
        ) : rows.length === 0 ? (
          <div className="task-page__placeholder">
            {filtered
              ? '조건에 맞는 작업이 없습니다.'
              : '등록된 작업이 없습니다.'}
          </div>
        ) : (
          <>
            <div className="task-page__list">
              {rows.map(({ key: rowKey, item: task, phase }, index) => (
                <div
                  key={rowKey}
                  className="task-page__row"
                  data-arrive={(arriving && phase === 'present') || undefined}
                  style={
                    arriving
                      ? ({
                          '--arrive-index': arrivalIndex(index),
                        } as CSSProperties)
                      : undefined
                  }
                  {...presenceProps(phase)}
                >
                  <WorkspaceTaskCard
                    task={task}
                    onOpen={() => open('/app/tasks/' + task.id)}
                  />
                </div>
              ))}
            </div>
            {moreError && (
              <div role="alert" className="task-page__sentinel">
                {moreError}
                <button onClick={() => void loadMore()}>다시 시도</button>
              </div>
            )}
            {hasMore && !moreError && (
              <div ref={sentinel} className="task-page__sentinel">
                {loadingMore ? (
                  '추가 작업을 불러오는 중...'
                ) : (
                  <button onClick={() => void loadMore()}>더 보기</button>
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
      <TaskArchiveModal
        open={archiveOpen}
        onClose={() => setArchiveOpen(false)}
      />
      <CategoryManager
        open={managerOpen}
        onClose={() => setManagerOpen(false)}
      />
    </section>
  )
}
