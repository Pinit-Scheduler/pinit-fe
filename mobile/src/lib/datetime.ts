import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'

import type { DateTimeWithZone } from '@/api/types'

dayjs.extend(utc)
dayjs.extend(timezone)

const DEFAULT_ZONE = 'Asia/Seoul'

const isKnownZone = (zoneId: string) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zoneId })
    return true
  } catch {
    return false
  }
}

// 표시 시간대는 회원 시간대다(ADR-0028). 웹과 같이 기본은 Asia/Seoul이고, 회원 설정을 읽으면 바꾼다.
let displayZoneId = DEFAULT_ZONE

export const getDisplayZoneId = () => displayZoneId

/** 알 수 없는 id면 지금 값을 유지한다. 실제로 쓰게 된 id를 돌려준다. */
export const setDisplayZone = (zoneId: string) => {
  if (zoneId && isKnownZone(zoneId)) displayZoneId = zoneId
  return displayZoneId
}

/** 표시 시간대의 오늘(YYYY-MM-DD). */
export const todayKey = () => dayjs().tz(displayZoneId).format('YYYY-MM-DD')

/** 표시 시간대에서 그 날짜가 시작하고 끝나는 순간(ISO-8601 UTC). end는 다음 날 0시다. */
export const dayBounds = (dateKey: string, days = 1) => {
  const start = dayjs.tz(`${dateKey}T00:00:00`, displayZoneId)
  return { start: start.toISOString(), end: start.add(days, 'day').toISOString() }
}

const toDisplay = (value: DateTimeWithZone) => {
  const zone = isKnownZone(value.zoneId) ? value.zoneId : displayZoneId
  return dayjs.tz(value.dateTime, zone).tz(displayZoneId)
}

/** 일정 시작 시각 "14:30". */
export const formatTime = (value: DateTimeWithZone) => toDisplay(value).format('HH:mm')

/** 일정이 놓인 표시 시간대의 날짜(YYYY-MM-DD). */
export const dateKeyOf = (value: DateTimeWithZone) => toDisplay(value).format('YYYY-MM-DD')

/** 정렬용 순간(ms). */
export const instantOf = (value: DateTimeWithZone) => toDisplay(value).valueOf()
