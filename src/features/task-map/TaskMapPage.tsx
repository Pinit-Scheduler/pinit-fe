import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'
import { Link } from 'react-router-dom'
import Modal from '@shared/components/common/Modal'
import StatusPanel from '@shared/components/common/StatusPanel'
import useCurrentDay from '@shared/hooks/useCurrentDay'
import {
  CategoryBadge,
  CategoryFilter,
  useCategories,
} from '@features/categories'
import type { Task } from '@features/tasks/types/task'
import {
  buildTaskGraph,
  compareGraphTasks,
  fitGraph,
  isTaskCompleted,
  matrixQuadrant,
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
}: {
  graph: TaskGraph
  matches: Set<number>
  categoryFor: ReturnType<typeof useCategories>['taskCategory']
}) {
  const [viewOverride, setViewOverride] = useState<{
    graph: TaskGraph
    width: number
    height: number
    view: GraphView
  } | null>(null)
  const [size, setSize] = useState({ width: 800, height: 440 })
  const [expanded, setExpanded] = useState(false)
  const [selected, setSelectedId] = useState<number | null>(null)
  const selectedId = graph.nodes.some((node) => node.id === selected)
    ? selected
    : (graph.nodes[0]?.id ?? null)
  const viewportRef = useRef<HTMLDivElement>(null)
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
    viewOverride?.graph === graph &&
    viewOverride.width === size.width &&
    viewOverride.height === size.height
      ? viewOverride.view
      : initialView
  const setView = (next: GraphView | ((prior: GraphView) => GraphView)) =>
    setViewOverride({
      graph,
      ...size,
      view: typeof next === 'function' ? next(view) : next,
    })
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
    const observer = new ResizeObserver(([entry]) =>
      setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      }),
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [expanded])

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
    if (drag.current?.id === event.pointerId) drag.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId)
  }
  // Cull spatially, but retain keyboard focus and provide a complete task picker plus previous/next controls.
  const visibleNodes = graph.nodes.filter(
    (node) =>
      node.id === selectedId ||
      ((node.x + node.width) * view.scale + view.x > -120 &&
        node.x * view.scale + view.x < size.width + 120 &&
        (node.y + node.height) * view.scale + view.y > -120 &&
        node.y * view.scale + view.y < size.height + 120),
  )
  const visibleIds = new Set(visibleNodes.map((node) => node.id)),
    byId = new Map(graph.nodes.map((node) => [node.id, node]))
  const selectedIndex = graph.nodes.findIndex((node) => node.id === selectedId)
  const surface = (
    <section className="tm-canvas-panel" aria-labelledby={titleId}>
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
        <button type="button" onClick={() => setExpanded(!expanded)}>
          {expanded ? '큰 화면 닫기' : '큰 화면'}
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
            {graph.edges
              .filter(
                (edge) => visibleIds.has(edge.from) || visibleIds.has(edge.to),
              )
              .map((edge) => {
                const a = byId.get(edge.from)!,
                  b = byId.get(edge.to)!,
                  vertical = graph.mobile && a.rank !== b.rank
                const x1 = vertical ? a.x + a.width / 2 : a.x + a.width,
                  y1 = vertical ? a.y + a.height : a.y + a.height / 2
                const x2 = vertical ? b.x + b.width / 2 : b.x,
                  y2 = vertical ? b.y : b.y + b.height / 2
                const path = vertical
                  ? `M${x1},${y1} C${x1},${(y1 + y2) / 2} ${x2},${(y1 + y2) / 2} ${x2},${y2}`
                  : `M${x1},${y1} C${(x1 + x2) / 2},${y1} ${(x1 + x2) / 2},${y2} ${x2},${y2}`
                return (
                  <path
                    key={`${edge.from}:${edge.to}`}
                    d={path}
                    markerEnd={`url(#${markerId})`}
                  />
                )
              })}
          </svg>
          {visibleNodes.map((node) => (
            <article
              key={node.id}
              className={`tm-node${matches.has(node.id) ? '' : ' tm-node--context'}${selectedId === node.id ? ' tm-node--selected' : ''}`}
              style={{
                left: node.x,
                top: node.y,
                width: node.width,
                height: node.height,
              }}
            >
              <div className="tm-node-top">
                <CategoryBadge category={categoryFor(node.id)} />
                <time dateTime={taskDateKey(node.task) ?? undefined}>
                  {taskDateKey(node.task)?.slice(5).replace('-', '/') ??
                    '기한 없음'}
                </time>
              </div>
              <Link
                to={`/app/tasks/${node.id}`}
                onFocus={(event) => {
                  if (event.currentTarget.matches(':focus-visible'))
                    focusNode(node)
                }}
                className="tm-node-title"
              >
                {node.task.title}
              </Link>
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
  return expanded ? (
    <Modal
      onClose={() => setExpanded(false)}
      labelledBy={titleId}
      backdropClassName="tm-fullscreen-backdrop"
      className="tm-fullscreen"
    >
      {surface}
    </Modal>
  ) : (
    surface
  )
}

export default function TaskMapPage() {
  const [includeCompleted, setIncludeCompleted] = useState(false)
  const [mode, setMode] = useState<'sequence' | 'matrix'>('sequence')
  const [sort, setSort] = useState<GraphSort>('priority')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<number | 'none' | 'all'>('all')
  const [state, setState] = useState('all')
  const [urgentDays, setUrgentDays] = useState(2)
  const { data, isLoading, error, count, reload } =
    useTaskGraph(includeCompleted)
  const categories = useCategories(),
    mobile = useMobileMap(),
    today = useCurrentDay().format('YYYY-MM-DD')
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
  return (
    <section className="task-map-page">
      <header className="tm-page-header">
        <div>
          <p className="tm-eyebrow">전체 작업 한눈에 보기</p>
          <h1>작업 맵</h1>
          <p>목록의 페이지·필터와 관계없이 모든 미완료 작업을 불러옵니다.</p>
        </div>
        <Link className="tm-primary-link" to="/app/tasks/new">
          + 작업 추가
        </Link>
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
        <button type="button" disabled={isLoading} onClick={reload}>
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
          카테고리를 불러오지 못했습니다.{' '}
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
      ) : error ? (
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
        <StatusPanel
          variant="empty"
          title="아직 표시할 작업이 없어요"
          description="새 작업을 만들거나 완료 작업 포함을 선택해 보세요."
        />
      ) : (
        <>
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
                {quadrantNames.map((name, index) => {
                  const items = unfinished.filter(
                    (task) => matrixQuadrant(task, today, urgentDays) === index,
                  )
                  return (
                    <section
                      className={`tm-quadrant tm-quadrant--${index}`}
                      key={name}
                    >
                      <header>
                        <span>{quadrantHints[index]}</span>
                        <h2>
                          {name} <small>{items.length}</small>
                        </h2>
                      </header>
                      <div className="tm-matrix-list">
                        {items.map((task) => (
                          <article className="tm-matrix-task" key={task.id}>
                            <div>
                              <CategoryBadge
                                category={categories.taskCategory(task.id)}
                              />
                              <time dateTime={taskDateKey(task) ?? undefined}>
                                {taskDateKey(task) ?? '기한 없음'}
                              </time>
                            </div>
                            <Link to={`/app/tasks/${task.id}`}>
                              {task.title}
                            </Link>
                            <span
                              className={`tm-readiness tm-readiness--${taskReadiness(task)}`}
                            >
                              {statusLabel[taskReadiness(task)]}
                            </span>
                            <TaskMetrics task={task} />
                          </article>
                        ))}
                        {!items.length && (
                          <p className="tm-empty-quadrant">
                            이 구역의 작업이 없습니다.
                          </p>
                        )}
                      </div>
                    </section>
                  )
                })}
              </div>
              {includeCompleted && (
                <details className="tm-completed-list">
                  <summary>완료 작업 {completed.length}개</summary>
                  {completed.map((task) => (
                    <Link key={task.id} to={`/app/tasks/${task.id}`}>
                      {task.title}
                    </Link>
                  ))}
                </details>
              )}
            </>
          )}
        </>
      )}
    </section>
  )
}
