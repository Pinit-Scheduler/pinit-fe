// 휴지통 목록을 화면에서 바로 고치는 순수 함수. node:test가 그대로 불러오므로 import 없이 쓴다.

type ChangeBatch = {
  tasks: readonly { reason?: string }[]
  schedules: readonly { reason?: string }[]
}

/** 복구·영구 삭제가 끝난 작업을 목록에서 뺀다. 행은 그 자리에서 사라지는 애니메이션을 탄다. */
export const withoutTask = <C extends { tasks: { taskId: number }[] }>(
  contents: C,
  taskId: number,
): C => ({ ...contents, tasks: contents.tasks.filter((task) => task.taskId !== taskId) }) as C

export const withoutSchedule = <C extends { schedules: { scheduleId: number }[] }>(
  contents: C,
  scheduleId: number,
): C =>
  ({
    ...contents,
    schedules: contents.schedules.filter((schedule) => schedule.scheduleId !== scheduleId),
  }) as C

/** 이 화면에 있는 동안 다른 곳(삭제 토스트의 "되돌리기")에서 복구했을 때만 다시 읽는다. */
export const isRestoreBatch = ({ tasks, schedules }: ChangeBatch) =>
  [...tasks, ...schedules].some((detail) => detail.reason === 'restore')
