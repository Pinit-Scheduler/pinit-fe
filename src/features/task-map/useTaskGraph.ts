import { useCallback, useEffect, useState } from 'react'
import { onScheduleChanged, onTaskChanged } from '@shared/utils/events'
import { useTimePreferences } from '@contexts/TimePreferencesContext'
import { collectTaskGraph } from './graphData'
import type { TaskGraphData } from './graphData'
import { taskGraphSource } from './graphApi'

export const useTaskGraph = (includeCompleted: boolean) => {
  const [snapshot, setSnapshot] = useState<{
    key: string
    data: TaskGraphData | null
    error: string | null
    count: number
    loading: boolean
  }>({ key: '', data: null, error: null, count: 0, loading: true })
  const [revision, setRevision] = useState(0)
  const { zoneId } = useTimePreferences()
  const key = `${includeCompleted}:${revision}:${zoneId}`
  const reload = useCallback(() => setRevision((value) => value + 1), [])
  useEffect(() => {
    const removeTask = onTaskChanged(reload),
      removeSchedule = onScheduleChanged(reload)
    return () => {
      removeTask()
      removeSchedule()
    }
  }, [reload])
  useEffect(() => {
    const controller = new AbortController()
    collectTaskGraph(
      taskGraphSource,
      includeCompleted,
      controller.signal,
      (count) => {
        if (!controller.signal.aborted)
          setSnapshot({ key, count, data: null, error: null, loading: true })
      },
    )
      .then((result) => {
        if (!controller.signal.aborted)
          setSnapshot({
            key,
            count: result.tasks.length,
            data: result,
            error: null,
            loading: false,
          })
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setSnapshot({
            key,
            count: 0,
            data: null,
            loading: false,
            error:
              error instanceof Error
                ? error.message
                : '작업 맵을 불러오지 못했습니다.',
          })
      })
    return () => controller.abort()
  }, [includeCompleted, key])
  const current = snapshot.key === key
  return {
    data: current ? snapshot.data : null,
    isLoading: !current || snapshot.loading,
    error: current ? snapshot.error : null,
    count: current ? snapshot.count : 0,
    reload,
  }
}
