import { useEffect, useState } from 'react'
import { fetchScheduleDetail } from '../api/schedules'
import { fetchActiveScheduleId } from '@features/auth/api/member'
import type { ScheduleSummary } from '../types/schedule'
import { useScheduleCache } from '@contexts/ScheduleCacheContext'

const useActiveSchedule = (): ScheduleSummary | null => {
  const [active, setActive] = useState<ScheduleSummary | null>(null)
  const { activeSchedule, setActiveSchedule, setSchedule, pendingScheduleId } =
    useScheduleCache()

  useEffect(() => {
    let isMounted = true
    let request = 0

    const loadActive = async () => {
      if (pendingScheduleId !== null || document.visibilityState === 'hidden')
        return
      const currentRequest = ++request
      try {
        const activeId = await fetchActiveScheduleId()
        if (!isMounted || currentRequest !== request) return
        if (!activeId) {
          if (isMounted) {
            setActive(null)
            setActiveSchedule(null)
          }
          return
        }
        const detail = await fetchScheduleDetail(activeId)
        if (isMounted && currentRequest === request) {
          setActive({
            id: detail.id,
            ownerId: detail.ownerId,
            title: detail.title,
            description: detail.description,
            date: detail.date,
            state: detail.state,
            scheduleType: detail.scheduleType,
            taskId: detail.taskId,
            duration: detail.duration,
          })
          setSchedule(detail)
          // Loading the active schedule changes no task. setSchedule already updates the cache,
          // so no task:changed here: it made every list refetch on each focus or tab return.
          setActiveSchedule(activeId)
        }
      } catch (error) {
        console.error('Failed to load active schedule:', error)
        if (isMounted) setActive(null)
      }
    }

    loadActive()
    window.addEventListener('focus', loadActive)
    window.addEventListener('schedule:changed', loadActive)
    document.addEventListener('visibilitychange', loadActive)

    return () => {
      isMounted = false
      window.removeEventListener('focus', loadActive)
      window.removeEventListener('schedule:changed', loadActive)
      document.removeEventListener('visibilitychange', loadActive)
    }
  }, [setActiveSchedule, setSchedule, pendingScheduleId])

  return activeSchedule ?? active
}

export default useActiveSchedule
