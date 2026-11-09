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
export type UnavailableReason =
  | 'ADMIN_ONLY'
  | 'SPACE_DELETED'
  | 'SCHEDULE_RUNNING'
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
