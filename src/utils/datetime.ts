import type { DateTimeWithZone } from '../types/datetime'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
import isoWeek from 'dayjs/plugin/isoWeek'
import weekday from 'dayjs/plugin/weekday'
import 'dayjs/locale/ko'

dayjs.extend(utc)
dayjs.extend(timezone)
dayjs.extend(isoWeek)
dayjs.extend(weekday)
dayjs.locale('ko')

const DEFAULT_ZONE = 'UTC'
const hasZoneLookup = () => typeof dayjs.tz !== 'undefined' && typeof dayjs.tz.zone === 'function'

const resolveInitialZone = () => {
  try {
    const guess = hasZoneLookup() ? dayjs.tz.guess() : DEFAULT_ZONE
    return hasZoneLookup() && dayjs.tz.zone(guess) ? guess : DEFAULT_ZONE
  } catch {
    return DEFAULT_ZONE
  }
}

let displayZoneId = resolveInitialZone()
let displayOffsetMinutes = (() => {
  try {
    const zoned = dayjs().tz(displayZoneId)
    if (zoned.isValid()) return zoned.utcOffset()
  } catch {
    // ignore and fall through
  }
  displayZoneId = DEFAULT_ZONE
  return 0
})()

export const getDisplayZoneId = () => displayZoneId
export const getDisplayOffsetMinutes = () => displayOffsetMinutes

export const setDisplayOffset = (offsetMinutes: number, zoneId?: string) => {
  displayOffsetMinutes = offsetMinutes
  if (zoneId && hasZoneLookup() && dayjs.tz.zone(zoneId)) {
    displayZoneId = zoneId
  } else if (zoneId) {
    displayZoneId = DEFAULT_ZONE
  }
}

export const formatOffsetLabel = (offsetMinutes: number) => {
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const absolute = Math.abs(offsetMinutes)
  const hours = String(Math.floor(absolute / 60)).padStart(2, '0')
  const minutes = String(absolute % 60).padStart(2, '0')
  return `UTC${sign}${hours}:${minutes}`
}

export const parseOffsetString = (value?: string | null) => {
  if (!value) return null
  const trimmed = value.trim()
  const match = trimmed.match(/^UTC?([+-])(\d{1,2})(?::?(\d{2}))?$/i) || trimmed.match(/^([+-])(\d{1,2}):?(\d{2})?$/)
  if (match) {
    const [, sign, hours, minutes = '0'] = match
    const offset = Number(hours) * 60 + Number(minutes)
    return sign === '-' ? -offset : offset
  }

  if (hasZoneLookup() && dayjs.tz.zone(trimmed)) {
    return dayjs().tz(trimmed).utcOffset()
  }

  return null
}

const isDateTimeWithZone = (value: unknown): value is DateTimeWithZone => {
  if (!value || typeof value !== 'object') return false
  return 'dateTime' in value && 'zoneId' in value
}

const normalizeZoneId = (zoneId?: string, fallback = DEFAULT_ZONE) => {
  if (!zoneId) return fallback
  if (zoneId.toUpperCase() === 'UTC') return 'UTC'
  return hasZoneLookup() && dayjs.tz.zone(zoneId) ? zoneId : fallback
}

const toUtcDayjs = (value: dayjs.Dayjs | Date | string | DateTimeWithZone) => {
  if (isDateTimeWithZone(value)) {
    const zoneId = normalizeZoneId(value.zoneId, DEFAULT_ZONE)
    try {
      const zoned =
        zoneId === 'UTC'
          ? dayjs.utc(value.dateTime)
          : dayjs.tz(value.dateTime, zoneId).utc()
      return zoned.isValid() ? zoned : dayjs.utc()
    } catch {
      return dayjs.utc()
    }
  }
  const parsed = dayjs(value)
  if (!parsed.isValid()) {
    return dayjs.utc()
  }
  return parsed.utc()
}

export const toDisplayDayjs = (value: dayjs.Dayjs | Date | string | DateTimeWithZone) => {
  const safeOffset = Number.isFinite(displayOffsetMinutes) ? displayOffsetMinutes : 0
  const utcValue = toUtcDayjs(value)
  return utcValue.isValid()
    ? utcValue.utcOffset(safeOffset)
    : dayjs.utc().utcOffset(safeOffset)
}

export const getTodayWithOffset = () => {
  const safeOffset = Number.isFinite(displayOffsetMinutes) ? displayOffsetMinutes : 0
  return dayjs().utc().utcOffset(safeOffset)
}

export const getWeekStart = (date: dayjs.Dayjs) => date.isoWeekday(1).startOf('day')

export const getWeekDays = (weekStart: dayjs.Dayjs) =>
  Array.from({ length: 7 }, (_, index) => weekStart.add(index, 'day'))

export const toDateKey = (date: dayjs.Dayjs | Date | string | DateTimeWithZone) =>
  toDisplayDayjs(date).format('YYYY-MM-DD')

export const toUtcDateKey = (date: dayjs.Dayjs | Date | string | DateTimeWithZone) =>
  toUtcDayjs(date).format('YYYY-MM-DD')

export const formatDisplayDate = (date: dayjs.Dayjs | Date | string | DateTimeWithZone) =>
  toDisplayDayjs(date).format('M월 D일 (dd)')

export const formatDateTimeWithZone = (
  value: dayjs.Dayjs | Date | string | DateTimeWithZone,
  format: string = 'M월 D일 HH:mm',
) => toDisplayDayjs(value).format(format)

export const toApiDateTimeWithZone = (
  value: dayjs.Dayjs | Date | string | DateTimeWithZone,
): DateTimeWithZone => {
  const normalized = toUtcDayjs(value)
  return {
    dateTime: normalized.format('YYYY-MM-DDTHH:mm:ss[Z]'),
    zoneId: 'UTC',
  }
}

export const toDateFromApi = (value: dayjs.Dayjs | Date | string | DateTimeWithZone) =>
  toDisplayDayjs(value).toDate()

export const addDays = (date: dayjs.Dayjs | Date | string | DateTimeWithZone, offset: number) =>
  toDisplayDayjs(date).add(offset, 'day')
