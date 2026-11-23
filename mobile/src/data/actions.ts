import { useSyncExternalStore } from 'react'

import { conflictReloadedMessage, getRequestFailureMessage, isEditConflict } from '@/api/errors'
import { changeScheduleState, fetchSchedule } from '@/api/schedules'
import { changeTaskState, fetchTask } from '@/api/tasks'
import type { Schedule, ScheduleAction, ScheduleState, Task } from '@/api/types'
import { ACTION_DONE_MESSAGE, TARGET_STATE } from '@/lib/schedule'
import { showToast } from '@/ui/toast'
import { schedules, tasks } from './entities'
import { invalidateResources } from './resource'

// 저장 중인 변경. 저장하는 동안 화면은 바뀔 상태를 먼저 보여 준다.
type Pending = {
  /** 일정 변경은 한 번에 하나만 보낸다. 하나를 시작하면 서버가 다른 진행중 일정을 멈출 수 있어서다(웹과 같은 잠금). */
  schedule: { id: number; target: ScheduleState } | null
  /** 작업 ID → 저장 중인 완료 여부. */
  tasks: Record<number, boolean>
}

let pending: Pending = { schedule: null, tasks: {} }
const listeners = new Set<() => void>()
const set = (next: Pending) => {
  pending = next
  listeners.forEach((listener) => listener())
}
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
const read = () => pending

export const usePendingChanges = () => useSyncExternalStore(subscribe, read, read)

/**
 * 일정 상태를 바꾼다. 성공하면 저장된 일정을 화면에 반영하고 목록을 다시 받는다.
 * 다른 참여자가 먼저 바꿨으면(409) 최신 일정을 받아 보여 주고, 자동으로 다시 보내지 않는다.
 */
export const runScheduleAction = async (schedule: Schedule, action: ScheduleAction) => {
  if (pending.schedule) return
  set({ ...pending, schedule: { id: schedule.id, target: TARGET_STATE[action] } })
  try {
    schedules.remember(await changeScheduleState(schedule.id, action, schedule.version))
    showToast(ACTION_DONE_MESSAGE[action])
  } catch (error) {
    if (isEditConflict(error)) {
      showToast(conflictReloadedMessage(error), 'error')
      try {
        schedules.remember(await fetchSchedule(schedule.id))
      } catch {
        // 목록을 다시 받을 때 최신 내용이 온다.
      }
    } else {
      showToast(getRequestFailureMessage(error, '일정 상태를 바꾸지 못했어요.'), 'error')
    }
  } finally {
    set({ ...pending, schedule: null })
    // 성공이든 실패든 서버의 지금 상태로 맞춘다. 시작은 다른 일정과 연결된 작업의 상태도 바꿀 수 있다.
    invalidateResources()
  }
}

/** 작업을 완료하거나 완료를 취소한다. 규칙은 일정과 같다. */
export const toggleTaskCompletion = async (task: Task) => {
  if (task.id in pending.tasks) return
  const done = !task.completed
  set({ ...pending, tasks: { ...pending.tasks, [task.id]: done } })
  try {
    tasks.remember(await changeTaskState(task.id, done ? 'COMPLETE' : 'REOPEN', task.version))
  } catch (error) {
    if (isEditConflict(error)) {
      showToast(conflictReloadedMessage(error), 'error')
      try {
        tasks.remember(await fetchTask(task.id))
      } catch {
        // 목록을 다시 받을 때 최신 내용이 온다.
      }
    } else {
      showToast(getRequestFailureMessage(error, '작업 상태를 바꾸지 못했어요.'), 'error')
    }
  } finally {
    const { [task.id]: _settled, ...rest } = pending.tasks
    set({ ...pending, tasks: rest })
    invalidateResources()
  }
}
