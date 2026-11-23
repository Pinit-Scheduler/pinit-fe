import { apiUrl } from '@/config'
import { dayBounds } from '@/lib/datetime'
import { api } from './http'
import type { AllowedActions, DateTimeWithZone, Schedule, ScheduleAction, ScheduleState, ScheduleType } from './types'

// 서버 응답(WorkspaceResourceController.ScheduleResponse): 일정 본문과 스페이스 정보가 나란히 온다.
type ScheduleView = {
  schedule: {
    id: number
    title: string
    description?: string | null
    date: DateTimeWithZone
    scheduleType?: ScheduleType
    state: ScheduleState
    taskId?: number | null
    plannedDuration?: string | null
    recurrence?: unknown
  }
  spaceId: number
  projectId: number | null
  assigneeId: number | null
  assigneeNickname: string | null
  version: number
  allowedActions?: AllowedActions | null
}

const url = (path = '') => apiUrl('/workspace/schedules' + path)

const normalize = ({ schedule, ...metadata }: ScheduleView): Schedule => ({
  id: schedule.id,
  title: schedule.title,
  description: schedule.description ?? '',
  date: schedule.date,
  scheduleType: schedule.scheduleType,
  state: schedule.state,
  taskId: schedule.taskId ?? null,
  plannedDuration: schedule.plannedDuration ?? null,
  recurring: schedule.recurrence != null,
  spaceId: metadata.spaceId,
  projectId: metadata.projectId,
  assigneeId: metadata.assigneeId,
  assigneeNickname: metadata.assigneeNickname,
  version: metadata.version,
  allowedActions: metadata.allowedActions ?? {},
})

/** 그 날짜(표시 시간대)의 내 일정. 모든 스페이스에서 내게 배정된 것만 본다(웹 '오늘' 화면과 같은 조회). */
export const fetchMySchedules = async (dateKey: string, signal?: AbortSignal) => {
  const { start, end } = dayBounds(dateKey)
  const query = new URLSearchParams({ start, end, mine: 'true' })
  const views = await api<ScheduleView[]>(url(`?${query}`), { signal })
  return views.map(normalize)
}

/** 그 날짜부터 7일 동안 내 일정이 있는 날을 표시하는 데 쓴다. */
export const fetchMyWeekSchedules = async (weekStartKey: string, signal?: AbortSignal) => {
  const { start, end } = dayBounds(weekStartKey, 7)
  const query = new URLSearchParams({ start, end, mine: 'true' })
  const views = await api<ScheduleView[]>(url(`?${query}`), { signal })
  return views.map(normalize)
}

export const fetchSchedule = async (id: number, signal?: AbortSignal) =>
  normalize(await api<ScheduleView>(url(`/${id}`), { signal }))

/** 상태 변경. expectedVersion이 서버 버전과 다르면 409(isEditConflict)다. */
export const changeScheduleState = async (id: number, action: ScheduleAction, expectedVersion: number) =>
  normalize(await api<ScheduleView>(url(`/${id}/state`), { method: 'POST', json: { action, expectedVersion } }))
