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

const SEOUL_TZ = 'Asia/Seoul'
dayjs.tz.setDefault(SEOUL_TZ)

export const getTodayKST = () => dayjs().tz(SEOUL_TZ)

export const getWeekStart = (date: dayjs.Dayjs) => date.isoWeekday(1).startOf('day')

export const getWeekDays = (weekStart: dayjs.Dayjs) =>
  Array.from({ length: 7 }, (_, index) => weekStart.add(index, 'day'))

export const toDateKey = (date: dayjs.Dayjs | Date | string) =>
  dayjs(date).tz(SEOUL_TZ).format('YYYY-MM-DD')

export const formatDisplayDate = (date: dayjs.Dayjs | Date | string) =>
  dayjs(date).tz(SEOUL_TZ).format('M월 D일 (dd)')

export const fromApiDateTimeKST = (value: string) => dayjs(value).tz(SEOUL_TZ)

export const toApiDateTimeKST = (value: dayjs.Dayjs | Date | string) => {
  const normalized = dayjs(value).tz(SEOUL_TZ)
  return `${normalized.format('YYYY-MM-DDTHH:mm:ss')}+09:00[Asia/Seoul]`
}

export const addDays = (date: dayjs.Dayjs | Date | string, offset: number) =>
  dayjs(date).tz(SEOUL_TZ).add(offset, 'day')
