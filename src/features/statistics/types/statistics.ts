import type { DateTimeWithZone } from '@shared/types/datetime'

export type StatisticsResponse = {
  memberId: number
  startOfWeek: DateTimeWithZone | string
  deepWorkElapsedTime: string
  adminWorkElapsedTime: string
  totalWorkElapsedTime: string
}

export type WeeklyStatisticsView = {
  weekStartLabel: string
  deepWorkMinutes: number
  adminWorkMinutes: number
  quickWorkMinutes: number
  totalMinutes: number
  deepWorkRatio: number
  adminWorkRatio: number
  quickWorkRatio: number
}
