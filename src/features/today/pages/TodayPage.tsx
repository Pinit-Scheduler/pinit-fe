import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { Link } from 'react-router-dom'
import { fetchSchedules } from '@features/schedules/api/schedules'
import {
  fetchTasks,
  fetchTasksByDeadline,
  createScheduleFromTask,
  fetchTaskDetail,
} from '@features/tasks/api/tasks'
import {
  formatDateTimeWithZone,
  toApiDateTimeWithZone,
} from '@shared/utils/datetime'
import useCurrentDay from '@shared/hooks/useCurrentDay'
import useRevalidatingQuery from '@shared/hooks/useRevalidatingQuery'
import type { ScheduleResponse } from '@features/schedules/types/schedule'
import type { Task } from '@features/tasks/types/task'
import TaskScheduleModal from '@features/tasks/components/TaskScheduleModal'
import WorkspaceTaskCard from '@features/tasks/components/WorkspaceTaskCard'
import ScheduleCard from '@features/schedules/components/ScheduleCard'
import { useTaskCache } from '@contexts/TaskCacheContext'
import { useScheduleCache } from '@contexts/ScheduleCacheContext'
import { useTimePreferences } from '@contexts/TimePreferencesContext'
import {
  dispatchScheduleChanged,
  dispatchTaskChanged,
} from '@shared/utils/events'
import { useRouteSurfaceNavigation } from '@shared/routing/RouteSurface'
import { tabLinkClick } from '@shared/routing/viewTransitionNavigation'
import { useListPresence, presenceProps } from '@shared/motion/useListPresence'
import { useTweenedNumber } from '@shared/motion/useTweenedNumber'
import type { PresenceEntry } from '@shared/motion/presence'
import WorkspaceIcon from '@shared/components/common/WorkspaceIcon'
import { useSettlingList } from '../settle'
import { moveFocusOutOfLeavingRow } from '../focus'
import { getRequestFailureMessage } from '@shared/api/errorMessage'
import './TodayPage.css'

type TodayTasks = { ready: Task[]; due: Task[] }

const TASKS_ERROR = '작업을 불러오지 못했어요. 다시 시도해 주세요.'
const SCHEDULES_ERROR = '일정을 불러오지 못했어요.'
const tasksError = (e: unknown) =>
  getRequestFailureMessage(e, '작업을 불러오지 못했어요. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.')
const schedulesError = (e: unknown) =>
  getRequestFailureMessage(e, `${SCHEDULES_ERROR} 인터넷 연결을 확인한 뒤 다시 시도해 주세요.`)
const taskKey = (task: Task) => task.id
const scheduleKey = (schedule: ScheduleResponse) => schedule.id
const isDone = (task: Task) => task.completed ?? task.isCompleted ?? false
const byStart = (a: ScheduleResponse, b: ScheduleResponse) =>
  a.date.dateTime.localeCompare(b.date.dateTime)

/** A count that glides to its new value. Mount it only once the data is there. */
const Count = ({ value }: { value: number }) => (
  <>{Math.round(useTweenedNumber(value))}</>
)

/**
 * Remembers that this mount showed a loading line for the current key, so the content that
 * replaces it fades in. Content shown straight from the cache (a return to the tab) does not.
 */
const useRevealAfterLoading = (isInitialLoading: boolean) => {
  const [seen, setSeen] = useState(isInitialLoading)
  if (isInitialLoading && !seen) setSeen(true)
  return seen
}

/**
 * Whether this list showed rows for the current day on this mount. An empty line fades in only
 * when it replaces rows that just left, not when a cached empty list is shown again.
 */
const useHadRows = (count: number, resetKey: string) => {
  const [state, setState] = useState({ resetKey, had: count > 0 })
  if (state.resetKey !== resetKey) {
    const next = { resetKey, had: count > 0 }
    setState(next)
    return next.had
  }
  if (count > 0 && !state.had) setState({ resetKey, had: true })
  return state.had || count > 0
}

const emptyLine = (text: string, afterRows: boolean) => (
  <p
    className={
      'today-page__empty' + (afterRows ? ' today-page__empty--after-rows' : '')
    }
  >
    {text}
  </p>
)

const headingOf = (leaving: HTMLElement) =>
  leaving.closest('section')?.querySelector<HTMLElement>('h2') ?? null

export default function TodayPage() {
  const today = useCurrentDay(),
    { zoneId } = useTimePreferences(),
    { open } = useRouteSurfaceNavigation()
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null)
  const { setTask, tasksById } = useTaskCache()
  const { setSchedule } = useScheduleCache()
  // The key names the day only. A change event refetches the same key and keeps the panels.
  const dayKey = today.format('YYYY-MM-DD') + '@' + zoneId
  const tasksQuery = useRevalidatingQuery<TodayTasks>(
    'today/tasks/' + dayKey,
    async (signal) => {
      const [ready, due] = await Promise.all([
        fetchTasks({
          page: 0,
          size: 10,
          readyOnly: true,
          mine: true,
          spaceId: null,
          projectId: null,
          signal,
        }),
        fetchTasksByDeadline(today.format('YYYY-MM-DD')),
      ])
      return { ready: ready.content ?? [], due }
    },
    {
      invalidateOn: ['task', 'schedule'],
      group: 'today/tasks/',
      errorMessage: tasksError,
    },
  )
  const schedulesQuery = useRevalidatingQuery<ScheduleResponse[]>(
    'today/schedules/' + dayKey,
    () =>
      fetchSchedules(toApiDateTimeWithZone(today), {
        allSpaces: true,
        mine: true,
      }),
    {
      invalidateOn: ['task', 'schedule'],
      group: 'today/schedules/',
      errorMessage: schedulesError,
    },
  )
  const tasks = tasksQuery.data,
    schedules = schedulesQuery.data
  // Cards read the shared cache first. Only responses the query accepted reach it, and the
  // cache keeps the newer version, so a slow read can never undo a save on screen.
  useEffect(() => {
    if (tasks) [...tasks.ready, ...tasks.due].forEach(setTask)
  }, [tasks, setTask])
  useEffect(() => {
    schedules?.forEach((schedule) => setSchedule(schedule))
  }, [schedules, setSchedule])

  // A task completed from the ready list drops out of the next read. Hold it for a beat so the
  // check and strike finish, then fade it out. Deleted or reassigned tasks leave at once.
  const settled = (task: Task) => isDone(tasksById[task.id] ?? task)
  const readyShown = useSettlingList(tasks?.ready, taskKey, settled, {
    resetKey: dayKey,
  })
  const readyRows = useListPresence(readyShown, taskKey, { resetKey: dayKey })
  const dueRows = useListPresence(tasks?.due, taskKey, { resetKey: dayKey })
  const sortedSchedules = useMemo(
    () => schedules && [...schedules].sort(byStart),
    [schedules],
  )
  const scheduleRows = useListPresence(sortedSchedules, scheduleKey, {
    resetKey: dayKey,
  })
  const revealTasks = useRevealAfterLoading(tasksQuery.isInitialLoading)
  const revealSchedules = useRevealAfterLoading(schedulesQuery.isInitialLoading)
  const dueHadRows = useHadRows(dueRows.length, dayKey)
  const readyHadRows = useHadRows(readyRows.length, dayKey)
  const schedulesHadRows = useHadRows(scheduleRows.length, dayKey)

  // A leaving row turns inert in this commit. Hand the focus on before the browser drops it.
  const workspaceRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    moveFocusOutOfLeavingRow(workspaceRef.current, headingOf)
  }, [readyRows, dueRows, scheduleRows])

  const assign = async (
    payload: Parameters<typeof createScheduleFromTask>[1],
    expectedVersion?: number,
  ) => {
    if (selectedTaskId === null) return
    await createScheduleFromTask(selectedTaskId, payload, expectedVersion)
    // Both events reach each listener as one batch, so each panel refetches once.
    dispatchScheduleChanged({ reason: 'task-assigned' })
    dispatchTaskChanged({ taskId: selectedTaskId, reason: 'assigned' })
    setSelectedTaskId(null)
  }
  const selected =
    selectedTaskId === null
      ? undefined
      : (tasksById[selectedTaskId] ??
        [...(tasks?.ready ?? []), ...(tasks?.due ?? [])].find(
          (t) => t.id === selectedTaskId,
        ))
  const error = (message: string, retry: () => void) => (
    <div className="workspace-inline-error" role="alert">
      <span>{message}</span>
      <button onClick={retry}>다시 시도</button>
    </div>
  )
  const taskRows = (rows: PresenceEntry<Task>[], empty: ReactNode) =>
    rows.length ? (
      <div className="today-page__task-list">
        {rows.map(({ key, item, phase }) => (
          <div
            className="today-page__task-row"
            key={key}
            {...presenceProps(phase)}
          >
            <WorkspaceTaskCard
              task={item}
              onOpen={() => open('/app/tasks/' + item.id)}
              onAssign={() => setSelectedTaskId(item.id)}
            />
          </div>
        ))}
      </div>
    ) : (
      empty
    )
  return (
    <section className="today-page">
      <header
        className="workspace-page-header"
        data-onboarding-anchor="today.header"
      >
        <div>
          <div className="today-page__date">
            {today.format('YYYY년 M월 D일 dddd')}
          </div>
          <h1>오늘의 내 작업</h1>
          <p>
            모든 스페이스에서 내게 배정된 일정과 작업을 확인하세요. 오늘 마감과 시작
            가능한 작업은 함께 표시될 수 있어요.
          </p>
        </div>
        <div className="workspace-page-actions">
          <Link
            className="workspace-button"
            to="/app/plan"
            onClick={tabLinkClick('/app/plan')}
          >
            <WorkspaceIcon name="sun" />
            하루 계획
          </Link>
          <button
            className="workspace-button workspace-button--primary"
            onClick={() =>
              open('/app/schedules/new', {
                state: { initialDateKey: today.format('YYYY-MM-DD') },
              })
            }
          >
            <WorkspaceIcon name="plus" />
            일정 추가
          </button>
          <button
            className="workspace-button workspace-button--primary"
            onClick={() => open('/app/tasks/new?from=today')}
          >
            <WorkspaceIcon name="plus" />
            작업 추가
          </button>
        </div>
      </header>
      <div className="today-workspace" ref={workspaceRef}>
        <section
          className="workspace-panel today-workspace__tasks"
          aria-busy={tasksQuery.isFetching || undefined}
        >
          <div className="workspace-panel__head">
            <h2 tabIndex={-1}>오늘의 작업</h2>
            <span className="today-page__legend">
              <i />
              중요도 <i />
              난이도
            </span>
          </div>
          <div className="today-workspace__task-body">
            {tasksQuery.isInitialLoading ? (
              <p className="today-page__empty today-page__loading" role="status">
                작업을 불러오는 중…
              </p>
            ) : !tasks ? (
              error(tasksQuery.error ?? TASKS_ERROR, tasksQuery.refetch)
            ) : (
              <div className={revealTasks ? 'today-page__reveal' : undefined}>
                {tasksQuery.error && error(tasksQuery.error, tasksQuery.refetch)}
                <h3 className="today-page__section-title">
                  오늘 마감{' '}
                  <span>
                    <Count value={tasks.due.length} />
                  </span>
                </h3>
                {taskRows(
                  dueRows,
                  emptyLine('오늘 마감인 작업이 없어요.', dueHadRows),
                )}
                <h3 className="today-page__section-title">
                  바로 시작할 수 있는 작업
                </h3>
                {taskRows(
                  readyRows,
                  emptyLine('바로 시작할 수 있는 작업이 없어요.', readyHadRows),
                )}
              </div>
            )}
          </div>
          <Link
            className="today-page__all"
            to="/app/tasks"
            onClick={tabLinkClick('/app/tasks')}
          >
            <WorkspaceIcon name="task" />
            전체 작업 보기
          </Link>
        </section>
        <section
          className="workspace-panel today-workspace__schedules"
          aria-busy={schedulesQuery.isFetching || undefined}
        >
          <div className="workspace-panel__head">
            <h2 tabIndex={-1}>오늘의 일정</h2>
            <Link to="/app/schedules" onClick={tabLinkClick('/app/schedules')}>
              달력 보기 →
            </Link>
          </div>
          <div className="today-page__schedule-date">
            <WorkspaceIcon name="calendar" />
            {today.format('M월 D일 (dd)')}
            {schedules && (
              <span
                className={
                  'today-page__count' +
                  (revealSchedules ? ' today-page__count--reveal' : '')
                }
              >
                <Count value={schedules.length} />개
              </span>
            )}
          </div>
          <div className="today-page__schedule-list">
            {schedulesQuery.isInitialLoading ? (
              <p className="today-page__empty today-page__loading" role="status">
                일정을 불러오는 중…
              </p>
            ) : !schedules ? (
              error(
                schedulesQuery.error ?? SCHEDULES_ERROR,
                schedulesQuery.refetch,
              )
            ) : (
              <div className={revealSchedules ? 'today-page__reveal' : undefined}>
                {schedulesQuery.error &&
                  error(schedulesQuery.error, schedulesQuery.refetch)}
                {scheduleRows.length ? (
                  scheduleRows.map(({ key, item: s, phase }) => (
                    <div
                      className="today-page__schedule-row"
                      key={key}
                      data-state={s.state.toLowerCase()}
                      {...presenceProps(phase)}
                    >
                      <time>{formatDateTimeWithZone(s.date, 'HH:mm')}</time>
                      <ScheduleCard
                        schedule={s}
                        onOpenDetail={(id) => open('/app/schedules/' + id)}
                      />
                    </div>
                  ))
                ) : (
                  emptyLine(
                    '오늘 일정이 없어요. 새로운 일정을 추가해 보세요.',
                    schedulesHadRows,
                  )
                )}
              </div>
            )}
          </div>
        </section>
      </div>
      <TaskScheduleModal
        isOpen={selectedTaskId !== null}
        expectedVersion={selected?.version}
        onClose={() => setSelectedTaskId(null)}
        onSubmit={assign}
        onConflict={async () => {
          if (selectedTaskId === null) return undefined
          const latest = await fetchTaskDetail(selectedTaskId)
          setTask(latest)
          return latest.version
        }}
        defaultTitle={selected?.title}
        defaultDescription={selected?.description}
        taskLabel={selected?.title}
      />
    </section>
  )
}
