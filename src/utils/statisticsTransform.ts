import type { StatisticsResponse, WeeklyStatisticsView } from '../types/statistics'
import dayjs from 'dayjs'
import duration from 'dayjs/plugin/duration'

dayjs.extend(duration)

const parseElapsedTime = (durationString: string): number => {
  console.log('⏱️ Parsing duration:', durationString)

  if (!durationString || typeof durationString !== 'string') {
    console.warn('⚠️ Invalid duration format:', durationString)
    return 0
  }

  try {
    // ISO 8601 Duration 형식 파싱 (예: "PT12H55M53S")
    const dur = dayjs.duration(durationString)
    const totalMinutes = Math.floor(dur.asMinutes())

    console.log('✅ Parsed duration:', {
      durationString,
      hours: dur.hours(),
      minutes: dur.minutes(),
      seconds: dur.seconds(),
      totalMinutes
    })

    return totalMinutes
  } catch (error) {
    console.error('❌ Failed to parse duration:', { durationString, error })
    return 0
  }
}

export const toWeeklyStatisticsView = (payload: StatisticsResponse): WeeklyStatisticsView => {
  console.log('🔄 Transforming statistics response:', payload)

  const deepWorkMinutes = parseElapsedTime(payload.deepWorkElapsedTime)
  const adminWorkMinutes = parseElapsedTime(payload.adminWorkElapsedTime)
  const totalMinutes = parseElapsedTime(payload.totalWorkElapsedTime)

  const result = {
    weekStartLabel: `${dayjs(payload.startOfWeek).format('M월 D일')} ~ ${dayjs(payload.startOfWeek)
      .add(6, 'day')
      .format('M월 D일')}`,
    deepWorkMinutes,
    adminWorkMinutes,
    totalMinutes,
    deepWorkRatio: totalMinutes ? deepWorkMinutes / totalMinutes : 0,
    adminWorkRatio: totalMinutes ? adminWorkMinutes / totalMinutes : 0,
  }

  console.log('✅ Transformation complete:', result)

  return result
}
