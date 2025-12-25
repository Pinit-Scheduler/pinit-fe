import type { StatisticsResponse, WeeklyStatisticsView } from '../types/statistics'
import { formatDateTimeWithZone, toDisplayDayjs } from './datetime'
import dayjs from 'dayjs'
import duration from 'dayjs/plugin/duration'

dayjs.extend(duration)

const parseElapsedTime = (durationString: string): number => {
  console.log('⏱️ Parsing duration:', durationString)

  if (!durationString || typeof durationString !== 'string') {
    console.warn('⚠️ Invalid duration format:', durationString)
    return 0
  }

  const trimmed = durationString.trim()

  // 1) ISO-8601 Duration (PT12H34M56S)
  if (trimmed.startsWith('P')) {
    try {
      const isoDuration = dayjs.duration(trimmed)
      const totalMinutes = Math.floor(isoDuration.asMinutes())
      console.log('✅ Parsed ISO duration:', {
        durationString,
        hours: isoDuration.hours(),
        minutes: isoDuration.minutes(),
        seconds: isoDuration.seconds(),
        totalMinutes,
      })
      return totalMinutes
    } catch (error) {
      console.error('❌ Failed to parse ISO duration:', { durationString, error })
    }
  }

  // 2) HH:mm:ss 또는 HH:mm:ss.SSS 포맷
  const hmsMatch = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/)
  if (hmsMatch) {
    const [, hours = '0', minutes = '0', seconds = '0'] = hmsMatch
    const totalMinutes = Math.floor(
      Number(hours) * 60 + Number(minutes) + Number(seconds) / 60,
    )
    console.log('✅ Parsed HH:mm:ss duration:', {
      durationString,
      hours,
      minutes,
      seconds,
      totalMinutes,
    })
    return totalMinutes
  }

  console.warn('⚠️ Unsupported duration format, defaulting to 0:', durationString)
  return 0
}

export const toWeeklyStatisticsView = (payload: StatisticsResponse): WeeklyStatisticsView => {
  console.log('🔄 Transforming statistics response:', payload)

  const deepWorkMinutes = parseElapsedTime(payload.deepWorkElapsedTime)
  const adminWorkMinutes = parseElapsedTime(payload.adminWorkElapsedTime)
  const totalMinutes = parseElapsedTime(payload.totalWorkElapsedTime)
  const startOfWeek = toDisplayDayjs(payload.startOfWeek)

  const result = {
    weekStartLabel: `${formatDateTimeWithZone(payload.startOfWeek, 'M월 D일')} ~ ${startOfWeek
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

export const formatMinutesToTime = (totalMinutes: number): string => {
  const safeMinutes = Math.max(0, Math.floor(totalMinutes || 0))
  const hours = Math.floor(safeMinutes / 60)
  const minutes = safeMinutes % 60

  if (hours === 0 && minutes === 0) {
    return '0시간 0분'
  }

  if (hours === 0) {
    return `${minutes}분`
  }

  if (minutes === 0) {
    return `${hours}시간`
  }

  return `${hours}시간 ${minutes}분`
}
