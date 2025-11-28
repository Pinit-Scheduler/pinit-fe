import type { StatisticsResponse, WeeklyStatisticsView } from '../types/statistics'
import dayjs from 'dayjs'

const parseElapsedTime = (text: string) => {
  const [hours, minutes] = text.split(':').map((value) => Number(value))
  return hours * 60 + minutes
}

export const toWeeklyStatisticsView = (payload: StatisticsResponse): WeeklyStatisticsView => {
  const deepWorkMinutes = parseElapsedTime(payload.deepWorkElapsedTime)
  const adminWorkMinutes = parseElapsedTime(payload.adminWorkElapsedTime)
  const totalMinutes = parseElapsedTime(payload.totalWorkElapsedTime)

  return {
    weekStartLabel: `${dayjs(payload.startOfWeek).format('M월 D일')} ~ ${dayjs(payload.startOfWeek)
      .add(6, 'day')
      .format('M월 D일')}`,
    deepWorkMinutes,
    adminWorkMinutes,
    totalMinutes,
    deepWorkRatio: totalMinutes ? deepWorkMinutes / totalMinutes : 0,
    adminWorkRatio: totalMinutes ? adminWorkMinutes / totalMinutes : 0,
  }
}
