// 일정 상태의 이름과, 상태마다 누를 수 있는 동작. 의존성이 없어 node 테스트에서 그대로 불러 쓴다.
// 이름은 웹(src/constants/schedules.ts)과 같다. 동작을 켤지는 서버의 allowedActions만 따른다.

export type ScheduleStateName = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'SUSPENDED'
export type ScheduleActionName = 'START' | 'SUSPEND' | 'COMPLETE' | 'CANCEL'
type Allowed = { start?: boolean; suspend?: boolean; complete?: boolean; cancel?: boolean }

export const STATE_LABEL: Record<ScheduleStateName, string> = {
  NOT_STARTED: '미시작',
  IN_PROGRESS: '진행중',
  COMPLETED: '완료',
  SUSPENDED: '일시정지',
}

export const TYPE_LABEL: Record<'DEEP_WORK' | 'QUICK_TASK' | 'ADMIN_TASK', string> = {
  DEEP_WORK: '집중 작업',
  QUICK_TASK: '빠른 일정',
  ADMIN_TASK: '행정 작업',
}

/** 저장이 끝나면 일정이 놓이는 상태. 저장하는 동안 화면에 먼저 보여 준다. */
export const TARGET_STATE: Record<ScheduleActionName, ScheduleStateName> = {
  START: 'IN_PROGRESS',
  SUSPEND: 'SUSPENDED',
  COMPLETE: 'COMPLETED',
  CANCEL: 'NOT_STARTED',
}

export const ACTION_DONE_MESSAGE: Record<ScheduleActionName, string> = {
  START: '일정을 시작했습니다.',
  SUSPEND: '일정을 일시 중지했습니다.',
  COMPLETE: '일정을 완료했습니다.',
  CANCEL: '일정을 취소하고 미시작 상태로 되돌렸습니다.',
}

const ALLOWED_KEY: Record<ScheduleActionName, keyof Allowed> = {
  START: 'start',
  SUSPEND: 'suspend',
  COMPLETE: 'complete',
  CANCEL: 'cancel',
}

export const isAllowed = (allowed: Allowed | null | undefined, action: ScheduleActionName) =>
  allowed?.[ALLOWED_KEY[action]] === true

/**
 * 일정 카드의 왼쪽 상태 버튼을 눌렀을 때 할 일. 웹 ScheduleCard와 같다.
 * 미시작이면 시작, 완료면 미시작으로 되돌리기. 진행중·일시정지는 아래 컨트롤 바에서 다룬다.
 */
export const cardTapAction = (state: ScheduleStateName, allowed: Allowed | null | undefined): ScheduleActionName | null => {
  if (state === 'NOT_STARTED') return isAllowed(allowed, 'START') ? 'START' : null
  if (state === 'COMPLETED') return isAllowed(allowed, 'CANCEL') ? 'CANCEL' : null
  return null
}

/** 미시작 일정에만 보이는 '즉시 완료'. */
export const canQuickComplete = (state: ScheduleStateName, allowed: Allowed | null | undefined) =>
  state === 'NOT_STARTED' && isAllowed(allowed, 'COMPLETE')

/** 컨트롤 바는 진행중이거나 일시정지한 일정만 다룬다. */
export const isActiveState = (state: ScheduleStateName) => state === 'IN_PROGRESS' || state === 'SUSPENDED'
