// ADR-0025 기간·추세·반복 시리즈 통계 응답. 서버가 읽을 때마다 계산한다.

export type StatisticsUnit = 'WEEK' | 'MONTH'

export type ScheduleTypeKey = 'DEEP_WORK' | 'ADMIN_TASK' | 'QUICK_TASK'

export type PeriodScheduleCounts = {
  count: number
  completedCount: number
  /** 소수 둘째 자리. 일정이 없으면 null */
  completionRate: number | null
  /** ISO-8601. 완료한 일정의 실행 시간 합 */
  elapsed: string
}

export type PeriodTypeCounts = PeriodScheduleCounts & {
  scheduleType: ScheduleTypeKey
}

export type PeriodStatisticsResponse = {
  unit: StatisticsUnit
  /** 기간 첫날 YYYY-MM-DD */
  start: string
  /** 다음 기간 첫날(포함하지 않음) */
  end: string
  zoneId: string
  current: boolean
  schedules: PeriodScheduleCounts
  /** DEEP_WORK, ADMIN_TASK, QUICK_TASK 순서로 항상 셋 */
  byType: PeriodTypeCounts[]
  tasksDue: {
    count: number
    completedCount: number
    completionRate: number | null
  }
}

export type StatisticsTrendResponse = {
  unit: StatisticsUnit
  zoneId: string
  /** 오래된 것부터 */
  periods: PeriodStatisticsResponse[]
}

export type RecurrenceStatisticsResponse = {
  seriesId: number
  mode: 'FIXED' | 'FLEXIBLE'
  status: 'ACTIVE' | 'ENDED'
  title: string
  zoneId: string
  asOf: string
  completedCount: number
  missedCount: number
  pendingToday: boolean
  completionRate: number | null
  recent: {
    days: number
    completedCount: number
    missedCount: number
    completionRate: number | null
  }
  currentStreak: number
  longestStreak: number
  lastCompletedDate: string | null
  totalElapsed: string
}

export type RecurrenceStatisticsListResponse = {
  recurrences: RecurrenceStatisticsResponse[]
}
