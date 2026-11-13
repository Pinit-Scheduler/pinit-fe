import { isSpaceUnavailable, isResourceUnavailable } from '@features/spaces/metadata'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { ReactNode } from 'react'
import type { ScheduleResponse } from '@features/schedules/types/schedule'

export type ScheduleCacheValue = {
  schedulesById: Record<number, ScheduleResponse>
  activeScheduleId: number | null
  activeSchedule: ScheduleResponse | null
  removeSchedule: (id: number) => void
  setSchedule: (schedule: ScheduleResponse) => void
  upsertSchedule: (schedule: ScheduleResponse) => void
  invalidateSchedules: (scheduleIds: number[]) => void
  setActiveSchedule: (scheduleId: number | null) => void
  pendingScheduleId: number | null
  beginMutation: (scheduleId: number) => boolean
  endMutation: (scheduleId: number) => void
}

const ScheduleCacheContext = createContext<ScheduleCacheValue | null>(null)

/** Two copies of one schedule whose fields hold the same values (one level deep). */
const sameRevision = (a: ScheduleResponse, b: ScheduleResponse) => {
  if (a === b) return true
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const key of keys) {
    const left = (a as Record<string, unknown>)[key]
    const right = (b as Record<string, unknown>)[key]
    if (Object.is(left, right)) continue
    if (
      typeof left !== 'object' ||
      typeof right !== 'object' ||
      left === null ||
      right === null ||
      JSON.stringify(left) !== JSON.stringify(right)
    )
      return false
  }
  return true
}

export const ScheduleCacheProvider = ({
  children,
  resetKey,
}: {
  children: ReactNode
  /**
   * Changing this empties the cache in place, in the same render. The running schedule is kept:
   * it is one self-describing record (its time carries its own zone), and dropping it would
   * make the mini player slide out and back in.
   */
  resetKey?: string
}) => {
  const [schedulesById, setSchedulesById] = useState<
    Record<number, ScheduleResponse>
  >({})
  const [activeScheduleId, setActiveScheduleId] = useState<number | null>(null)
  const [pendingScheduleId, setPendingScheduleId] = useState<number | null>(
    null,
  )
  useEffect(() => {
    const evict = (event: Event) => {
      const removed = (
        event as CustomEvent<{ spaceIds: number[]; scheduleIds: number[] }>
      ).detail
      const ids = new Set(removed.spaceIds)
      setSchedulesById((previous) =>
        Object.fromEntries(
          Object.entries(previous).filter(
            ([, schedule]) =>
              schedule.spaceId === undefined || !ids.has(schedule.spaceId),
          ),
        ),
      )
      setActiveScheduleId((current) =>
        current !== null && removed.scheduleIds.includes(current)
          ? null
          : current,
      )
    }
    const evictResources = (event: Event) => {
      const ids = new Set((event as CustomEvent<{ scheduleIds: number[] }>).detail.scheduleIds)
      setSchedulesById((previous) => Object.fromEntries(
        Object.entries(previous).filter(([id]) => !ids.has(Number(id))),
      ))
      setActiveScheduleId((current) => current !== null && ids.has(current) ? null : current)
    }
    window.addEventListener('workspace:access-changed', evict)
    window.addEventListener('workspace:resources-evicted', evictResources)
    return () => {
      window.removeEventListener('workspace:access-changed', evict)
      window.removeEventListener('workspace:resources-evicted', evictResources)
    }
  }, [])
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
    if (isSpaceUnavailable(schedule.spaceId) || isResourceUnavailable('schedule', schedule.id, schedule)) return
    setSchedulesById((prev) => {
      const current = prev[schedule.id]
      if (
        current?.version !== undefined &&
        schedule.version !== undefined &&
        current.version > schedule.version
      )
        return prev
      // The same revision read twice (a list read after the detail, say) changes nothing.
      // Keep the map so every consumer of the cache skips a render.
      if (current && sameRevision(current, schedule)) return prev
      return { ...prev, [schedule.id]: schedule }
    })
  }, [])

  const removeSchedule = useCallback((id: number) => {
    setSchedulesById((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    setActiveScheduleId((current) => (current === id ? null : current))
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
    if (scheduleId !== null && isResourceUnavailable('schedule', scheduleId)) return
    setActiveScheduleId(scheduleId)
  }, [])

  const [shownResetKey, setShownResetKey] = useState(resetKey)
  if (shownResetKey !== resetKey) {
    setShownResetKey(resetKey)
    setSchedulesById((previous) =>
      activeScheduleId !== null && previous[activeScheduleId]
        ? { [activeScheduleId]: previous[activeScheduleId] }
        : {},
    )
  }

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
      removeSchedule,
      upsertSchedule,
      invalidateSchedules,
      setActiveSchedule,
    }),
    [
      activeScheduleId,
      pendingScheduleId,
      beginMutation,
      endMutation,
      schedulesById,
      setActiveSchedule,
      setSchedule,
      removeSchedule,
      upsertSchedule,
      invalidateSchedules,
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
