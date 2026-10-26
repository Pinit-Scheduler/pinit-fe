import type { DateTimeWithZone } from '@shared/types/datetime'
import type { ScheduleResponse, ScheduleTaskType } from '@features/schedules/types/schedule'
import type { RoutineKind } from '@features/routines/types/routine'
import type { FactorSource } from '@features/calibration/types/calibration'

// ADR-0015 하루 계획 API(GET /v2/plans, POST /v2/plans/apply) wire 형식.
// 길이는 ISO-8601 기간 문자열("PT1H30M")이다.

export type UnplacedReason = 'NO_FITTING_SLOT' | 'DAILY_OBJECTIVE_EXCEEDED' | 'PREDECESSOR_NOT_PLACED'

export type BlockRejectionReason =
  | 'TASK_NOT_FOUND'
  | 'TASK_COMPLETED'
  | 'TASK_ALREADY_SCHEDULED'
  | 'DUPLICATE_TASK'
  | 'STARTS_IN_PAST'
  | 'OVERLAPS_BLOCK'
  | 'OVERLAPS_SCHEDULE'
  | 'PREDECESSOR_ENDS_AFTER_START'
  | 'PREDECESSOR_NOT_SCHEDULED'

export type PlannedBlock = {
  taskId: number
  title: string
  start: DateTimeWithZone
  /** 블록 끝(제외) */
  end: DateTimeWithZone
  /** 블록 길이. 보정을 켰으면 baseDuration × calibrationFactor(5분 단위 올림)이다 */
  duration: string
  scheduleType: ScheduleTaskType
  /** 마감이 지났거나 계획일이 마감인 필수 등급 */
  mustTier: boolean
  /** ADR-0018: 보정 전 길이 = 작업의 유효 예상 소요시간. 이전 서버 응답에는 없다 */
  baseDuration?: string
  /** ADR-0018: 곱한 계수. 보정하지 않았으면 1 */
  calibrationFactor?: number
  /** ADR-0018: 계수 출처 */
  factorSource?: FactorSource
  /** ADR-0019: 반복 작업 회차이면 시리즈 ID. 이전 서버 응답에는 없다 */
  recurrenceSeriesId?: number | null
}

export type UnplacedTask = {
  taskId: number
  title: string
  reason: UnplacedReason
  mustTier: boolean
  /** ADR-0018: 배치하려던 블록 길이와 그 계수. 이전 서버 응답에는 없다 */
  duration?: string
  baseDuration?: string
  calibrationFactor?: number
  factorSource?: FactorSource
}

export type DayPlanResponse = {
  date: string
  zoneId: string
  /** 블록을 놓을 수 있는 시간창 [start, end). start == end면 남은 시간이 없다 */
  window: { start: DateTimeWithZone; end: DateTimeWithZone }
  blocks: PlannedBlock[]
  unplaced: UnplacedTask[]
  objective: {
    dailyObjectiveWork: string
    existingTaskWork: string
    plannedWork: string
    used: string
  }
  /**
   * ADR-0016: 시간창 출처. 수면 생활 시간이 하나라도 있으면 SLEEP_ROUTINE(계획일 하루에서 생활 시간을 뺀 시간),
   * 없으면 PROFILE(기상~취침, 기본 07:00–23:00). 이전 서버 응답에는 없다.
   */
  windowSource?: 'PROFILE' | 'SLEEP_ROUTINE'
  /** ADR-0016: 계획일과 겹치는 생활 시간 구간, 시작 순. 이전 서버 응답에는 없다 */
  routines?: PlanRoutineOccurrence[]
  /** ADR-0018: 회원이 보정을 켜서 블록 길이에 예상 대비 실제 계수를 썼는지. 이전 서버 응답에는 없다 */
  calibrationApplied?: boolean
}

export type PlanRoutineOccurrence = {
  routineId: number
  kind: RoutineKind
  label: string | null
  start: DateTimeWithZone
  end: DateTimeWithZone
}

export type PlanApplyBlock = {
  taskId: number
  /** 오프셋 없는 로컬 시각(YYYY-MM-DDTHH:mm:ss), zoneId로 해석 */
  startTime: string
  scheduleType?: ScheduleTaskType
}

export type PlanApplyRequest = {
  date: string
  zoneId: string
  blocks: PlanApplyBlock[]
}

export type PlanApplyResponse = {
  schedules: ScheduleResponse[]
}

export type PlanRejection = {
  /** 요청 blocks 안의 0부터 시작하는 위치 */
  blockIndex: number
  taskId: number
  reason: BlockRejectionReason | string
  detail?: string
}
