import type {DateTimeWithZone, DateWithOffset} from '../types/datetime'
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

const DEFAULT_ZONE = 'Asia/Seoul'
const getTz = () => (dayjs as unknown as { tz?: { guess?: () => string; zone?: (id: string) => unknown } }).tz

const normalizeZoneId = (zoneId?: string, fallback = DEFAULT_ZONE) => {
  if (!zoneId) return fallback
  if (zoneId.toUpperCase() === 'UTC') return 'UTC'
  const tz = getTz()
  return tz?.zone && tz.zone(zoneId) ? zoneId : fallback
}

const resolveInitialZone = () => normalizeZoneId(DEFAULT_ZONE, DEFAULT_ZONE)

const getOffsetMinutesForZone = (zoneId: string, at: dayjs.Dayjs = dayjs()) => {
  try {
    const zoned = dayjs.tz(at, zoneId)
    if (zoned.isValid()) return zoned.utcOffset()
  } catch {
    // ignore and fall back
  }
  return dayjs(at).utcOffset()
}

let displayZoneId = resolveInitialZone()
let displayOffsetMinutes = getOffsetMinutesForZone(displayZoneId)

export const getDisplayZoneId = () => displayZoneId
export const getDisplayOffsetMinutes = () => displayOffsetMinutes

/**
 * 표시 시간대를 회원 시간대로 바꾼다(ADR-0028). 알 수 없는 id면 지금 값을 유지한다. 실제로 쓰게 된 id를 돌려준다.
 * 날짜 계산 함수들은 호출할 때마다 이 값을 읽으므로, 바꾼 뒤 화면을 새로 그리면 새 시간대로 보인다.
 */
export const setDisplayZone = (zoneId: string) => {
  displayZoneId = normalizeZoneId(zoneId, displayZoneId || DEFAULT_ZONE)
  displayOffsetMinutes = getOffsetMinutesForZone(displayZoneId)
  return displayZoneId
}

/** 그 시간대의 지금 UTC 오프셋(분). 시간대 선택 목록의 라벨에 쓴다. */
export const getZoneOffsetMinutes = (zoneId: string) => getOffsetMinutesForZone(zoneId)

export const formatOffsetLabel = (offsetMinutes: number) => {
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const absolute = Math.abs(offsetMinutes)
  const hours = String(Math.floor(absolute / 60)).padStart(2, '0')
  const minutes = String(absolute % 60).padStart(2, '0')
  return `UTC${sign}${hours}:${minutes}`
}

export const formatOffset = (offsetMinutes: number) => {
  const safe = Number.isFinite(offsetMinutes) ? offsetMinutes : 0
  const sign = safe >= 0 ? '+' : '-'
  const absolute = Math.abs(safe)
  const hours = String(Math.floor(absolute / 60)).padStart(2, '0')
  const minutes = String(absolute % 60).padStart(2, '0')
  return `${sign}${hours}:${minutes}`
}

const isDateTimeWithZone = (value: unknown): value is DateTimeWithZone => {
  if (!value || typeof value !== 'object') return false
  return 'dateTime' in value && 'zoneId' in value
}

const toZonedDayjs = (value: dayjs.Dayjs | Date | string | DateTimeWithZone, zoneId: string) => {
  const safeZone = normalizeZoneId(zoneId, DEFAULT_ZONE)
  if (isDateTimeWithZone(value)) {
    const sourceZone = normalizeZoneId(value.zoneId, safeZone)
    const parsed = dayjs.tz(value.dateTime, sourceZone)
    return parsed.isValid() ? parsed.tz(safeZone) : dayjs().tz(safeZone)
  }
  const parsed = dayjs(value)
  if (!parsed.isValid()) {
    return dayjs().tz(safeZone)
  }
  return parsed.tz(safeZone)
}

export const toDisplayDayjs = (value: dayjs.Dayjs | Date | string | DateTimeWithZone) => {
  const zoneId = getDisplayZoneId() || DEFAULT_ZONE
  return toZonedDayjs(value, zoneId)
}

export const getTodayWithOffset = (offsetOverride?: number) => {
  if (Number.isFinite(offsetOverride)) {
    return dayjs().utc().utcOffset(Number(offsetOverride))
  }
  const zoneId = getDisplayZoneId() || DEFAULT_ZONE
  return dayjs().tz(zoneId)
}

export const getWeekStart = (date: dayjs.Dayjs) => date.isoWeekday(1).startOf('day')

export const getWeekDays = (weekStart: dayjs.Dayjs) =>
  Array.from({ length: 7 }, (_, index) => weekStart.add(index, 'day'))

export const toDateKey = (date: dayjs.Dayjs | Date | string | DateTimeWithZone) =>
  toDisplayDayjs(date).format('YYYY-MM-DD')


export const formatDisplayDate = (date: dayjs.Dayjs | Date | string | DateTimeWithZone) =>
  toDisplayDayjs(date).format('M월 D일 (dd)')

export const formatDateTimeWithZone = (
  value: dayjs.Dayjs | Date | string | DateTimeWithZone,
  format: string = 'M월 D일 HH:mm',
) => toDisplayDayjs(value).format(format)

export const toApiDateTimeWithZone = (
  value: dayjs.Dayjs | Date | string | DateTimeWithZone,
): DateTimeWithZone => {
  if (isDateTimeWithZone(value)) {
    const zoneId = normalizeZoneId(value.zoneId, getDisplayZoneId() || DEFAULT_ZONE)
    const zoned = dayjs.tz(value.dateTime, zoneId)
    const safe = zoned.isValid() ? zoned : dayjs().tz(zoneId)
    return {
      dateTime: safe.format('YYYY-MM-DDTHH:mm:ss'),
      zoneId,
    }
  }

  const zoneId = getDisplayZoneId() || DEFAULT_ZONE
  const normalized = toZonedDayjs(value, zoneId)
  const safe = normalized.isValid() ? normalized : dayjs().tz(zoneId)
  return {
    dateTime: safe.format('YYYY-MM-DDTHH:mm:ss'),
    zoneId,
  }
}

export const toDateFromApi = (value: dayjs.Dayjs | Date | string | DateTimeWithZone) =>
  toDisplayDayjs(value).toDate()

export const addDays = (date: dayjs.Dayjs | Date | string | DateTimeWithZone, offset: number) =>
  toDisplayDayjs(date).add(offset, 'day')

export const toApiDateWithOffset = (
  value: dayjs.Dayjs | Date | string,
  zoneIdOverride?: string,
): DateWithOffset => {
  const zoneId = normalizeZoneId(zoneIdOverride ?? getDisplayZoneId(), DEFAULT_ZONE)
  const normalized = dayjs(value)
  const safe = normalized.isValid() ? normalized : dayjs()
  const date = safe.format('YYYY-MM-DD')
  const zonedStart = dayjs.tz(`${date}T00:00:00`, zoneId)
  const offsetMinutes = zonedStart.utcOffset()
  const offset = formatOffset(offsetMinutes)

  return {
    date,
    zoneId,
    offset,
  }
}

export const toDayjsFromDateWithOffset = (value: DateWithOffset, zoneIdOverride?: string) => {
  const zoneId = normalizeZoneId(value.zoneId ?? zoneIdOverride, getDisplayZoneId() || DEFAULT_ZONE)
  if (value.offset) {
    const normalizedOffset = value.offset.startsWith('UTC') ? value.offset.replace(/^UTC/, '') : value.offset
    return dayjs(`${value.date}T00:00:00${normalizedOffset}`)
  }
  return dayjs.tz(`${value.date}T00:00:00`, zoneId)
}

export const formatDateWithOffset = (value: DateWithOffset, format = 'M/D') =>
  toDayjsFromDateWithOffset(value).format(format)
