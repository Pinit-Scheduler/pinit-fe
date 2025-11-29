import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { ScheduleResponse, ScheduleState, ScheduleSummary } from '../types/schedule'
import { toDateKey } from '../utils/datetime'

export type ScheduleCacheValue = {
  schedulesByDate: Record<string, ScheduleSummary[]>
  getDateSchedules: (dateKey: string) => ScheduleSummary[] | undefined
  setDateSchedules: (dateKey: string, schedules: ScheduleSummary[]) => void
  updateScheduleState: (scheduleId: number, nextState: ScheduleState) => void
  upsertSchedule: (schedule: ScheduleSummary | ScheduleResponse) => void
  getScheduleSummary: (scheduleId: number) => ScheduleSummary | undefined
  activeSchedule?: ScheduleSummary
}

const ScheduleCacheContext = createContext<ScheduleCacheValue | null>(null)

const deriveActiveSchedule = (schedulesByDate: Record<string, ScheduleSummary[]>) => {
  for (const schedules of Object.values(schedulesByDate)) {
    const active = schedules.find((schedule) =>
      schedule.state === 'IN_PROGRESS' || schedule.state === 'SUSPENDED',
    )
    if (active) return active
  }
  return undefined
}

export const ScheduleCacheProvider = ({ children }: { children: ReactNode }) => {
  const [schedulesByDate, setSchedulesByDate] = useState<Record<string, ScheduleSummary[]>>({})

  const getDateSchedules = useCallback((dateKey: string) => schedulesByDate[dateKey], [
    schedulesByDate,
  ])

  const setDateSchedules = useCallback((dateKey: string, schedules: ScheduleSummary[]) => {
    setSchedulesByDate((prev) => ({ ...prev, [dateKey]: schedules }))
  }, [])

  const updateScheduleState = useCallback((scheduleId: number, nextState: ScheduleState) => {
    setSchedulesByDate((prev) => {
      const next: typeof prev = {}
      let changed = false
      Object.entries(prev).forEach(([key, list]) => {
        const updatedList = list.map((schedule) =>
          schedule.id === scheduleId ? { ...schedule, state: nextState } : schedule,
        )
        next[key] = updatedList
        if (!changed && JSON.stringify(updatedList) !== JSON.stringify(list)) {
          changed = true
        }
      })
      return changed ? next : prev
    })
  }, [])

  const upsertSchedule = useCallback((schedule: ScheduleSummary | ScheduleResponse) => {
    const dateKey = typeof schedule.date === 'string' ? schedule.date.slice(0, 10) : toDateKey(schedule.date)
    setSchedulesByDate((prev) => {
      const current = prev[dateKey] ?? []
      const existingIndex = current.findIndex((item) => item.id === schedule.id)
      const summary: ScheduleSummary = {
        id: schedule.id,
        title: schedule.title,
        description: schedule.description,
        date: schedule.date,
        deadline: schedule.deadline,
        importance: schedule.importance,
        urgency: schedule.urgency,
        state: schedule.state,
        // taskType은 ScheduleResponse에 없으므로 ScheduleSummary에만 있을 수 있음
        ...(('taskType' in schedule && schedule.taskType) ? { taskType: schedule.taskType } : {}),
      }
      const nextList = [...current]
      if (existingIndex >= 0) {
        nextList[existingIndex] = summary
      } else {
        nextList.push(summary)
      }
      return { ...prev, [dateKey]: nextList }
    })
  }, [])

  const getScheduleSummary = useCallback(
    (scheduleId: number) => {
      for (const schedules of Object.values(schedulesByDate)) {
        const found = schedules.find((item) => item.id === scheduleId)
        if (found) return found
      }
      return undefined
    },
    [schedulesByDate],
  )

  const value = useMemo<ScheduleCacheValue>(
    () => ({
      schedulesByDate,
      getDateSchedules,
      setDateSchedules,
      updateScheduleState,
      upsertSchedule,
      getScheduleSummary,
      activeSchedule: deriveActiveSchedule(schedulesByDate),
    }),
    [getDateSchedules, schedulesByDate, setDateSchedules, updateScheduleState, upsertSchedule, getScheduleSummary],
  )

  return <ScheduleCacheContext.Provider value={value}>{children}</ScheduleCacheContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export const useScheduleCache = () => {
  const ctx = useContext(ScheduleCacheContext)
  if (!ctx) {
    throw new Error('ScheduleCacheContext not found')
  }
  return ctx
}
