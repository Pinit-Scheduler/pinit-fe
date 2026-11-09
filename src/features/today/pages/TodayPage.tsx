import { useEffect, useState } from 'react'
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
import type { ScheduleResponse } from '@features/schedules/types/schedule'
import type { Task } from '@features/tasks/types/task'
import TaskScheduleModal from '@features/tasks/components/TaskScheduleModal'
import WorkspaceTaskCard from '@features/tasks/components/WorkspaceTaskCard'
import ScheduleCard from '@features/schedules/components/ScheduleCard'
import { useTaskCache } from '@contexts/TaskCacheContext'
import {
  dispatchScheduleChanged,
  dispatchTaskChanged,
  onScheduleChanged,
  onTaskChanged,
} from '@shared/utils/events'
import { useRouteSurfaceNavigation } from '@shared/routing/RouteSurface'
import WorkspaceIcon from '@shared/components/common/WorkspaceIcon'
import './TodayPage.css'
export default function TodayPage() {
  const today = useCurrentDay(),
    { open } = useRouteSurfaceNavigation()
  const [schedules, setSchedules] = useState<ScheduleResponse[]>([]),
    [ready, setReady] = useState<Task[]>([]),
    [due, setDue] = useState<Task[]>([])
  const [loadedKey, setLoadedKey] = useState(''),
    [errors, setErrors] = useState<{ tasks?: string; schedules?: string }>({})
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null),
    [refresh, setRefresh] = useState(0)
  const { setTask, tasksById } = useTaskCache()
  const requestKey = today.format('YYYY-MM-DDZ') + ':' + refresh
  const loading = loadedKey !== requestKey
  useEffect(() => {
    let cancelled = false
    Promise.allSettled([
      fetchSchedules(toApiDateTimeWithZone(today), {
        allSpaces: true,
        mine: true,
      }),
      fetchTasks({
        page: 0,
        size: 10,
        readyOnly: true,
        mine: true,
        spaceId: null,
        projectId: null,
      }),
      fetchTasksByDeadline(today.format('YYYY-MM-DD')),
    ]).then(([s, r, d]) => {
      if (cancelled) return
      const next: { tasks?: string; schedules?: string } = {}
      if (s.status === 'fulfilled') setSchedules(s.value)
      else
        next.schedules =
          s.reason instanceof Error
            ? s.reason.message
            : '일정을 불러오지 못했어요.'
      if (r.status === 'fulfilled' && d.status === 'fulfilled') {
        setReady(r.value.content ?? [])
        setDue(d.value)
        ;[...(r.value.content ?? []), ...d.value].forEach(setTask)
      } else next.tasks = '작업을 불러오지 못했어요. 다시 시도해 주세요.'
      setErrors(next)
      setLoadedKey(requestKey)
    })
    return () => {
      cancelled = true
    }
  }, [today, setTask, refresh, requestKey])
  useEffect(() => {
    const reload = () => setRefresh((x) => x + 1)
    const a = onScheduleChanged(reload),
      b = onTaskChanged(reload)
    return () => {
      a()
      b()
    }
  }, [])
  const assign = async (
    payload: Parameters<typeof createScheduleFromTask>[1],
    expectedVersion?: number,
  ) => {
    if (selectedTaskId === null) return
    await createScheduleFromTask(selectedTaskId, payload, expectedVersion)
    dispatchScheduleChanged({ reason: 'task-assigned' })
    dispatchTaskChanged({ taskId: selectedTaskId, reason: 'assigned' })
    setSelectedTaskId(null)
  }
  const selected =
    selectedTaskId === null
      ? undefined
      : (tasksById[selectedTaskId] ??
        [...ready, ...due].find((t) => t.id === selectedTaskId))
  const error = (message: string) => (
    <div className="workspace-inline-error" role="alert">
      <span>{message}</span>
      <button onClick={() => setRefresh((x) => x + 1)}>다시 시도</button>
    </div>
  )
  const taskCard = (t: Task) => (
    <WorkspaceTaskCard
      key={t.id}
      task={t}
      onOpen={() => open('/app/tasks/' + t.id)}
      onAssign={() => setSelectedTaskId(t.id)}
    />
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
          <Link className="workspace-button" to="/app/plan">
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
      <div className="today-workspace">
        <section
          className="workspace-panel today-workspace__tasks"
          aria-busy={loading}
        >
          <div className="workspace-panel__head">
            <h2>오늘의 작업</h2>
            <span className="today-page__legend">
              <i />
              중요도 <i />
              난이도
            </span>
          </div>
          <div className="today-workspace__task-body">
            {loading ? (
              <p className="today-page__empty" role="status">
                작업을 불러오는 중…
              </p>
            ) : errors.tasks ? (
              error(errors.tasks)
            ) : (
              <>
                <h3 className="today-page__section-title">
                  오늘 마감 <span>{due.length}</span>
                </h3>
                {due.length ? (
                  due.map(taskCard)
                ) : (
                  <p className="today-page__empty">
                    오늘 마감인 작업이 없어요.
                  </p>
                )}
                <h3 className="today-page__section-title">
                  바로 시작할 수 있는 작업
                </h3>
                {ready.length ? (
                  ready.map(taskCard)
                ) : (
                  <p className="today-page__empty">
                    바로 시작할 수 있는 작업이 없어요.
                  </p>
                )}
              </>
            )}
          </div>
          <Link className="today-page__all" to="/app/tasks">
            <WorkspaceIcon name="task" />
            전체 작업 보기
          </Link>
        </section>
        <section
          className="workspace-panel today-workspace__schedules"
          aria-busy={loading}
        >
          <div className="workspace-panel__head">
            <h2>오늘의 일정</h2>
            <Link to="/app/schedules">달력 보기 →</Link>
          </div>
          <div className="today-page__schedule-date">
            <WorkspaceIcon name="calendar" />
            {today.format('M월 D일 (dd)')}
            <span>{schedules.length}개</span>
          </div>
          <div className="today-page__schedule-list">
            {loading ? (
              <p className="today-page__empty" role="status">
                일정을 불러오는 중…
              </p>
            ) : errors.schedules ? (
              error(errors.schedules)
            ) : schedules.length ? (
              [...schedules]
                .sort((a, b) => a.date.dateTime.localeCompare(b.date.dateTime))
                .map((s) => (
                  <div className="today-page__schedule-row" key={s.id}>
                    <time>{formatDateTimeWithZone(s.date, 'HH:mm')}</time>
                    <ScheduleCard
                      schedule={s}
                      onOpenDetail={(id) => open('/app/schedules/' + id)}
                    />
                  </div>
                ))
            ) : (
              <p className="today-page__empty">
                오늘 일정이 없어요. 새로운 일정을 추가해 보세요.
              </p>
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
