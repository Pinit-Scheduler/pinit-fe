import { parseIsoDurationMinutes } from '@shared/utils/isoDuration'

// ADR-0025 기간·추세·반복 통계를 화면 값으로 옮기는 순수 함수 모음. 집계 규칙은 서버(domain/statistics)에 있고,
// 여기서는 표시만 한다. node 테스트가 그대로 불러 쓰도록 isoDuration 외에는 의존하지 않는다.

type ScheduleTypeKey = 'DEEP_WORK' | 'ADMIN_TASK' | 'QUICK_TASK'
type Unit = 'WEEK' | 'MONTH'

export const SCHEDULE_TYPE_LABEL: Record<ScheduleTypeKey, string> = {
  DEEP_WORK: '집중 작업',
  ADMIN_TASK: '행정 작업',
  QUICK_TASK: '빠른 작업',
}

/** 0.67 → "67%". 값이 없으면 "-". */
export const formatRate = (value: number | null | undefined): string => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-'
  return `${Math.round(value * 100)}%`
}

/** "완료 20 / 30건 (67%)". 일정이 없으면 "일정 없음". */
export const completionLine = (completed: number, total: number, rate: number | null | undefined): string => {
  if (total === 0) return '일정 없음'
  return `완료 ${completed} / ${total}건 (${formatRate(rate)})`
}

/** "YYYY-MM-DD"의 달 첫날. */
export const monthStartOf = (date: string): string => `${date.slice(0, 7)}-01`

/** 달 첫날을 n개월 옮긴다. */
export const shiftMonth = (monthStart: string, months: number): string => {
  const [year, month] = monthStart.split('-').map(Number)
  const index = year * 12 + (month - 1) + months
  const nextYear = Math.floor(index / 12)
  const nextMonth = (index % 12) + 1
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`
}

/** "2026-10-01" → "2026년 10월". */
export const monthLabel = (monthStart: string): string => {
  const [year, month] = monthStart.split('-').map(Number)
  return `${year}년 ${month}월`
}

/** 추세 막대 라벨. 주는 "10/26", 달은 "10월". */
export const periodShortLabel = (unit: Unit, start: string): string => {
  const [, month, day] = start.split('-').map(Number)
  return unit === 'MONTH' ? `${month}월` : `${month}/${day}`
}

export type TrendBar = {
  start: string
  label: string
  minutes: number
  /** 가장 긴 기간 대비 0~1. 모두 0이면 0 */
  ratio: number
  completionRate: number | null
  current: boolean
}

type TrendPeriod = {
  start: string
  current: boolean
  schedules: { elapsed: string; completionRate: number | null }
}

/** 추세 기간을 막대로 바꾼다. 막대 높이는 기간 중 가장 긴 실행 시간에 맞춘다. */
export const trendBars = (unit: Unit, periods: TrendPeriod[]): TrendBar[] => {
  const minutes = periods.map((period) => parseIsoDurationMinutes(period.schedules.elapsed) ?? 0)
  const max = Math.max(0, ...minutes)
  return periods.map((period, index) => ({
    start: period.start,
    label: periodShortLabel(unit, period.start),
    minutes: minutes[index],
    ratio: max === 0 ? 0 : minutes[index] / max,
    completionRate: period.schedules.completionRate,
    current: period.current,
  }))
}

type RecurrenceStats = {
  currentStreak: number
  longestStreak: number
  pendingToday: boolean
  completedCount: number
  missedCount: number
}

/** "3회 연속 (최장 5회)". 기록이 없으면 "아직 기록 없음". */
export const streakLine = (stats: RecurrenceStats): string => {
  if (stats.completedCount === 0 && stats.missedCount === 0) return '아직 기록 없음'
  const current = stats.currentStreak > 0 ? `${stats.currentStreak}회 연속` : '연속 기록 없음'
  return `${current} (최장 ${stats.longestStreak}회)`
}

/** 오늘 남은 회차 안내. 연속 기록이 있으면 이어 가자고 한다. */
export const pendingTodayLine = (stats: RecurrenceStats): string | null => {
  if (!stats.pendingToday) return null
  return stats.currentStreak > 0 ? `오늘 하면 ${stats.currentStreak + 1}회 연속이에요` : '오늘 회차가 남아 있어요'
}
