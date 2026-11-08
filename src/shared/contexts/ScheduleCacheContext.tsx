import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { ReactNode } from 'react'
import type {
  ScheduleResponse,
  ScheduleState,
} from '@features/schedules/types/schedule'

export type ScheduleCacheValue = {
  schedulesById: Record<number, ScheduleResponse>
  activeScheduleId: number | null
  activeSchedule: ScheduleResponse | null
  setSchedule: (schedule: ScheduleResponse) => void
  upsertSchedule: (schedule: ScheduleResponse) => void
  invalidateSchedules: (scheduleIds: number[]) => void
  setActiveSchedule: (scheduleId: number | null) => void
  pendingScheduleId: number | null
  beginMutation: (scheduleId: number) => boolean
  endMutation: (scheduleId: number) => void
  updateScheduleState: (
    scheduleId: number,
    nextState: ScheduleState,
    extras?: Partial<
      Pick<ScheduleResponse, 'scheduleType' | 'taskId' | 'duration'>
    >,
  ) => void
}

const ScheduleCacheContext = createContext<ScheduleCacheValue | null>(null)

export const ScheduleCacheProvider = ({
  children,
}: {
  children: ReactNode
}) => {
  const [schedulesById, setSchedulesById] = useState<
    Record<number, ScheduleResponse>
  >({})
  const [activeScheduleId, setActiveScheduleId] = useState<number | null>(null)
  const [pendingScheduleId, setPendingScheduleId] = useState<number | null>(
    null,
  )
  const pendingRef = useRef<number | null>(null)
  const beginMutation = useCallback((id: number) => {
    if (pendingRef.current !== null) return false
    pendingRef.current = id
    setPendingScheduleId(id)
    return true
  }, [])
  const endMutation = useCallback((id: number) => {
    if (pendingRef.current !== id) return
    pendingRef.current = null
    setPendingScheduleId(null)
  }, [])

  const upsertSchedule = useCallback((schedule: ScheduleResponse) => {
    setSchedulesById((prev) => ({
      ...prev,
      [schedule.id]: schedule,
    }))
  }, [])

  const invalidateSchedules = useCallback((scheduleIds: number[]) => {
    setSchedulesById((previous) => {
      const next = { ...previous }
      scheduleIds.forEach((id) => { delete next[id] })
      return next
    })
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
      extras?: Partial<
        Pick<ScheduleResponse, 'scheduleType' | 'taskId' | 'duration'>
      >,
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
      pendingScheduleId,
      beginMutation,
      endMutation,
      activeSchedule: activeScheduleId
        ? (schedulesById[activeScheduleId] ?? null)
        : null,
      setSchedule,
      upsertSchedule,
      invalidateSchedules,
      setActiveSchedule,
      updateScheduleState,
    }),
    [
      activeScheduleId,
      pendingScheduleId,
      beginMutation,
      endMutation,
      schedulesById,
      setActiveSchedule,
      setSchedule,
      upsertSchedule,
      invalidateSchedules,
      updateScheduleState,
    ],
  )

  return (
    <ScheduleCacheContext.Provider value={value}>
      {children}
    </ScheduleCacheContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export const useScheduleCache = () => {
  const ctx = useContext(ScheduleCacheContext)
  if (!ctx) {
    throw new Error('ScheduleCacheContext not found')
  }
  return ctx
}
