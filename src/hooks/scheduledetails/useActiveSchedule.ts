import { useEffect, useState } from 'react'
import { fetchActiveScheduleId, fetchScheduleDetail } from '../../api/schedules'
import type { ScheduleSummary } from '../../types/schedule.ts'
import { useScheduleCache } from '../../context/ScheduleCacheContext'

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
            title: detail.title,
            description: detail.description,
            date: detail.date,
            deadline: detail.deadline,
            importance: detail.importance,
            urgency: detail.urgency,
            state: detail.state,
          })
          setSchedule(detail)
          setActiveSchedule(activeId)
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
