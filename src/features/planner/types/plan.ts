import type { DateTimeWithZone } from '@shared/types/datetime'
import type { ScheduleResponse, ScheduleTaskType } from '@features/schedules/types/schedule'

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
  /** 블록 길이 = 작업의 유효 예상 소요시간 */
  duration: string
  scheduleType: ScheduleTaskType
  /** 마감이 지났거나 계획일이 마감인 필수 등급 */
  mustTier: boolean
}

export type UnplacedTask = {
  taskId: number
  title: string
  reason: UnplacedReason
  mustTier: boolean
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
