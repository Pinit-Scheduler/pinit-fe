import type dayjs from 'dayjs'
import type { DateTimeWithZone } from '../types/datetime'
import { toApiDateTimeWithZone } from './datetime'

export const withTimeZoneParams = (time: DateTimeWithZone | string | Date | dayjs.Dayjs) => {
  const t = toApiDateTimeWithZone(time)
  return new URLSearchParams({
    time: t.dateTime,
    zoneId: t.zoneId,
  }).toString()
}
