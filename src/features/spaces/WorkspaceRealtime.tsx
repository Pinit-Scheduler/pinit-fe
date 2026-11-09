import { useEffect, useState } from 'react'
import { useTaskCache } from '@contexts/TaskCacheContext'
import { useScheduleCache } from '@contexts/ScheduleCacheContext'
import { fetchTaskDetail } from '@features/tasks/api/tasks'
import { fetchScheduleDetail } from '@features/schedules/api/schedules'
import { useSpaces, workspaceChanged } from './store'
import { subscribeToWorkspace, type SpaceEvent } from './realtime'
import { evictWorkspaceResource } from './metadata'
import { takeLocalEcho } from '@shared/utils/events'
import { usePresence } from '@shared/motion/usePresence'

export default function WorkspaceRealtime() {
  const { spaces, memberId } = useSpaces()
  const { setTask } = useTaskCache()
  const { setSchedule } = useScheduleCache()
  const [disconnected, setDisconnected] = useState(false)
  // The notice waits before it rises in (spaces.css). It fades out only once it has actually
  // appeared; a reconnect inside the wait unmounts it at once, so it never flashes.
  const [entered, setEntered] = useState(false)
  const [lastDisconnected, setLastDisconnected] = useState(disconnected)
  if (lastDisconnected !== disconnected) {
    setLastDisconnected(disconnected)
    // Each disconnect restarts the delayed entrance, so it has to appear again before it may fade.
    if (disconnected) setEntered(false)
  }
  const notice = usePresence(disconnected)
  const ready = spaces.some((space) => !space.deleted)
  useEffect(() => {
    if (!ready) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const reads = new Map<string, number>()
    const changed = (event?: SpaceEvent) => {
      if (controller.signal.aborted) return
      const type = event?.resourceType.toUpperCase()
      const removed =
        !!event && ['DELETED', 'PURGED', 'MOVED_OUT'].includes(event.action.toUpperCase())
      // The echo of a task or schedule this client just saved: its own task:changed/schedule:changed
      // already refreshed the views, so skip the global refetch. The detail read below still runs.
      const echo =
        !!event &&
        !removed &&
        (type === 'TASK' || type === 'SCHEDULE') &&
        takeLocalEcho(type === 'TASK' ? 'task' : 'schedule', event.resourceId)
      if (!echo) {
        clearTimeout(timer)
        timer = setTimeout(workspaceChanged, 150)
      }
      if (!event) return
      const key = `${type}:${event.resourceId}`
      const sequence = (reads.get(key) ?? 0) + 1
      reads.set(key, sequence)
      if (type === 'TASK') {
        if (removed) evictWorkspaceResource('task', event.resourceId, true)
        else
          void fetchTaskDetail(event.resourceId)
            .then((task) => {
              if (!controller.signal.aborted && reads.get(key) === sequence)
                setTask(task)
            })
            .catch(() => {})
      }
      if (type === 'SCHEDULE') {
        if (removed) evictWorkspaceResource('schedule', event.resourceId, true)
        else
          void fetchScheduleDetail(event.resourceId)
            .then((schedule) => {
              if (!controller.signal.aborted && reads.get(key) === sequence)
                setSchedule(schedule)
            })
            .catch(() => {})
      }
      if (type === 'RECURRENCE' && removed) evictWorkspaceResource('series', event.resourceId, true)
    }
    void subscribeToWorkspace(controller.signal, changed, (connected) => {
      if (!controller.signal.aborted) setDisconnected(!connected)
    })
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [ready, memberId, setTask, setSchedule])
  if (!notice.mounted || (notice.closing && !entered)) return null
  return (
    <p
      className="space-realtime-status"
      role="status"
      data-state={notice.closing ? 'closing' : undefined}
      onAnimationStart={notice.closing ? undefined : () => setEntered(true)}
    >
      실시간 연결을 다시 시도하고 있어요. 저장 시 서버에서 최신 버전을
      확인합니다.
    </p>
  )
}
