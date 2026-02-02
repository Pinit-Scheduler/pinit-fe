import { completeTask, fetchTaskDetail, reopenTask } from '@features/tasks/api/tasks'
import { dispatchTaskChanged } from './events'
import { useTaskCache } from '@contexts/TaskCacheContext'
import type { ScheduleState } from '@features/schedules/types/schedule'

/**
 * Schedule 완료/취소 후 taskId가 있을 때 Task 캐시를 새로고침해 일관성 유지
 */
export const useScheduleTaskSync = () => {
  const { setTask } = useTaskCache()

  const refreshTaskIfLinked = async (taskId?: number | null, reason?: string) => {
    if (taskId == null) return
    try {
      const task = await fetchTaskDetail(taskId)
      setTask(task)
      dispatchTaskChanged(taskId, reason ?? 'schedule-state-updated')
    } catch (err) {
      console.error('Failed to refresh task after schedule change', err)
    }
  }

  /**
   * 일정 상태 변화에 맞춰 Task 상태를 자동 동기화
   * - 일정 완료 → Task 완료
   * - 일정 취소/미시작 → Task 미완료로 되돌림 (이미 완료된 경우만)
   */
  const syncTaskStateWithSchedule = async (taskId?: number | null, scheduleState?: ScheduleState) => {
    if (taskId == null || !scheduleState) return
    try {
      const current = await fetchTaskDetail(taskId)

      const currentCompleted = current.completed ?? current.isCompleted ?? false
      if (scheduleState === 'COMPLETED' && !currentCompleted) {
        await completeTask(taskId)
      } else if (scheduleState === 'NOT_STARTED' && currentCompleted) {
        await reopenTask(taskId)
      }

      const updated = scheduleState === 'COMPLETED' || scheduleState === 'NOT_STARTED'
        ? await fetchTaskDetail(taskId)
        : current

      setTask(updated)
      dispatchTaskChanged(taskId, `schedule-${scheduleState.toLowerCase()}`)
    } catch (err) {
      console.error('Failed to sync task with schedule state', err)
    }
  }

  return { refreshTaskIfLinked, syncTaskStateWithSchedule }
}
