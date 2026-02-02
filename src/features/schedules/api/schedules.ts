import type dayjs from 'dayjs'
import type { ScheduleResponse } from '../types/schedule'
import type { DateTimeWithZone } from '@shared/types/datetime'
import { toApiDateTimeWithZone } from '@shared/utils/datetime'
import { withTimeZoneParams } from '@shared/utils/timeParams'
import { buildApiUrl } from '@shared/api/config'
import { httpClient } from '@shared/api/httpClient'

export const SCHEDULE_API_VERSION = 'v2'

const buildTimeQuery = (time: dayjs.Dayjs | DateTimeWithZone | string | Date) => withTimeZoneParams(time)

export const fetchSchedules = (time: dayjs.Dayjs | DateTimeWithZone | string | Date) => {
  const query = buildTimeQuery(time)
  return httpClient<ScheduleResponse[]>(buildApiUrl(`/schedules?${query}`, SCHEDULE_API_VERSION))
}

export const fetchWeeklySchedules = (time: dayjs.Dayjs | DateTimeWithZone | string | Date) => {
  const query = buildTimeQuery(time)
  return httpClient<ScheduleResponse[]>(buildApiUrl(`/schedules/week?${query}`, SCHEDULE_API_VERSION))
}

export type ScheduleSimpleRequest = {
  title: string
  description: string
  date: DateTimeWithZone
  scheduleType: 'DEEP_WORK' | 'QUICK_TASK' | 'ADMIN_TASK'
}

export type ScheduleSimplePatchRequest = Partial<ScheduleSimpleRequest>

export const createSchedule = (payload: ScheduleSimpleRequest) =>
  httpClient<ScheduleResponse>(buildApiUrl('/schedules', SCHEDULE_API_VERSION), {
    method: 'POST',
    json: {
      ...payload,
      date: toApiDateTimeWithZone(payload.date),
    },
  })

export const updateSchedule = (scheduleId: number, payload: ScheduleSimplePatchRequest) =>
  httpClient<ScheduleResponse>(buildApiUrl(`/schedules/${scheduleId}`, SCHEDULE_API_VERSION), {
    method: 'PATCH',
    json: payload.date ? { ...payload, date: toApiDateTimeWithZone(payload.date) } : payload,
  })

export const deleteSchedule = (scheduleId: number) =>
  httpClient<void>(buildApiUrl(`/schedules/${scheduleId}`, SCHEDULE_API_VERSION), {
    method: 'DELETE',
  })

export const fetchScheduleDetail = (scheduleId: number) =>
  httpClient<ScheduleResponse>(buildApiUrl(`/schedules/${scheduleId}`, SCHEDULE_API_VERSION))

export const startSchedule = (scheduleId: number, at: DateTimeWithZone | string | Date = new Date()) =>
  httpClient<void>(buildApiUrl(`/schedules/${scheduleId}/start?${buildTimeQuery(at)}`, SCHEDULE_API_VERSION), {
    method: 'POST',
  })

export const suspendSchedule = (scheduleId: number, at: DateTimeWithZone | string | Date = new Date()) =>
  httpClient<void>(buildApiUrl(`/schedules/${scheduleId}/suspend?${buildTimeQuery(at)}`, SCHEDULE_API_VERSION), {
    method: 'POST',
  })

export const completeSchedule = (scheduleId: number, at: DateTimeWithZone | string | Date = new Date()) =>
  httpClient<void>(buildApiUrl(`/schedules/${scheduleId}/complete?${buildTimeQuery(at)}`, SCHEDULE_API_VERSION), {
    method: 'POST',
  })

export const cancelSchedule = (scheduleId: number) =>
  httpClient<void>(buildApiUrl(`/schedules/${scheduleId}/cancel`, SCHEDULE_API_VERSION), {
    method: 'POST',
  })
