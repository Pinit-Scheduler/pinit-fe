import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
import type { DateWithOffset } from '../types/datetime'
import { getDisplayZoneId, toDayjsFromDateWithOffset } from './datetime'

dayjs.extend(utc)
dayjs.extend(timezone)

export const getDeadlineStyle = (due: DateWithOffset) => {
  const zoneId = due.zoneId || getDisplayZoneId()
  const now = zoneId ? dayjs().tz(zoneId) : dayjs()
  const target = toDayjsFromDateWithOffset(due, zoneId)
  const diffDays = target.diff(now, 'day', true) // 실수 단위 일수
  return {
    color: diffDays < 0
      ? 'var(--c-red-700)'
      : diffDays <= 1
        ? 'var(--c-amber-800)'
        : 'var(--c-green-800)',
  }
}
