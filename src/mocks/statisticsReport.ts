import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
import type {
  PeriodStatisticsResponse,
  RecurrenceStatisticsResponse,
  StatisticsUnit,
} from '../features/statistics/types/report'
import { monthStartOf, shiftMonth } from '../features/statistics/utils/reportView'

dayjs.extend(utc)
dayjs.extend(timezone)

// 개발용 모크. 집계는 서버(ADR-0025 domain/statistics)에 있고, 여기서는 화면 확인에 필요한 모양만 고정값으로 준다.
// 지난 기간은 기간마다 조금씩 다른 값을, 이번 기간은 진행 중 값을, 미래 기간은 빈 값을 돌려준다.

const ZONE_ID = 'Asia/Seoul'

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

const todayKey = () => dayjs().tz(ZONE_ID).format('YYYY-MM-DD')

const weekStartOf = (date: string) => {
  const day = dayjs(date)
  return day.subtract((day.day() + 6) % 7, 'day').format('YYYY-MM-DD')
}

const currentStart = (unit: StatisticsUnit) => (unit === 'WEEK' ? weekStartOf(todayKey()) : monthStartOf(todayKey()))

const shift = (unit: StatisticsUnit, start: string, amount: number) =>
  unit === 'WEEK' ? dayjs(start).add(amount * 7, 'day').format('YYYY-MM-DD') : shiftMonth(start, amount)

const isAligned = (unit: StatisticsUnit, start: string) =>
  unit === 'WEEK' ? weekStartOf(start) === start : monthStartOf(start) === start

const rate = (completed: number, count: number) => (count === 0 ? null : Math.round((completed / count) * 100) / 100)

const minutes = (value: number) => {
  const hours = Math.floor(value / 60)
  const rest = value % 60
  if (value === 0) return 'PT0S'
  return `PT${hours ? `${hours}H` : ''}${rest ? `${rest}M` : ''}`
}

const periodFor = (unit: StatisticsUnit, start: string): PeriodStatisticsResponse => {
  const current = currentStart(unit)
  const future = start > current
  const scale = unit === 'WEEK' ? 1 : 4
  // 기간 시작 날짜에서 고정된 변동을 만든다. 같은 기간은 항상 같은 값이다.
  const seed = future ? 0 : (Number(start.replace(/-/g, '')) % 5) + 1
  const types = [
    { scheduleType: 'DEEP_WORK' as const, count: 4 * scale * (future ? 0 : 1), done: 3 * scale, time: 60 * seed * scale },
    { scheduleType: 'ADMIN_TASK' as const, count: 3 * scale * (future ? 0 : 1), done: 2 * scale, time: 20 * seed * scale },
    { scheduleType: 'QUICK_TASK' as const, count: 5 * scale * (future ? 0 : 1), done: 4 * scale, time: 5 * seed * scale },
  ].map((type) => ({ ...type, done: type.count === 0 ? 0 : type.done }))
  const count = types.reduce((sum, type) => sum + type.count, 0)
  const completed = types.reduce((sum, type) => sum + type.done, 0)
  const elapsed = types.reduce((sum, type) => sum + type.time, 0)
  const dueCount = future ? 0 : 3 * scale
  const dueCompleted = future ? 0 : 2 * scale
  return {
    unit,
    start,
    end: shift(unit, start, 1),
    zoneId: ZONE_ID,
    current: start === current,
    schedules: { count, completedCount: completed, completionRate: rate(completed, count), elapsed: minutes(elapsed) },
    byType: types.map((type) => ({
      scheduleType: type.scheduleType,
      count: type.count,
      completedCount: type.done,
      completionRate: rate(type.done, type.count),
      elapsed: minutes(type.time),
    })),
    tasksDue: { count: dueCount, completedCount: dueCompleted, completionRate: rate(dueCompleted, dueCount) },
  }
}

const recurrenceFixtures = (): RecurrenceStatisticsResponse[] => [
  {
    seriesId: 1,
    mode: 'FLEXIBLE',
    status: 'ACTIVE',
    title: '운동',
    zoneId: ZONE_ID,
    asOf: todayKey(),
    completedCount: 9,
    missedCount: 2,
    pendingToday: true,
    completionRate: 0.82,
    recent: { days: 28, completedCount: 6, missedCount: 1, completionRate: 0.86 },
    currentStreak: 3,
    longestStreak: 5,
    lastCompletedDate: dayjs(todayKey()).subtract(1, 'day').format('YYYY-MM-DD'),
    totalElapsed: 'PT9H',
  },
  {
    seriesId: 2,
    mode: 'FIXED',
    status: 'ACTIVE',
    title: '주간 회의',
    zoneId: ZONE_ID,
    asOf: todayKey(),
    completedCount: 4,
    missedCount: 0,
    pendingToday: false,
    completionRate: 1,
    recent: { days: 28, completedCount: 4, missedCount: 0, completionRate: 1 },
    currentStreak: 4,
    longestStreak: 4,
    lastCompletedDate: dayjs(todayKey()).subtract(6, 'day').format('YYYY-MM-DD'),
    totalElapsed: 'PT4H',
  },
]

const parseUnit = (value: string | null): StatisticsUnit | null => (value === 'WEEK' || value === 'MONTH' ? value : null)

export const handleStatisticsReport = (path: string, method: string, searchParams: URLSearchParams) => {
  if (method !== 'GET') return null

  if (path === '/v2/statistics/period') {
    const unit = parseUnit(searchParams.get('unit'))
    if (!unit) return json({ message: 'unit은 WEEK 또는 MONTH여야 합니다.' }, 400)
    const start = searchParams.get('start') ?? currentStart(unit)
    if (!isAligned(unit, start)) return json({ message: '기간 시작이 단위에 맞지 않습니다.' }, 400)
    return json(periodFor(unit, start))
  }

  if (path === '/v2/statistics/trend') {
    const unit = parseUnit(searchParams.get('unit'))
    if (!unit) return json({ message: 'unit은 WEEK 또는 MONTH여야 합니다.' }, 400)
    const end = searchParams.get('end') ?? currentStart(unit)
    if (!isAligned(unit, end)) return json({ message: '기간 시작이 단위에 맞지 않습니다.' }, 400)
    const count = Number(searchParams.get('count') ?? (unit === 'WEEK' ? 8 : 6))
    const periods = Array.from({ length: count }, (_, index) => periodFor(unit, shift(unit, end, index - count + 1)))
    return json({ unit, zoneId: ZONE_ID, periods })
  }

  if (path === '/v2/statistics/recurrences') {
    return json({ recurrences: searchParams.get('status') === 'ENDED' ? [] : recurrenceFixtures() })
  }

  const single = path.match(/^\/v2\/statistics\/recurrences\/(\d+)$/)
  if (single) {
    const found = recurrenceFixtures().find((series) => series.seriesId === Number(single[1]))
    return found ? json(found) : json({ message: '반복을 찾을 수 없습니다.' }, 404)
  }

  return null
}
