import { useProjectFilter } from '@features/spaces/store'
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type {
  FocusEvent,
  KeyboardEvent,
  PointerEvent,
  ReactNode,
} from 'react'
import { Link } from 'react-router-dom'
import Modal from '@shared/components/common/Modal'
import StatusPanel from '@shared/components/common/StatusPanel'
import useCurrentDay from '@shared/hooks/useCurrentDay'
import {
  MOTION_BASE_MS,
  MOTION_EASE,
  MOTION_ENTER_MS,
  presenceProps,
  prefersReducedMotion,
  useArrival,
  useListPresence,
  usePresence,
  useTweenedNumber,
} from '@shared/motion'
import { useRouteSurfaceNavigation } from '@shared/routing/RouteSurface'
import { surfaceLinkClick } from '@shared/routing/linkClick'
import {
  CategoryFilter,
  useCategories,
} from '@features/categories'
import type { Category } from '@features/categories'
import type { Task } from '@features/tasks/types/task'
import {
  buildTaskGraph,
  compareGraphTasks,
  fitGraph,
  graphEdgePaths,
  isTaskCompleted,
  matrixQuadrant,
  movedEdgeKeys,
  taskDateKey,
  taskReadiness,
  zoomGraph,
} from './graph'
import type { GraphNode, GraphSort, GraphView, TaskGraph } from './graph'
import { useTaskGraph } from './useTaskGraph'
import './TaskMapPage.css'

const statusLabel = {
  completed: '완료',
  ready: '시작 가능',
  blocked: '선행 작업 대기',
  unknown: '준비 상태 확인 필요',
}
const quadrantNames = [
  '중요하고 긴급한 일',
  '중요하고 여유 있는 일',
  '긴급하지만 덜 중요한 일',
  '여유 있게 검토할 일',
]
const quadrantHints = [
  '먼저 집중하기',
  '시간을 정해 계획하기',
  '처리 방법과 순서 검토하기',
  '우선순위를 다시 살펴보기',
]

const useMobileMap = () => {
  const [mobile, setMobile] = useState(
    () => window.matchMedia('(max-width:760px)').matches,
  )
  useEffect(() => {
    const media = window.matchMedia('(max-width:760px)'),
      update = () => setMobile(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  return mobile
}

type OpenSurface = (path: string) => void

/**
 * A task link that opens the task surface over the map instead of swapping the page behind it.
 * It stays a real link, so a modified click or "open in new tab" still works.
 */
function TaskSurfaceLink({
  taskId,
  open,
  className,
  onFocus,
  children,
}: {
  taskId: number | 'new'
  open: OpenSurface
  className?: string
  onFocus?: (event: FocusEvent<HTMLAnchorElement>) => void
  children: ReactNode
}) {
  const path = `/app/tasks/${taskId}`
  return (
    <Link to={path} className={className} onFocus={onFocus} onClick={surfaceLinkClick(open, path)}>
      {children}
    </Link>
  )
}

/** A title that draws the completion strike when a refresh brings the task back completed. */
function TaskTitle({ task }: { task: Task }) {
  return (
    <span
      className="motion-strike"
      data-done={isTaskCompleted(task) || undefined}
    >
      {task.title}
    </span>
  )
}

function CategoryName({ category }: { category?: Category | null }) {
  return <span className="category-badge">{category?.name ?? '없음'}</span>
}

function TaskMetrics({ task }: { task: Task }) {
  return (
    <span className="tm-metrics">
      <span>
        중요도 <strong>{task.importance}</strong>/9
      </span>
      <span>
        난이도 <strong>{task.difficulty}</strong>/21
      </span>
    </span>
  )
}

function SequenceMap({
  graph,
  matches,
  categoryFor,
  layoutKey,
  presenceKey,
  open,
}: {
  graph: TaskGraph
  matches: Set<number>
  categoryFor: ReturnType<typeof useCategories>['taskCategory']
  /** Changes when the layout is rebuilt (completed toggle, sort, mobile). Only then does the viewport refit. */
  layoutKey: string
  /** Changes when the map shows a different selection. Nodes and edges then start a new baseline. */
  presenceKey: string
  open: OpenSurface
}) {
  // The person's pan and zoom belong to the layout, not to one snapshot: a refresh keeps them.
  const [viewOverride, setViewOverride] = useState<{
    layoutKey: string
    width: number
    height: number
    view: GraphView
  } | null>(null)
  const [size, setSize] = useState({ width: 800, height: 440 })
  const [expanded, setExpanded] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [placeholderHeight, setPlaceholderHeight] = useState(0)
  const [selected, setSelectedId] = useState<number | null>(null)
  const fullscreen = usePresence(expanded)
  const selectedId = graph.nodes.some((node) => node.id === selected)
    ? selected
    : (graph.nodes[0]?.id ?? null)
  const panelRef = useRef<HTMLElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const expandButtonRef = useRef<HTMLButtonElement>(null)
  const restoreExpandFocus = useRef(false)
  const edgeElements = useRef(new Map<string, SVGPathElement>())
  const drawnEdges = useRef(new Map<string, string>())
  const drag = useRef<{
    id: number
    x: number
    y: number
    view: GraphView
  } | null>(null)
  const titleId = useId(),
    markerId = useId().replace(/:/g, '')
  const fitted = fitGraph(graph, size.width, size.height),
    first = graph.nodes.find((node) => node.id === selectedId)
  const initialView =
    first && fitted.scale < 0.55
      ? {
          scale: 1,
          x: (size.width - first.width) / 2 - first.x,
          y: 18 - first.y,
        }
      : fitted
  const view =
    viewOverride?.layoutKey === layoutKey &&
    viewOverride.width === size.width &&
    viewOverride.height === size.height
      ? viewOverride.view
      : initialView
  // While the world glides to a new view, the nodes of the view it leaves stay drawn,
  // so they slide out of the viewport instead of vanishing at the start of the glide.
  const [glideFrom, setGlideFrom] = useState<GraphView | null>(null)
  useEffect(() => {
    if (!glideFrom) return
    const timer = setTimeout(() => setGlideFrom(null), MOTION_ENTER_MS)
    return () => clearTimeout(timer)
  }, [glideFrom])
  const setView = (next: GraphView | ((prior: GraphView) => GraphView)) => {
    if (!drag.current) setGlideFrom(view)
    setViewOverride({
      layoutKey,
      ...size,
      view: typeof next === 'function' ? next(view) : next,
    })
  }
  const focusNode = (node: GraphNode) => {
    setSelectedId(node.id)
    setView({
      scale: 1,
      x: (size.width - node.width) / 2 - node.x,
      y: Math.max(18, (size.height - node.height) / 2) - node.y,
    })
  }
  useLayoutEffect(() => {
    const element = viewportRef.current
    if (!element) return
    let settle: ReturnType<typeof setTimeout> | undefined
    const observer = new ResizeObserver(([entry]) => {
      // A resize (and the first measurement) refits at once. Only changes the person makes,
      // or a refreshed layout, glide.
      element.dataset.resizing = ''
      clearTimeout(settle)
      settle = setTimeout(() => {
        delete element.dataset.resizing
      }, MOTION_ENTER_MS)
      setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      })
    })
    observer.observe(element)
    return () => {
      observer.disconnect()
      clearTimeout(settle)
    }
  }, [fullscreen.mounted])

  const edgePaths = useMemo(() => graphEdgePaths(graph), [graph])
  const nodeRows = useListPresence(graph.nodes, (node) => node.id, {
    resetKey: presenceKey,
  })
  const edgeRows = useListPresence(edgePaths, (edge) => edge.key, {
    resetKey: presenceKey,
  })
  // An edge whose ends moved waits for the nodes to travel, then fades in along its new curve.
  useLayoutEffect(() => {
    const moved = movedEdgeKeys(drawnEdges.current, edgePaths)
    drawnEdges.current = new Map(edgePaths.map((edge) => [edge.key, edge.d]))
    if (!moved.length || viewportRef.current?.dataset.resizing !== undefined)
      return
    const reduced = prefersReducedMotion()
    for (const key of moved)
      edgeElements.current
        .get(key)
        ?.animate?.(
          reduced
            ? [{ opacity: 0 }, { opacity: 1 }]
            : [{ opacity: 0 }, { opacity: 0, offset: 0.45 }, { opacity: 1 }],
          {
            duration: reduced ? MOTION_BASE_MS : MOTION_ENTER_MS,
            easing: MOTION_EASE,
          },
        )
  }, [edgePaths])

  useEffect(() => {
    if (fullscreen.mounted || !restoreExpandFocus.current) return
    // The opener lived in the inline map, which was replaced while the dialog was open.
    restoreExpandFocus.current = false
    expandButtonRef.current?.focus({ preventScroll: true })
  }, [fullscreen.mounted])
  const openFullscreen = () => {
    setPlaceholderHeight(panelRef.current?.offsetHeight ?? 0)
    setExpanded(true)
  }
  const closeFullscreen = () => {
    restoreExpandFocus.current = true
    setExpanded(false)
  }

  const moveSelection = (direction: number) => {
    const index = Math.max(
      0,
      graph.nodes.findIndex((node) => node.id === selectedId),
    )
    const node =
      graph.nodes[
        Math.max(0, Math.min(graph.nodes.length - 1, index + direction))
      ]
    if (node) focusNode(node)
  }
  const zoom = (factor: number) =>
    setView((prior) =>
      zoomGraph(prior, prior.scale * factor, {
        x: size.width / 2,
        y: size.height / 2,
      }),
    )
  const onKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [70, 0],
      ArrowRight: [-70, 0],
      ArrowUp: [0, 70],
      ArrowDown: [0, -70],
    }
    if (moves[event.key]) {
      event.preventDefault()
      const [x, y] = moves[event.key]
      setView((prior) => ({ ...prior, x: prior.x + x, y: prior.y + y }))
    } else if (event.key === '+' || event.key === '=') {
      event.preventDefault()
      zoom(1.25)
    } else if (event.key === '-') {
      event.preventDefault()
      zoom(0.8)
    } else if (event.key === 'Home') {
      event.preventDefault()
      setView(fitGraph(graph, size.width, size.height))
    }
  }
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (
      event.button !== 0 ||
      (event.target as HTMLElement).closest('a,button,select,input')
    )
      return
    drag.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      view,
    }
    setDragging(true)
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current
    if (!start || start.id !== event.pointerId) return
    setView({
      ...start.view,
      x: start.view.x + event.clientX - start.x,
      y: start.view.y + event.clientY - start.y,
    })
  }
  const finishDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.id === event.pointerId) {
      drag.current = null
      setDragging(false)
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId)
  }
  // Cull spatially, but retain keyboard focus and provide a complete task picker plus previous/next controls.
  const inView = (node: GraphNode, at: GraphView) =>
    (node.x + node.width) * at.scale + at.x > -120 &&
    node.x * at.scale + at.x < size.width + 120 &&
    (node.y + node.height) * at.scale + at.y > -120 &&
    node.y * at.scale + at.y < size.height + 120
  const visibleNodes = graph.nodes.filter(
    (node) =>
      node.id === selectedId ||
      inView(node, view) ||
      (glideFrom !== null && inView(node, glideFrom)),
  )
  const visibleIds = new Set(visibleNodes.map((node) => node.id)),
    byId = new Map(graph.nodes.map((node) => [node.id, node]))
  const selectedIndex = graph.nodes.findIndex((node) => node.id === selectedId)
  // Leaving nodes and edges fade out where they were, even when culling would drop them.
  const shownNodes = nodeRows.filter(
    ({ item, phase }) => phase === 'exit' || visibleIds.has(item.id),
  )
  const shownEdges = edgeRows.filter(
    ({ item, phase }) =>
      phase === 'exit' || visibleIds.has(item.from) || visibleIds.has(item.to),
  )
  const surface = (
    <section
      ref={panelRef}
      className="tm-canvas-panel"
      aria-labelledby={titleId}
    >
      <header className="tm-canvas-toolbar">
        <h2 id={titleId}>작업 순서</h2>
        <label className="tm-task-jump">
          작업으로 이동
          <select
            value={selectedId ?? ''}
            onChange={(event) => {
              const node = byId.get(Number(event.target.value))
              if (node) focusNode(node)
            }}
          >
            {graph.nodes.map((node) => (
              <option key={node.id} value={node.id}>
                {node.task.title}
              </option>
            ))}
          </select>
        </label>
        <button
          ref={expandButtonRef}
          type="button"
          onClick={fullscreen.mounted ? closeFullscreen : openFullscreen}
        >
          {fullscreen.mounted ? '큰 화면 닫기' : '큰 화면'}
        </button>
      </header>
      <div
        ref={viewportRef}
        className="tm-viewport"
        tabIndex={0}
        role="region"
        aria-label="작업 연결 지도. 방향키로 이동, 더하기와 빼기로 확대 축소, Home으로 맞춤"
        onKeyDown={onKeyboard}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
      >
        <div
          className="tm-world"
          data-dragging={dragging || undefined}
          style={{
            width: graph.width,
            height: graph.height,
            transform: `translate(${view.x}px,${view.y}px) scale(${view.scale})`,
          }}
        >
          {graph.groups.map((group) => (
            <div
              key={group.id}
              className="tm-flow-group"
              style={{
                left: group.x,
                top: group.y,
                width: group.width,
                height: group.height,
              }}
            >
              <span>
                {group.title} · {group.count}개
              </span>
            </div>
          ))}
          <svg
            className="tm-edges"
            width={graph.width}
            height={graph.height}
            aria-hidden="true"
          >
            <defs>
              <marker
                id={markerId}
                markerWidth="8"
                markerHeight="8"
                refX="7"
                refY="4"
                orient="auto"
              >
                <path d="M0 0 L8 4 L0 8 Z" />
              </marker>
            </defs>
            {shownEdges.map(({ key, item: edge, phase }) => (
              <path
                key={key}
                ref={(element) => {
                  if (element) edgeElements.current.set(key, element)
                  else edgeElements.current.delete(key)
                }}
                className={
                  phase !== 'exit' &&
                  (edge.from === selectedId || edge.to === selectedId)
                    ? 'tm-edge--active'
                    : undefined
                }
                data-presence={phase === 'present' ? undefined : phase}
                d={edge.d}
                markerEnd={`url(#${markerId})`}
              />
            ))}
          </svg>
          {shownNodes.map(({ key, item: node, phase }) => (
            <div
              key={key}
              className="tm-node-slot"
              data-selected={
                (phase !== 'exit' && selectedId === node.id) || undefined
              }
              style={{
                width: node.width,
                height: node.height,
                transform: `translate(${node.x}px,${node.y}px)`,
              }}
            >
              <article
                className={`tm-node${matches.has(node.id) ? '' : ' tm-node--context'}${selectedId === node.id ? ' tm-node--selected' : ''}${isTaskCompleted(node.task) ? ' tm-node--completed' : ''}`}
                {...presenceProps(phase)}
              >
                <div className="tm-node-top">
                  <CategoryName category={categoryFor(node.id)} />
                  <time dateTime={taskDateKey(node.task) ?? undefined}>
                    {taskDateKey(node.task)?.slice(5).replace('-', '/') ??
                      '기한 없음'}
                  </time>
                </div>
                <TaskSurfaceLink
                  taskId={node.id}
                  open={open}
                  onFocus={(event) => {
                    if (event.currentTarget.matches(':focus-visible'))
                      focusNode(node)
                  }}
                  className="tm-node-title"
                >
                  <TaskTitle task={node.task} />
                </TaskSurfaceLink>
                <span
                  className={`tm-readiness tm-readiness--${taskReadiness(node.task)}`}
                >
                  {node.unresolvedOrder
                    ? '연결 순서 확인 필요'
                    : statusLabel[taskReadiness(node.task)]}
                </span>
                <div className="tm-predecessors">
                  {node.completedPredecessors.length > 0 && (
                    <span
                      title={node.completedPredecessors
                        .map((task) => task.title)
                        .join(', ')}
                    >
                      선행 완료 {node.completedPredecessors.length}개
                    </span>
                  )}
                  {node.missingPredecessors.length > 0 && (
                    <span>연결 미확인 {node.missingPredecessors.length}개</span>
                  )}
                </div>
                <TaskMetrics task={node.task} />
              </article>
            </div>
          ))}
        </div>
      </div>
      <footer className="tm-map-footer">
        <div className="tm-reading">
          <button
            type="button"
            disabled={selectedIndex <= 0}
            onClick={() => moveSelection(-1)}
          >
            이전 작업
          </button>
          <span aria-live="polite">
            {selectedIndex + 1} / {graph.nodes.length}
          </span>
          <button
            type="button"
            disabled={selectedIndex >= graph.nodes.length - 1}
            onClick={() => moveSelection(1)}
          >
            다음 작업
          </button>
        </div>
        <div className="tm-zoom">
          <button
            type="button"
            aria-label="축소"
            disabled={view.scale <= 0.25}
            onClick={() => zoom(0.8)}
          >
            −
          </button>
          <output aria-label="지도 배율">
            {Math.round(view.scale * 100)}%
          </output>
          <button
            type="button"
            aria-label="확대"
            disabled={view.scale >= 1.5}
            onClick={() => zoom(1.25)}
          >
            +
          </button>
          <button
            type="button"
            onClick={() => setView(fitGraph(graph, size.width, size.height))}
          >
            전체 맞춤
          </button>
        </div>
        <p>
          선을 따라 이전 작업 → 다음 작업으로 이어집니다. 모바일에서는 세로
          스크롤과 화면 확대를 사용할 수 있어요. 지도 배율은 25–150%이며 작업
          선택으로 읽기 좋은 크기로 이동합니다.
        </p>
      </footer>
    </section>
  )
  return fullscreen.mounted ? (
    <>
      {/* Holds the map's place on the page while it is open full screen, so nothing below jumps. */}
      <div
        className="tm-canvas-placeholder"
        style={{ height: placeholderHeight || undefined }}
        aria-hidden="true"
      />
      <Modal
        closing={fullscreen.closing}
        onClose={closeFullscreen}
        labelledBy={titleId}
        backdropClassName="tm-fullscreen-backdrop"
        className="tm-fullscreen"
      >
        {surface}
      </Modal>
    </>
  ) : (
    surface
  )
}

function MatrixQuadrant({
  index,
  items,
  resetKey,
  categoryFor,
  open,
}: {
  index: number
  items: Task[]
  /** Filters and the urgency rule: changing them starts a new baseline instead of animating the swap. */
  resetKey: string
  categoryFor: ReturnType<typeof useCategories>['taskCategory']
  open: OpenSurface
}) {
  // A task that a refresh moves to another quadrant leaves this one and rises into the other.
  const rows = useListPresence(items, (task) => task.id, { resetKey })
  const shownCount = Math.round(useTweenedNumber(items.length))
  return (
    <section className={`tm-quadrant tm-quadrant--${index}`}>
      <header>
        <span>{quadrantHints[index]}</span>
        <h2>
          {quadrantNames[index]} <small>{shownCount}</small>
        </h2>
      </header>
      <div className="tm-matrix-list">
        {rows.map(({ key, item: task, phase }) => (
          <article className="tm-matrix-task" key={key} {...presenceProps(phase)}>
            <div>
              <CategoryName category={categoryFor(task.id)} />
              <time dateTime={taskDateKey(task) ?? undefined}>
                {taskDateKey(task) ?? '기한 없음'}
              </time>
            </div>
            <TaskSurfaceLink taskId={task.id} open={open}>
              {task.title}
            </TaskSurfaceLink>
            <span
              className={`tm-readiness tm-readiness--${taskReadiness(task)}`}
            >
              {statusLabel[taskReadiness(task)]}
            </span>
            <TaskMetrics task={task} />
          </article>
        ))}
        {rows.length === 0 && (
          <p className="tm-empty-quadrant">이 구역의 작업이 없습니다.</p>
        )}
      </div>
    </section>
  )
}

function CompletedTaskList({
  tasks,
  resetKey,
  open,
}: {
  tasks: Task[]
  resetKey: string
  open: OpenSurface
}) {
  // A task completed elsewhere arrives here already struck through; a reopened one fades out.
  const rows = useListPresence(tasks, (task) => task.id, { resetKey })
  return (
    <details className="tm-completed-list">
      <summary>완료 작업 {tasks.length}개</summary>
      {rows.map(({ key, item: task, phase }) => (
        <span className="tm-completed-row" key={key} {...presenceProps(phase)}>
          <TaskSurfaceLink taskId={task.id} open={open}>
            <TaskTitle task={task} />
          </TaskSurfaceLink>
        </span>
      ))}
    </details>
  )
}

export default function TaskMapPage() {
  const [includeCompleted, setIncludeCompleted] = useState(false)
  const [mode, setMode] = useState<'sequence' | 'matrix'>('sequence')
  const [sort, setSort] = useState<GraphSort>('priority')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useProjectFilter()
  const [state, setState] = useState('all')
  const [urgentDays, setUrgentDays] = useState(2)
  const { data, isLoading, isRefreshing, error, count, reload, scopeKey } =
    useTaskGraph(includeCompleted)
  const { open } = useRouteSurfaceNavigation()
  const categories = useCategories(),
    mobile = useMobileMap(),
    today = useCurrentDay().format('YYYY-MM-DD')
  // A map that the person waited for rises in once. A cached one shows at once, and a refresh
  // keeps it mounted, so the entrance never replays.
  const arriving = useArrival(isLoading)
  const graph = useMemo(
    () =>
      buildTaskGraph(data?.tasks ?? [], {
        includeCompleted,
        mobile,
        sort,
        today,
      }),
    [data, includeCompleted, mobile, sort, today],
  )
  const matches = new Set(
    graph.nodes
      .filter(({ task }) => {
        const assigned = categories.taskCategory(task.id)
        return (
          (!query.trim() ||
            `${task.title} ${task.description}`
              .toLocaleLowerCase()
              .includes(query.trim().toLocaleLowerCase())) &&
          (category === 'all' ||
            (category === 'none' ? !assigned : assigned?.id === category)) &&
          (state === 'all' || taskReadiness(task) === state)
        )
      })
      .map((node) => node.id),
  )
  const matching = graph.nodes
    .filter((node) => matches.has(node.id))
    .map((node) => node.task)
    .sort(compareGraphTasks(sort, today))
  const unfinished = matching.filter((task) => !isTaskCompleted(task)),
    completed = matching.filter(isTaskCompleted)
  // Another space, project, zone or the completed toggle is a different map: it refits and
  // starts a new baseline instead of animating the whole swap.
  const layoutKey = `${scopeKey}:${mobile}:${sort}`,
    presenceKey = `${scopeKey}:${mobile}`,
    matrixKey = `${presenceKey}:${urgentDays}:${query.trim()}:${category}:${state}`
  // A failed refresh keeps the map; the server's message shows above it.
  const refreshError = error && data ? (
    <p className="tm-warning tm-refresh-error" role="alert">
      {error}{' '}
      <button type="button" onClick={reload}>
        다시 시도
      </button>
    </p>
  ) : null
  return (
    <section className="task-map-page">
      <header className="tm-page-header">
        <div>
          <p className="tm-eyebrow">전체 작업 한눈에 보기</p>
          <h1>작업 맵</h1>
          <p>목록의 페이지·필터와 관계없이 모든 미완료 작업을 불러옵니다.</p>
        </div>
        <TaskSurfaceLink
          taskId="new"
          open={open}
          className="tm-primary-link"
        >
          + 작업 추가
        </TaskSurfaceLink>
      </header>
      <div className="tm-page-tools">
        <div className="tm-view-switch" role="group" aria-label="작업 맵 보기">
          <button
            type="button"
            aria-pressed={mode === 'sequence'}
            onClick={() => setMode('sequence')}
          >
            시퀀스
          </button>
          <button
            type="button"
            aria-pressed={mode === 'matrix'}
            onClick={() => setMode('matrix')}
          >
            아이젠하워 매트릭스
          </button>
        </div>
        <label className="tm-completed-toggle">
          <input
            type="checkbox"
            checked={includeCompleted}
            onChange={(event) => {
              setIncludeCompleted(event.target.checked)
              if (!event.target.checked && state === 'completed')
                setState('all')
            }}
          />
          완료 작업 포함
        </label>
        <button
          type="button"
          disabled={isLoading}
          aria-busy={isRefreshing || undefined}
          onClick={reload}
        >
          새로고침
        </button>
      </div>
      <div className="tm-filters">
        <label className="tm-search">
          작업 검색
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="작업 이름·설명"
          />
        </label>
        <CategoryFilter value={category} onChange={setCategory} />
        <label>
          상태
          <select
            value={state}
            onChange={(event) => setState(event.target.value)}
          >
            <option value="all">모든 상태</option>
            <option value="ready">시작 가능</option>
            <option value="blocked">선행 대기</option>
            <option value="unknown">미확인</option>
            {includeCompleted && <option value="completed">완료</option>}
          </select>
        </label>
        <label>
          정렬
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as GraphSort)}
          >
            <option value="priority">우선순위</option>
            <option value="importance">중요도</option>
            <option value="deadline">마감순</option>
          </select>
        </label>
      </div>
      {categories.error && (
        <p className="tm-warning" role="status">
          프로젝트를 불러오지 못했습니다.{' '}
          <button
            type="button"
            onClick={() => {
              void categories.reload().catch(() => {})
            }}
          >
            다시 불러오기
          </button>
        </p>
      )}
      {isLoading ? (
        <StatusPanel
          variant="loading"
          title="전체 작업과 연결을 불러오는 중"
          description={`${count}개 작업 확인 중입니다. 완료 작업을 포함하면 시간이 더 걸릴 수 있어요.`}
        />
      ) : error && !data ? (
        <StatusPanel
          variant="error"
          title="작업 맵을 불러오지 못했어요"
          description={error}
          action={
            <button type="button" onClick={reload}>
              다시 시도
            </button>
          }
        />
      ) : graph.nodes.length === 0 ? (
        <>
          {refreshError}
          <StatusPanel
            variant="empty"
            title="아직 표시할 작업이 없어요"
            description="새 작업을 만들거나 완료 작업 포함을 선택해 보세요."
          />
        </>
      ) : (
        <div
          className="tm-content"
          data-arrive={arriving || undefined}
          aria-busy={isRefreshing || undefined}
        >
          {refreshError}
          <p className="tm-summary" role="status">
            전체 {graph.nodes.length}개 · 조건 일치 {matches.size}개
            {mode === 'sequence' &&
              ' · 조건에 맞는 작업을 강조하고 연결 맥락은 유지합니다.'}
          </p>
          {Boolean(data?.unavailableIds.length) && (
            <p className="tm-warning">
              이전 작업 {data!.unavailableIds.length}개의 정보를 확인할 수
              없습니다. 삭제·접근 권한·네트워크 상태를 확인해 주세요. 시작 가능
              여부는 서버의 미완료 선행 작업 수를 따릅니다.
            </p>
          )}
          {graph.unresolvedCount > 0 && (
            <p className="tm-warning">
              순환하거나 순서를 확인할 수 없는 연결이 있습니다. 작업 상세에서
              이전·다음 작업을 확인해 주세요.
            </p>
          )}
          {matches.size === 0 && (
            <p className="tm-warning">
              조건에 맞는 작업이 없습니다. 검색어나 필터를 바꿔 보세요.
            </p>
          )}
          {mode === 'sequence' ? (
            <SequenceMap
              graph={graph}
              matches={matches}
              categoryFor={categories.taskCategory}
              layoutKey={layoutKey}
              presenceKey={presenceKey}
              open={open}
            />
          ) : (
            <>
              <div className="tm-matrix-intro">
                <p>
                  중요도 7–9를 중요한 일로 분류합니다. 미완료 선행 작업이 있으면
                  해당 칸에서도 시작을 기다려야 합니다.
                </p>
                <label>
                  긴급 기준
                  <select
                    value={urgentDays}
                    onChange={(event) =>
                      setUrgentDays(Number(event.target.value))
                    }
                  >
                    <option value="0">오늘까지</option>
                    <option value="2">2일 이내</option>
                    <option value="7">7일 이내</option>
                  </select>
                </label>
              </div>
              <div className="tm-matrix">
                {quadrantNames.map((name, index) => (
                  <MatrixQuadrant
                    key={name}
                    index={index}
                    items={unfinished.filter(
                      (task) =>
                        matrixQuadrant(task, today, urgentDays) === index,
                    )}
                    resetKey={matrixKey}
                    categoryFor={categories.taskCategory}
                    open={open}
                  />
                ))}
              </div>
              {includeCompleted && (
                <CompletedTaskList
                  tasks={completed}
                  resetKey={matrixKey}
                  open={open}
                />
              )}
            </>
          )}
        </div>
      )}
    </section>
  )
}
