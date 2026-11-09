import { fetchTaskDetail } from '@features/tasks/api/tasks'
import { dispatchTaskChanged } from './events'
import { useTaskCache } from '@contexts/TaskCacheContext'
import type { ScheduleState } from '@features/schedules/types/schedule'

/**
 * Schedule 완료/취소 후 taskId가 있을 때 Task 캐시를 새로고침해 일관성 유지
 */
export const useScheduleTaskSync = () => {
  const { setTask } = useTaskCache()

  const refreshTaskIfLinked = async (
    taskId?: number | null,
    reason?: string,
  ) => {
    if (taskId == null) return
    try {
      const task = await fetchTaskDetail(taskId)
      setTask(task)
      dispatchTaskChanged(taskId, reason ?? 'schedule-state-updated')
    } catch (err) {
      console.error('Failed to refresh task after schedule change', err)
    }
  }

  // 상태 전이와 연결 Task 동기화는 서버 도메인이 한 트랜잭션에서 처리한다.
  // UI는 이미 저장된 결과를 재조회하며 추가 complete/reopen 명령을 만들지 않는다.
  const syncTaskStateWithSchedule = async (
    taskId?: number | null,
    scheduleState?: ScheduleState,
  ) => {
    await refreshTaskIfLinked(
      taskId,
      scheduleState
        ? `schedule-${scheduleState.toLowerCase()}`
        : 'schedule-state-updated',
    )
  }

  return { refreshTaskIfLinked, syncTaskStateWithSchedule }
}
