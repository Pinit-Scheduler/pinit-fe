// 서버 응답 타입. 웹의 schedules/tasks/spaces 타입에서 앱 화면이 쓰는 필드만 가져왔다.

export type DateTimeWithZone = { dateTime: string; zoneId: string }
export type DateWithOffset = { date: string; zoneId: string; offset?: string }

/** 서버가 이 회원에게 허용한 동작. 화면은 이 값으로만 버튼을 켠다. */
export type AllowedActions = {
  start?: boolean
  suspend?: boolean
  complete?: boolean
  cancel?: boolean
  reopen?: boolean
  schedule?: boolean
  update?: boolean
  delete?: boolean
}

type WorkspaceMetadata = {
  spaceId: number
  projectId: number | null
  assigneeId: number | null
  assigneeNickname: string | null
  /** 낙관적 잠금 버전. 상태를 바꿀 때 expectedVersion으로 돌려보낸다. */
  version: number
  allowedActions: AllowedActions
}

export type ScheduleState = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'SUSPENDED'
export type ScheduleType = 'DEEP_WORK' | 'QUICK_TASK' | 'ADMIN_TASK'
export type ScheduleAction = 'START' | 'SUSPEND' | 'COMPLETE' | 'CANCEL'

export type Schedule = WorkspaceMetadata & {
  id: number
  title: string
  description: string
  date: DateTimeWithZone
  scheduleType?: ScheduleType
  state: ScheduleState
  taskId?: number | null
  /** 계획 길이(ISO-8601) */
  plannedDuration?: string | null
  recurring: boolean
}

export type TaskAction = 'COMPLETE' | 'REOPEN'

export type Task = WorkspaceMetadata & {
  id: number
  title: string
  description: string
  dueDate: DateWithOffset
  importance: number
  difficulty: number
  /** 유효 예상 소요시간(ISO-8601). 입력값, 없으면 난이도 환산값 */
  effectiveExpectedDuration?: string | null
  completed: boolean
  /** 아직 완료되지 않은 이전 작업 수 */
  inboundDependencyCount: number
  recurring: boolean
}

export type TaskPage = { items: Task[]; last: boolean }

export type SpaceIndex = {
  defaultSpaceId: number
  memberId: number
  nickname: string
  spaces: { id: number; name: string }[]
}
