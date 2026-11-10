import WorkspaceIcon from '@shared/components/common/WorkspaceIcon'
import { useEffect, useId, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import Modal from '@shared/components/common/Modal'
import { usePresence } from '@shared/motion'
import { arrivalIndex, useArrival } from '../../utils/useArrival'
import './TaskDependencyModal.css'
import { searchTasks } from '../../api/tasks'
import { getRequestFailureMessage } from '@shared/api/errorMessage'
import type { Task } from '../../types/task'
import { mergePage, MAX_QUERY_LENGTH } from '../../utils/taskSearch'

type TaskDependencyModalProps = {
  isOpen: boolean
  onClose: () => void
  selectedIds: number[]
  onApply: (tasks: Task[]) => void
  title: string
  /** 수정 중인 작업 자신. 목록에서 뺀다 */
  excludeTaskId?: number
  spaceId?: number
}

const PAGE_SIZE = 20
const QUERY_DEBOUNCE_MS = 300
// 반복 회차에는 선후관계를 걸 수 없고(ADR-0019 §7), 완료한 작업도 이전 작업으로 고를 수 있다(ADR-0023 §4).
const BASE_PARAMS: [string, string][] = [
  ['status', 'ALL'],
  ['recurring', 'false'],
]

/** Plays its exit before unmounting. Each opening starts with a fresh search. */
const TaskDependencyModal = (props: TaskDependencyModalProps) => {
  const presence = usePresence(props.isOpen)
  return presence.mounted ? (
    <DependencyPicker {...props} closing={presence.closing} />
  ) : null
}

const DependencyPicker = ({
  onClose,
  selectedIds: liveSelectedIds,
  onApply,
  title: liveTitle,
  excludeTaskId,
  spaceId,
  closing,
}: TaskDependencyModalProps & { closing: boolean }) => {
  const titleId = useId()
  // The opener resets its mode as the exit starts. Keep showing what was open while it fades.
  const [shown, setShown] = useState({
    title: liveTitle,
    selectedIds: liveSelectedIds,
  })
  if (
    !closing &&
    (shown.title !== liveTitle || shown.selectedIds !== liveSelectedIds)
  )
    setShown({ title: liveTitle, selectedIds: liveSelectedIds })
  const { title, selectedIds } = shown
  const [tasks, setTasks] = useState<Task[]>([])
  const [error, setError] = useState<string | null>(null)
  // Each opening mounts a fresh picker that reads at once: start loading, not on an empty result.
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [queryInput, setQueryInput] = useState('')
  const [query, setQuery] = useState('')
  const [localSelection, setLocalSelection] = useState<number[]>(selectedIds)
  // 검색어를 바꿔 목록에서 사라져도 고른 작업의 정보를 잃지 않는다.
  const pickedRef = useRef<Map<number, Task>>(new Map())
  const requestIdRef = useRef(0)

  useEffect(() => setLocalSelection(selectedIds), [selectedIds])

  useEffect(() => {
    const timer = window.setTimeout(
      () => setQuery(queryInput.trim()),
      QUERY_DEBOUNCE_MS,
    )
    return () => window.clearTimeout(timer)
  }, [queryInput])

  const load = async (nextPage: number, replace: boolean) => {
    const requestId = ++requestIdRef.current
    if (replace) {
      setLoading(true)
      setError(null)
    } else {
      setLoadingMore(true)
    }
    try {
      const params: [string, string][] = query
        ? [...BASE_PARAMS, ['q', query]]
        : BASE_PARAMS
      const res = await searchTasks({
        page: nextPage,
        size: PAGE_SIZE,
        params,
        spaceId,
        projectId: null,
      })
      if (requestId !== requestIdRef.current) return
      const incoming = (res.content ?? []).filter(
        (task) => task.id !== excludeTaskId,
      )
      setTasks((prev) => (replace ? incoming : mergePage(prev, incoming)))
      setPage(nextPage)
      setHasMore(
        typeof res.last === 'boolean'
          ? !res.last
          : (res.content ?? []).length >= PAGE_SIZE,
      )
    } catch (err) {
      if (requestId !== requestIdRef.current) return
      setError(
        getRequestFailureMessage(
          err,
          '작업을 불러오지 못했어요. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.',
        ),
      )
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false)
        setLoadingMore(false)
      }
    }
  }

  useEffect(() => {
    load(0, true).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, excludeTaskId, spaceId])

  const toggle = (task: Task) => {
    setLocalSelection((prev) => {
      if (prev.includes(task.id)) {
        pickedRef.current.delete(task.id)
        return prev.filter((v) => v !== task.id)
      }
      pickedRef.current.set(task.id, task)
      return [...prev, task.id]
    })
  }

  // Results the picker waited for (first read, a new search) rise in; "more" pages append.
  const arriving = useArrival(loading, query)

  const handleApply = () => {
    const visible = tasks.filter((t) => localSelection.includes(t.id))
    const visibleIds = new Set(visible.map((t) => t.id))
    const offscreen = [...pickedRef.current.values()].filter(
      (t) => localSelection.includes(t.id) && !visibleIds.has(t.id),
    )
    onApply([...visible, ...offscreen])
    onClose()
  }

  return (
    <Modal
      backdropClassName="task-dep-modal__backdrop"
      className="task-dep-modal__content"
      onClose={onClose}
      labelledBy={titleId}
      closing={closing}
    >
      <header className="task-dep-modal__header">
        <h1 id={titleId}>{title}</h1>
        <button type="button" onClick={onClose} aria-label="닫기">
          <WorkspaceIcon name="close" />
        </button>
      </header>
      <input
        type="search"
        className="task-dep-modal__search"
        value={queryInput}
        maxLength={MAX_QUERY_LENGTH}
        onChange={(event) => setQueryInput(event.target.value)}
        placeholder="제목이나 설명으로 찾기"
        aria-label="작업 검색"
      />
      <div className="task-dep-modal__body">
        {loading ? (
          <p className="task-dep-modal__loading" role="status">
            불러오는 중...
          </p>
        ) : error ? (
          <p className="task-dep-modal__error">{error}</p>
        ) : tasks.length === 0 ? (
          <p>{query ? '찾는 작업이 없습니다.' : '선택할 작업이 없습니다.'}</p>
        ) : (
          <>
            <ul className="task-dep-modal__list">
              {tasks.map((task, index) => {
                const checked = localSelection.includes(task.id)
                return (
                  <li
                    key={task.id}
                    data-arrive={arriving || undefined}
                    style={
                      arriving
                        ? ({
                            '--arrive-index':
                              index < PAGE_SIZE ? arrivalIndex(index) : 0,
                          } as CSSProperties)
                        : undefined
                    }
                  >
                    <label className={checked ? 'is-checked' : ''}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(task)}
                      />
                      <div>
                        <strong>{task.title}</strong>
                        {(task.completed ?? task.isCompleted) && (
                          <small> · 완료</small>
                        )}
                        <small>{task.description}</small>
                      </div>
                    </label>
                  </li>
                )
              })}
            </ul>
            {hasMore && (
              <button
                type="button"
                className="task-dep-modal__more"
                onClick={() => load(page + 1, false).catch(() => {})}
                disabled={loadingMore}
              >
                {loadingMore ? '불러오는 중...' : '더 보기'}
              </button>
            )}
          </>
        )}
      </div>
      <footer className="task-dep-modal__footer">
        <button type="button" onClick={onClose}>
          취소
        </button>
        <button
          type="button"
          onClick={handleApply}
          disabled={localSelection.length === 0}
        >
          추가
        </button>
      </footer>
    </Modal>
  )
}

export default TaskDependencyModal
