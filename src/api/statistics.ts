import { httpClient } from './httpClient'
import type { StatisticsResponse } from '../types/statistics'

type WeeklyStatisticsParams = {
  memberId: number
  time: string
}

export const fetchWeeklyStatistics = ({ memberId, time }: WeeklyStatisticsParams) =>
  httpClient<StatisticsResponse>(`/statistics?memberId=${memberId}&time=${encodeURIComponent(time)}`)
