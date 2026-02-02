export type TaskChangedDetail = {
  taskId?: number
  reason?: string
}

export type ScheduleChangedDetail = {
  scheduleId?: number
  schedule?: unknown
  previousDateKey?: string
  reason?: string
  payload?: unknown
}

export const dispatchTaskChanged = (detail: TaskChangedDetail | number, reason?: string) => {
  const detailObj: TaskChangedDetail =
    typeof detail === 'number' ? { taskId: detail, reason } : detail
  window.dispatchEvent(new CustomEvent<TaskChangedDetail>('task:changed', { detail: detailObj }))
}

export const dispatchScheduleChanged = (
  detail: ScheduleChangedDetail | string,
  payload?: unknown,
) => {
  const detailObj: ScheduleChangedDetail =
    typeof detail === 'string' ? { reason: detail, payload } : detail
  window.dispatchEvent(new CustomEvent<ScheduleChangedDetail>('schedule:changed', { detail: detailObj }))
}

export const onTaskChanged = (handler: (detail: TaskChangedDetail) => void) => {
  const listener = (event: Event) => {
    const custom = event as CustomEvent<TaskChangedDetail>
    handler(custom.detail || {})
  }
  window.addEventListener('task:changed', listener)
  return () => window.removeEventListener('task:changed', listener)
}

export const onScheduleChanged = (handler: (detail: ScheduleChangedDetail) => void) => {
  const listener = (event: Event) => {
    const custom = event as CustomEvent<ScheduleChangedDetail>
    handler(custom.detail || {})
  }
  window.addEventListener('schedule:changed', listener)
  return () => window.removeEventListener('schedule:changed', listener)
}
