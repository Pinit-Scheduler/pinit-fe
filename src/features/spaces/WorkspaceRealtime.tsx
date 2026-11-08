import { useEffect, useState } from 'react'
import { useTaskCache } from '@contexts/TaskCacheContext'
import { useScheduleCache } from '@contexts/ScheduleCacheContext'
import { fetchTaskDetail } from '@features/tasks/api/tasks'
import { fetchScheduleDetail } from '@features/schedules/api/schedules'
import { useSpaces, workspaceChanged } from './store'
import { subscribeToWorkspace, type SpaceEvent } from './realtime'

export default function WorkspaceRealtime() {
  const { spaces, memberId } = useSpaces()
  const { setTask, removeTask } = useTaskCache()
  const { setSchedule, removeSchedule } = useScheduleCache()
  const [disconnected, setDisconnected] = useState(false)
  const ready = spaces.some((space) => !space.deleted)
  useEffect(() => {
    if (!ready) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const reads = new Map<string, number>()
    const changed = (event?: SpaceEvent) => {
      if (controller.signal.aborted) return
      clearTimeout(timer)
      timer = setTimeout(workspaceChanged, 150)
      if (!event) return
      const type = event.resourceType.toUpperCase()
      const key = `${type}:${event.resourceId}`
      const sequence = (reads.get(key) ?? 0) + 1
      reads.set(key, sequence)
      if (type === 'TASK') {
        if (event.action === 'DELETED') removeTask(event.resourceId)
        else
          void fetchTaskDetail(event.resourceId)
            .then((task) => {
              if (!controller.signal.aborted && reads.get(key) === sequence)
                setTask(task)
            })
            .catch(() => {})
      }
      if (type === 'SCHEDULE') {
        if (event.action === 'DELETED') removeSchedule(event.resourceId)
        else
          void fetchScheduleDetail(event.resourceId)
            .then((schedule) => {
              if (!controller.signal.aborted && reads.get(key) === sequence)
                setSchedule(schedule)
            })
            .catch(() => {})
      }
    }
    void subscribeToWorkspace(controller.signal, changed, (connected) => {
      if (!controller.signal.aborted) setDisconnected(!connected)
    })
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [ready, memberId, setTask, removeTask, setSchedule, removeSchedule])
  return disconnected ? (
    <p className="space-realtime-status" role="status">
      실시간 연결을 다시 시도하고 있어요. 저장 시 서버에서 최신 버전을
      확인합니다.
    </p>
  ) : null
}
