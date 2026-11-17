/** 작업 응답의 `split` 필드(ADR-0035 §8.4). pinit-monolith `SplitTaskView`·`SplitLockView`와 같다. */
export type SplitLockStage = 'PROCESSING' | 'PROPOSAL_READY'
export type CannotRequestReason =
  | 'TASK_COMPLETED'
  | 'RECURRING_TASK'
  | 'HAS_LINKED_SCHEDULE'
  | 'ADMIN_ONLY'
  | 'SPLIT_IN_PROGRESS'
export type SplitLock = {
  stage: SplitLockStage
  mine: boolean
  /** mine일 때만 */
  requestId: number | null
  /** mine일 때만 */
  requestStatus: 'QUEUED' | 'RUNNING' | 'READY' | null
  /** 다른 참여자의 요청일 때만 */
  requesterNickname: string | null
}
export type TaskSplitInfo = {
  recommended: boolean
  canRequest: boolean
  cannotRequestReasons: (CannotRequestReason | string)[]
  lock: SplitLock | null
}
