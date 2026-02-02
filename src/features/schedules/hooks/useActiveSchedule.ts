import { useEffect, useState } from 'react'
import { fetchScheduleDetail } from '../api/schedules'
import { fetchActiveScheduleId } from '@features/auth/api/member'
import type { ScheduleSummary } from '../types/schedule'
import { useScheduleCache } from '@contexts/ScheduleCacheContext'
import { dispatchTaskChanged } from '@shared/utils/events'

const useActiveSchedule = (): ScheduleSummary | null => {
  const [active, setActive] = useState<ScheduleSummary | null>(null)
  const { activeSchedule, setActiveSchedule, schedulesById, setSchedule } = useScheduleCache()

  useEffect(() => {
    let isMounted = true

    const loadActive = async () => {
      try {
        const activeId = await fetchActiveScheduleId()
        if (!activeId) {
          if (isMounted) {
            setActive(null)
            setActiveSchedule(null)
          }
          return
        }
        const cached = schedulesById[activeId]
        const detail = cached ?? (await fetchScheduleDetail(activeId))
        if (isMounted) {
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
          setActiveSchedule(activeId)
          if (detail.taskId != null) {
            dispatchTaskChanged(detail.taskId, 'active-schedule-loaded')
          }
        }
      } catch (error) {
        console.error('Failed to load active schedule:', error)
        if (isMounted) setActive(null)
      }
    }

    loadActive()

    return () => {
      isMounted = false
    }
    // schedulesById를 의존성에 넣으면 캐시 변경 시마다 재호출하므로 제외
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setActiveSchedule, setSchedule])

  return activeSchedule ?? active
}

export default useActiveSchedule
