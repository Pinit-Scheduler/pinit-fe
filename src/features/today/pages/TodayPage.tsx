import { useEffect, useMemo, useState } from 'react'
import dayjs from 'dayjs'
import { fetchSchedules } from '@features/schedules/api/schedules'
import { fetchTasks, createScheduleFromTask } from '@features/tasks/api/tasks'
import { formatDateWithOffset, getTodayWithOffset, toApiDateTimeWithZone } from '@shared/utils/datetime'
import { useTimePreferences } from '@contexts/TimePreferencesContext'
import type { ScheduleResponse } from '@features/schedules/types/schedule'
import type { Task } from '@features/tasks/types/task'
import TaskScheduleModal from '@features/tasks/components/TaskScheduleModal'
import { useTaskCache } from '@contexts/TaskCacheContext'
import { getDeadlineStyle } from '@shared/utils/deadlineStyles'
import './TodayPage.css'
import { scheduleTypeLabelCompressed } from '@constants/schedules'
import { dispatchScheduleChanged, dispatchTaskChanged, onScheduleChanged, onTaskChanged } from '@shared/utils/events'

const TodayPage = () => {
  const { offsetMinutes } = useTimePreferences()
  const today = useMemo(() => getTodayWithOffset(offsetMinutes), [offsetMinutes])
  const [schedules, setSchedules] = useState<ScheduleResponse[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null)
  const [refreshKey, setRefreshKey] = useState(() => Date.now())
  const { tasksById, setTask } = useTaskCache()

  useEffect(() => {
    let mounted = true
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const timeParam = toApiDateTimeWithZone(today.hour(12))
        const [scheduleList, taskList] = await Promise.all([
          fetchSchedules(timeParam),
          fetchTasks({ page: 0, size: 10, readyOnly: true }),
        ])
        if (!mounted) return
        setSchedules(scheduleList)
        setTasks(taskList.content ?? [])
        ;(taskList.content ?? []).forEach(setTask)
      } catch (err) {
        if (!mounted) return
        setError(err instanceof Error ? err.message : '데이터를 불러오지 못했습니다.')
      } finally {
        if (mounted) setLoading(false)
      }
    }
    load()
    return () => {
      mounted = false
    }
  }, [today, setTask, refreshKey])

  useEffect(() => {
    const triggerRefresh = () => setRefreshKey(Date.now())
    const offSchedule = onScheduleChanged(triggerRefresh)
    const offTask = onTaskChanged(triggerRefresh)
    return () => {
      offSchedule()
      offTask()
    }
  }, [])

  const handleAssign = async (payload: Parameters<typeof createScheduleFromTask>[1]) => {
    if (selectedTaskId == null) return
    await createScheduleFromTask(selectedTaskId, payload)
    dispatchScheduleChanged({ reason: 'task-assigned' })
    dispatchTaskChanged({ taskId: selectedTaskId, reason: 'assigned' })
    setSelectedTaskId(null)
  }

  return (
    <section className="today-page">
      <header className="today-page__header">
        <p className="today-page__eyebrow">오늘 할당된 일</p>
        <h1 className="today-page__title">오늘 추천 작업 & 일정</h1>
        <p className="today-page__description">
          오늘 날짜의 일정과 선행 작업이 없는 작업을 모아 보여줍니다.
        </p>
      </header>

      <div className="today-page__content">
        {loading ? (
          <div className="today-page__placeholder">
            <p>불러오는 중...</p>
          </div>
        ) : error ? (
          <div className="today-page__placeholder">
            <p>데이터를 불러오지 못했습니다.</p>
            <p>{error}</p>
          </div>
        ) : (
          <>
            <section className="today-page__section">
              <h2>📅 오늘 일정 ({schedules.length}건)</h2>
              {schedules.length === 0 ? (
                <p className="today-page__placeholder">오늘 일정이 없습니다.</p>
              ) : (
                <ul className="today-page__list">
                  {schedules.map((item) => (
                    <li key={item.id}>
                      <strong>{item.title}</strong>
                      <span>{dayjs(item.date.dateTime).format('HH:mm')}</span>
                      {item.scheduleType && (
                        <span className="today-page__pill">{scheduleTypeLabelCompressed[item.scheduleType]}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="today-page__section">
              <h2>✅ 준비된 작업 ({tasks.length}건)</h2>
              {tasks.length === 0 ? (
                <p className="today-page__placeholder">선행 작업 없는 작업이 없습니다.</p>
              ) : (
                <ul className="today-page__list">
                  {tasks.map((task) => (
                    <li key={task.id}>
                      {(() => {
                        const cached = tasksById[task.id] ?? task
                        return (
                          <>
                            <strong>{cached.title}</strong>
                            <span className="today-page__pill" style={getDeadlineStyle(cached.dueDate)}>
                              {formatDateWithOffset(cached.dueDate, 'M/D')}
                            </span>
                            <span className="today-page__pill">
                              {(cached.completed ?? cached.isCompleted) ? '완료' : '미완료'}
                            </span>
                          </>
                        )
                      })()}
                      <button
                        type="button"
                        className="today-page__pill today-page__pill--action"
                        onClick={() => setSelectedTaskId(task.id)}
                      >
                        일정 배정
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>

      <TaskScheduleModal
        isOpen={selectedTaskId !== null}
        onClose={() => setSelectedTaskId(null)}
        onSubmit={handleAssign}
        defaultTitle={(() => {
          if (selectedTaskId == null) return undefined
          const t = tasksById[selectedTaskId] ?? tasks.find((task) => task.id === selectedTaskId)
          return t?.title
        })()}
        defaultDescription={(() => {
          if (selectedTaskId == null) return undefined
          const t = tasksById[selectedTaskId] ?? tasks.find((task) => task.id === selectedTaskId)
          return t?.description
        })()}
        taskLabel={selectedTaskId ? `작업 #${selectedTaskId}` : undefined}
      />
    </section>
  )
}

export default TodayPage
