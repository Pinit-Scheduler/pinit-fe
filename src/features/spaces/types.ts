export type AllowedActions = {
  edit?: boolean
  update?: boolean
  delete?: boolean
  restore?: boolean
  invite?: boolean
  manageMembers?: boolean
  leave?: boolean
  move?: boolean
  assign?: boolean
  start?: boolean
  suspend?: boolean
  complete?: boolean
  cancel?: boolean
  reopen?: boolean
  schedule?: boolean
  editDependencies?: boolean
}
/** 서버가 꺼진 동작에 붙이는 이유 코드. pinit-monolith `UnavailableReason`과 같다. */
export type UnavailableReason =
  | 'ADMIN_ONLY'
  | 'SPACE_DELETED'
  | 'PROJECT_DELETED'
  | 'PERSONAL_SPACE'
  | 'LAST_ADMIN'
  | 'SCHEDULE_RUNNING'
  | 'TASK_COMPLETED'
  | 'PREDECESSOR_INCOMPLETE'
  | 'ALREADY_SCHEDULED'
  | 'RECURRING_TASK'
export type UnavailableReasons = Partial<
  Record<keyof AllowedActions, UnavailableReason>
>
export type SpaceMember = {
  memberId: number
  nickname: string
  role: 'ADMIN' | 'MEMBER'
}
export type Space = {
  id: number
  name: string
  purpose: string | null
  personal: boolean
  version: number
  deletedAt?: string | null
  deleted?: boolean
  allowedActions: AllowedActions
  unavailableReasons?: UnavailableReasons
  members: SpaceMember[]
}
export type Project = {
  id: number
  spaceId: number
  name: string
  outcome: string | null
  completed: boolean
  version: number
  deletedAt?: string | null
  deleted?: boolean
  allowedActions: AllowedActions
  unavailableReasons?: UnavailableReasons
}
export type Affiliation = {
  spaceId: number
  projectId: number | null
  assigneeId: number | null
  assigneeNickname?: string | null
  version: number
  allowedActions: AllowedActions
  unavailableReasons?: UnavailableReasons
}
export type WorkspaceSnapshot = {
  memberId: number
  nickname: string
  defaultSpaceId: number
  spaces: Space[]
  projects: Project[]
  taskAssignments: Record<string, Affiliation>
  scheduleAssignments: Record<string, Affiliation>
}
export type Invitation = {
  id: string
  spaceId: number
  spaceName: string
  purpose?: string | null
  token?: string
  inviteUrl?: string
  expiresAt: string
  nickname?: string
  status?: 'VALID' | 'ALREADY_MEMBER' | 'JOINED'
}
export type SpaceInput = {
  name: string
  purpose?: string | null
  expectedVersion?: number
}
export type ProjectInput = {
  spaceId: number
  name: string
  outcome?: string | null
  expectedVersion?: number
}
/** ADR-0030 §3: 네 상태는 겹치지 않고 합이 total이다. */
export type TaskStateCounts = {
  total: number
  completed: number
  running: number
  unassigned: number
  open: number
}
export type SpaceSummaries = {
  asOf: string
  spaces: {
    spaceId: number
    memberCount: number
    openTaskCount: number
    unassignedOpenCount: number
  }[]
}
export type SpaceSummary = {
  spaceId: number
  asOf: string
  projects: {
    projectId: number
    counts: TaskStateCounts
    nearestDueDate: string | null
  }[]
  withoutProject: { counts: TaskStateCounts; nearestDueDate: string | null }
  members: {
    memberId: number
    openAssignedCount: number
    nearestDueDate: string | null
  }[]
  unassigned: { openCount: number; nearestDueDate: string | null }
}
/** ADR-0030 §5. end는 다음 월요일이며 기간에 들지 않는다. 시간은 ISO-8601. */
export type WeeklyRecord = {
  spaceId: number
  start: string
  end: string
  zoneId: string
  current: boolean
  completedCount: number
  elapsed: string
  days: { date: string; elapsed: string }[]
  byProject: { projectId: number | null; elapsed: string }[]
  byRunner: { memberId: number; elapsed: string }[]
}
