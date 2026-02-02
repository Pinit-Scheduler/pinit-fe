import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { ScheduleResponse, ScheduleState } from '@features/schedules/types/schedule'

export type ScheduleCacheValue = {
  schedulesById: Record<number, ScheduleResponse>
  activeScheduleId: number | null
  activeSchedule: ScheduleResponse | null
  setSchedule: (schedule: ScheduleResponse) => void
  upsertSchedule: (schedule: ScheduleResponse) => void
  setActiveSchedule: (scheduleId: number | null) => void
  updateScheduleState: (
    scheduleId: number,
    nextState: ScheduleState,
    extras?: Partial<Pick<ScheduleResponse, 'scheduleType' | 'taskId' | 'duration'>>,
  ) => void
}

const ScheduleCacheContext = createContext<ScheduleCacheValue | null>(null)

export const ScheduleCacheProvider = ({ children }: { children: ReactNode }) => {
  const [schedulesById, setSchedulesById] = useState<Record<number, ScheduleResponse>>({})
  const [activeScheduleId, setActiveScheduleId] = useState<number | null>(null)

  const upsertSchedule = useCallback((schedule: ScheduleResponse) => {
    setSchedulesById((prev) => ({
      ...prev,
      [schedule.id]: schedule,
    }))
  }, [])

  // alias to keep existing callers readable
  const setSchedule = upsertSchedule

  const setActiveSchedule = useCallback((scheduleId: number | null) => {
    setActiveScheduleId(scheduleId)
  }, [])

  const updateScheduleState = useCallback(
    (
      scheduleId: number,
      nextState: ScheduleState,
      extras?: Partial<Pick<ScheduleResponse, 'scheduleType' | 'taskId' | 'duration'>>,
    ) => {
      setSchedulesById((prev) => {
        const current = prev[scheduleId]
        if (!current) return prev
        return {
          ...prev,
          [scheduleId]: {
            ...current,
            state: nextState,
            ...extras,
          },
        }
      })
      if (scheduleId === activeScheduleId && nextState === 'COMPLETED') {
        setActiveScheduleId(null)
      }
    },
    [activeScheduleId],
  )

  const value = useMemo(
    () => ({
      schedulesById,
      activeScheduleId,
      activeSchedule: activeScheduleId ? schedulesById[activeScheduleId] ?? null : null,
      setSchedule,
      upsertSchedule,
      setActiveSchedule,
      updateScheduleState,
    }),
    [activeScheduleId, schedulesById, setActiveSchedule, setSchedule, upsertSchedule, updateScheduleState],
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
