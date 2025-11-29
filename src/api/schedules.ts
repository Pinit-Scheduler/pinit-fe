import { httpClient } from './httpClient'
import type {
  ScheduleResponse,
  ScheduleRequest,
  ScheduleSummary,
} from '../types/schedule'
import { MEMBER_ID } from '../constants/member'

export const fetchScheduleSummaries = (date: string) =>
  httpClient<ScheduleSummary[]>(`/schedules?memberId=${MEMBER_ID}&date=${date}`)

export const fetchWeeklySchedules = (time: string) =>
  httpClient<ScheduleResponse[]>(`/schedules/week?memberId=${MEMBER_ID}&time=${encodeURIComponent(time)}`)

export const fetchScheduleDetail = (scheduleId: number) =>
  httpClient<ScheduleResponse>(`/schedules/${scheduleId}?memberId=${MEMBER_ID}`)

export const createSchedule = (payload: ScheduleRequest) =>
  httpClient<ScheduleResponse>(`/schedules?memberId=${MEMBER_ID}`, {
    method: 'POST',
    json: payload,
  })

export const updateSchedule = (scheduleId: number, payload: Partial<ScheduleRequest>) =>
  httpClient<ScheduleResponse>(`/schedules/${scheduleId}?memberId=${MEMBER_ID}`, {
    method: 'PATCH',
    json: payload,
  })

export const deleteSchedule = (scheduleId: number) =>
  httpClient<void>(`/schedules/${scheduleId}?memberId=${MEMBER_ID}`, {
    method: 'DELETE',
  })


export const startSchedule = (scheduleId: number) => {
  const time = new Date().toISOString()
  return httpClient<void>(`/schedules/${scheduleId}/start?memberId=${MEMBER_ID}&time=${encodeURIComponent(time)}`, {
    method: 'POST',
  })
}

export const suspendSchedule = (scheduleId: number) => {
  const time = new Date().toISOString()
  return httpClient<void>(`/schedules/${scheduleId}/suspend?memberId=${MEMBER_ID}&time=${encodeURIComponent(time)}`, {
    method: 'POST',
  })
}

export const completeSchedule = (scheduleId: number) => {
  const time = new Date().toISOString()
  return httpClient<void>(`/schedules/${scheduleId}/complete?memberId=${MEMBER_ID}&time=${encodeURIComponent(time)}`, {
    method: 'POST',
  })
}

export const cancelSchedule = (scheduleId: number) =>
  httpClient<void>(`/schedules/${scheduleId}/cancel?memberId=${MEMBER_ID}`, {
    method: 'POST',
  })
