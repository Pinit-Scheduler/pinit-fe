// ADR-0019 반복 일정·반복 작업(/v2/recurrences) wire 형식.

import type { DayOfWeek } from '@features/routines/types/routine'

export type { DayOfWeek }

/** FIXED: 회차 = 작업 없는 일정(정한 시각). FLEXIBLE: 회차 = 회차 날짜가 마감인 작업. */
export type RecurrenceMode = 'FIXED' | 'FLEXIBLE'

export type RecurrenceStatus = 'ACTIVE' | 'ENDED'

export type RecurrenceFrequency = 'DAILY' | 'WEEKLY' | 'MONTHLY'

/** FOLLOWING: 이번 및 이후. ALL: 전체. "이번만"은 기존 일정·작업 API를 쓴다. */
export type RecurrenceScope = 'FOLLOWING' | 'ALL'

export type RecurrenceRule = {
  freq: RecurrenceFrequency
  /** 1~99. 매 N일·N주·N개월 */
  interval: number
  /** WEEKLY에만 */
  days?: DayOfWeek[]
  /** MONTHLY에만(1~31). 그 달에 없으면 건너뛴다 */
  dayOfMonth?: number | null
  /** YYYY-MM-DD */
  startDate: string
  /** 마지막 날짜(포함). count와 함께 쓰지 않는다 */
  until?: string | null
  /** 1~365 */
  count?: number | null
}

export type FixedTemplate = {
  /** "HH:mm" */
  startTime: string
  /** ISO-8601 */
  plannedDuration: string
  scheduleType: 'DEEP_WORK' | 'QUICK_TASK' | 'ADMIN_TASK'
}

export type FlexibleTemplate = {
  importance: number
  difficulty: number
  /** ISO-8601. 생략하거나 PT0S면 난이도 환산값 */
  expectedDuration?: string | null
}

export type RecurrenceSeries = {
  id: number | null
  mode: RecurrenceMode
  status: RecurrenceStatus
  title: string
  description: string
  fixed: FixedTemplate | null
  flexible: FlexibleTemplate | null
  rule: RecurrenceRule
  zoneId: string
  generatedUntil: string
  /** 끝났거나 오늘 이후에 만들 회차 날짜가 없다 */
  ended: boolean
  createdAt?: string | null
  updatedAt?: string | null
}

export type RecurrenceCreateRequest = {
  mode: RecurrenceMode
  title: string
  description: string
  fixed?: FixedTemplate
  flexible?: FlexibleTemplate
  rule: RecurrenceRule
  zoneId: string
}

/** 바꿀 값만 보낸다. 시작 시각·규칙·시간대를 바꾸면 회차를 지우고 다시 만든다. */
export type RecurrenceChanges = {
  title?: string
  description?: string
  fixed?: Partial<FixedTemplate>
  flexible?: Partial<FlexibleTemplate>
  rule?: RecurrenceRule
  zoneId?: string
}

export type RecurrenceUpdateRequest = {
  scope: RecurrenceScope
  /** FOLLOWING이면 기준 회차 날짜 */
  fromDate?: string
  changes: RecurrenceChanges
}

export type RecurrenceEditImpact = {
  patched: number
  deleted: number
  created: number
  overwrittenIndividualEdits: number
}

export type RecurrenceEditResponse = {
  series: RecurrenceSeries
  previous: RecurrenceSeries | null
  impact: RecurrenceEditImpact
}

export type RecurrenceDeleteImpact = {
  deleted: number
  protected: number
}

export type RecurrenceDeleteResponse = { impact: RecurrenceDeleteImpact }

export type RecurrenceListResponse = { recurrences: RecurrenceSeries[] }

/** 일정·작업 응답의 회차 표시. 반복 회차가 아니면 null */
export type RecurrenceRef = {
  seriesId: number
  /** 규칙이 만든 원래 날짜(YYYY-MM-DD). 회차를 옮겨도 바뀌지 않는다 */
  occurrenceDate: string
}
