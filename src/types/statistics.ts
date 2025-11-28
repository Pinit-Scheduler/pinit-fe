export type StatisticsResponse = {
  memberId: number
  startOfWeek: string
  deepWorkElapsedTime: string
  adminWorkElapsedTime: string
  totalWorkElapsedTime: string
}

export type WeeklyStatisticsView = {
  weekStartLabel: string
  deepWorkMinutes: number
  adminWorkMinutes: number
  totalMinutes: number
  deepWorkRatio: number
  adminWorkRatio: number
}
