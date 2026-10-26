// ADR-0019 반복 규칙 입력·요약·영향 문구. 의존성이 없어야 node 테스트에서 그대로 불러 쓸 수 있다.
// 규칙 범위는 서버(RecurrencePolicy)와 같고, 최종 판단은 서버가 한다.

import type {
  DayOfWeek,
  RecurrenceDeleteImpact,
  RecurrenceEditImpact,
  RecurrenceFrequency,
  RecurrenceRule,
} from '../types/recurrence'

export const MIN_INTERVAL = 1
export const MAX_INTERVAL = 99
export const MIN_COUNT = 1
export const MAX_COUNT = 365
export const MAX_UNTIL_YEARS = 2
/** 서버가 미리 만드는 범위(오늘 + 28일)와 조회할 때 채우는 상한(오늘 + 90일). */
export const HORIZON_DAYS = 28
export const TOP_UP_LIMIT_DAYS = 90

export const WEEK_DAYS: DayOfWeek[] = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']

export const DAY_SHORT: Record<DayOfWeek, string> = {
  MONDAY: '월',
  TUESDAY: '화',
  WEDNESDAY: '수',
  THURSDAY: '목',
  FRIDAY: '금',
  SATURDAY: '토',
  SUNDAY: '일',
}

export const FREQ_LABEL: Record<RecurrenceFrequency, string> = {
  DAILY: '매일',
  WEEKLY: '매주',
  MONTHLY: '매월',
}

export type RecurrenceEnd = 'NONE' | 'UNTIL' | 'COUNT'

/** 폼에서 고치는 규칙. 숫자 칸은 비울 수 있다. */
export type RuleDraft = {
  freq: RecurrenceFrequency
  interval: number | null
  days: DayOfWeek[]
  dayOfMonth: number | null
  startDate: string
  end: RecurrenceEnd
  until: string
  count: number | null
}

export type RuleDraftField = 'interval' | 'days' | 'dayOfMonth' | 'startDate' | 'until' | 'count'

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

const toUtcDate = (dateKey: string) => {
  const [year, month, day] = dateKey.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

const isValidDateKey = (value: string) => {
  if (!DATE_PATTERN.test(value)) return false
  const date = toUtcDate(value)
  return date.toISOString().slice(0, 10) === value
}

/** 두 날짜(YYYY-MM-DD) 사이 일수. b가 뒤면 양수. */
export const daysBetween = (a: string, b: string) =>
  Math.round((toUtcDate(b).getTime() - toUtcDate(a).getTime()) / 86_400_000)

export const addYears = (dateKey: string, years: number) => {
  const date = toUtcDate(dateKey)
  date.setUTCFullYear(date.getUTCFullYear() + years)
  return date.toISOString().slice(0, 10)
}

export const dayOfWeekOf = (dateKey: string): DayOfWeek => {
  const index = toUtcDate(dateKey).getUTCDay() // 0 = 일요일
  return WEEK_DAYS[(index + 6) % 7]
}

export const sortDays = (days: DayOfWeek[]) =>
  [...new Set(days)].sort((a, b) => WEEK_DAYS.indexOf(a) - WEEK_DAYS.indexOf(b))

/** 처음 켰을 때의 규칙: 시작일의 요일에 매주. */
export const defaultRuleDraft = (startDate: string): RuleDraft => ({
  freq: 'WEEKLY',
  interval: 1,
  days: [dayOfWeekOf(startDate)],
  dayOfMonth: Number(startDate.slice(8, 10)) || 1,
  startDate,
  end: 'NONE',
  until: '',
  count: null,
})

export const toRuleDraft = (rule: RecurrenceRule): RuleDraft => ({
  freq: rule.freq,
  interval: rule.interval,
  days: sortDays(rule.days ?? []),
  dayOfMonth: rule.dayOfMonth ?? (Number(rule.startDate.slice(8, 10)) || 1),
  startDate: rule.startDate,
  end: rule.count ? 'COUNT' : rule.until ? 'UNTIL' : 'NONE',
  until: rule.until ?? '',
  count: rule.count ?? null,
})

/** 서버 본문. 주기에 맞지 않는 칸은 보내지 않는다. */
export const toRule = (draft: RuleDraft): RecurrenceRule => ({
  freq: draft.freq,
  interval: draft.interval ?? 0,
  ...(draft.freq === 'WEEKLY' ? { days: sortDays(draft.days) } : {}),
  ...(draft.freq === 'MONTHLY' ? { dayOfMonth: draft.dayOfMonth } : {}),
  startDate: draft.startDate,
  until: draft.end === 'UNTIL' ? draft.until : null,
  count: draft.end === 'COUNT' ? draft.count : null,
})

/**
 * 서버 규칙을 미리 알려 주는 검사. today가 있으면 시작일이 오늘 이후인지도 본다.
 * @returns 칸별 메시지. 비어 있으면 통과
 */
export const validateRuleDraft = (draft: RuleDraft, today?: string): Partial<Record<RuleDraftField, string>> => {
  const errors: Partial<Record<RuleDraftField, string>> = {}
  if (draft.interval === null || !Number.isInteger(draft.interval) || draft.interval < MIN_INTERVAL || draft.interval > MAX_INTERVAL) {
    errors.interval = `간격은 ${MIN_INTERVAL}부터 ${MAX_INTERVAL}까지예요.`
  }
  if (draft.freq === 'WEEKLY' && draft.days.length === 0) {
    errors.days = '반복할 요일을 하나 이상 골라 주세요.'
  }
  if (draft.freq === 'MONTHLY' && (draft.dayOfMonth === null || draft.dayOfMonth < 1 || draft.dayOfMonth > 31)) {
    errors.dayOfMonth = '날짜는 1일부터 31일까지예요.'
  }
  if (!isValidDateKey(draft.startDate)) {
    errors.startDate = '시작일을 골라 주세요.'
  } else if (today && draft.startDate < today) {
    errors.startDate = '시작일은 오늘 이후여야 해요.'
  }
  if (draft.end === 'UNTIL') {
    if (!isValidDateKey(draft.until)) {
      errors.until = '종료일을 골라 주세요.'
    } else if (isValidDateKey(draft.startDate) && draft.until < draft.startDate) {
      errors.until = '종료일은 시작일 이후여야 해요.'
    } else if (isValidDateKey(draft.startDate) && draft.until > addYears(draft.startDate, MAX_UNTIL_YEARS)) {
      errors.until = `종료일은 시작일부터 ${MAX_UNTIL_YEARS}년 안이어야 해요.`
    }
  }
  if (draft.end === 'COUNT' && (draft.count === null || !Number.isInteger(draft.count) || draft.count < MIN_COUNT || draft.count > MAX_COUNT)) {
    errors.count = `횟수는 ${MIN_COUNT}부터 ${MAX_COUNT}까지예요.`
  }
  return errors
}

const UNIT: Record<RecurrenceFrequency, string> = { DAILY: '일', WEEKLY: '주', MONTHLY: '개월' }

/** "매주 월·수·금, 10회"처럼 한 줄로 요약한다. */
export const describeRule = (rule: RecurrenceRule): string => {
  const head = rule.interval > 1 ? `${rule.interval}${UNIT[rule.freq]}마다` : FREQ_LABEL[rule.freq]
  let body = head
  if (rule.freq === 'WEEKLY') {
    body = `${head} ${sortDays(rule.days ?? []).map((day) => DAY_SHORT[day]).join('·')}`
  } else if (rule.freq === 'MONTHLY') {
    body = `${head} ${rule.dayOfMonth}일${(rule.dayOfMonth ?? 0) > 28 ? '(없는 달은 건너뜀)' : ''}`
  }
  if (rule.count) return `${body}, ${rule.count}회`
  if (rule.until) return `${body}, ${rule.until}까지`
  return body
}

/** dry-run 결과를 확인 문구로. 바뀌는 것이 없으면 null. */
export const editImpactMessage = (impact: RecurrenceEditImpact): string | null => {
  const parts: string[] = []
  if (impact.patched) parts.push(`회차 ${impact.patched}개를 고쳐요`)
  if (impact.deleted) parts.push(`회차 ${impact.deleted}개를 지워요`)
  if (impact.created) parts.push(`회차 ${impact.created}개를 새로 만들어요`)
  if (parts.length === 0) return null
  let message = `${parts.join(', ')}.`
  if (impact.overwrittenIndividualEdits) {
    message += ` 하나씩 옮기거나 고친 회차 ${impact.overwrittenIndividualEdits}개가 반복 규칙대로 바뀌어요.`
  }
  return message
}

export const deleteImpactMessage = (impact: RecurrenceDeleteImpact): string => {
  const kept = impact.protected ? ` 시작했거나 끝났거나 지난 회차 ${impact.protected}개는 남아요.` : ''
  return `회차 ${impact.deleted}개를 지워요.${kept}`
}

/** 주간 화면이 서버가 회차를 채우는 범위(오늘 + 90일)보다 먼 날을 보는지. */
export const isBeyondGeneration = (dateKey: string, today: string) => daysBetween(today, dateKey) > TOP_UP_LIMIT_DAYS

/** 서버 400 본문의 errors[]를 필드별 메시지로. 모르는 형식이면 빈 객체. */
export const mapRecurrenceServerErrors = (payload: unknown): Record<string, string> => {
  const errors = (payload as { errors?: { field?: string; reason?: string }[] } | null)?.errors
  if (!Array.isArray(errors)) return {}
  const mapped: Record<string, string> = {}
  for (const error of errors) {
    if (error?.field && error.reason && !(error.field in mapped)) mapped[error.field] = error.reason
  }
  return mapped
}

type FixedValues = {
  title: string
  description: string
  /** "HH:mm" */
  startTime: string
  plannedDurationMinutes: number | null
  scheduleType: string
}

/**
 * 고정 시각형 회차 편집을 시리즈 범위 변경으로 옮긴다. 바뀐 값만 담는다.
 * 날짜는 담지 않는다. 날짜를 옮기는 것은 "이번만"에서만 된다.
 */
export const fixedChanges = (before: FixedValues, after: FixedValues) => {
  const fixed: Record<string, string> = {}
  if (after.startTime !== before.startTime) fixed.startTime = after.startTime
  if (after.plannedDurationMinutes !== null && after.plannedDurationMinutes !== before.plannedDurationMinutes) {
    fixed.plannedDuration = minutesToIso(after.plannedDurationMinutes)
  }
  if (after.scheduleType !== before.scheduleType) fixed.scheduleType = after.scheduleType
  return {
    ...(after.title !== before.title ? { title: after.title } : {}),
    ...(after.description !== before.description ? { description: after.description } : {}),
    ...(Object.keys(fixed).length ? { fixed } : {}),
  }
}

type FlexibleValues = {
  title: string
  description: string
  importance: number
  difficulty: number
  /** 0이면 입력 해제 */
  expectedDurationMinutes: number
}

export const flexibleChanges = (before: FlexibleValues, after: FlexibleValues) => {
  const flexible: Record<string, number | string> = {}
  if (after.importance !== before.importance) flexible.importance = after.importance
  if (after.difficulty !== before.difficulty) flexible.difficulty = after.difficulty
  if (after.expectedDurationMinutes !== before.expectedDurationMinutes) {
    flexible.expectedDuration = minutesToIso(after.expectedDurationMinutes)
  }
  return {
    ...(after.title !== before.title ? { title: after.title } : {}),
    ...(after.description !== before.description ? { description: after.description } : {}),
    ...(Object.keys(flexible).length ? { flexible } : {}),
  }
}

const minutesToIso = (minutes: number) => {
  const safe = Math.max(0, Math.floor(minutes))
  if (safe === 0) return 'PT0S'
  const hours = Math.floor(safe / 60)
  const rest = safe % 60
  return `PT${hours ? `${hours}H` : ''}${rest ? `${rest}M` : ''}`
}
