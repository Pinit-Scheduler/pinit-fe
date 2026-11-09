export type MoveResult = {
  movedTaskIds: number[]
  movedScheduleIds: number[]
  removedDependencyCount: number
}

export function moveResultMessage(result?: MoveResult) {
  if (!result) return null
  return `소속을 옮겼어요. 작업 ${result.movedTaskIds.length}개·일정 ${result.movedScheduleIds.length}개가 함께 이동했고, 스페이스를 가로지르던 선행 관계 ${result.removedDependencyCount}개를 해제·기록했어요.`
}
