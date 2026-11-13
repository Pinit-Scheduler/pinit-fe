import type { SpaceMember, UnavailableReason } from './types'

export const adminNames = (members: SpaceMember[]): string[] =>
  members
    .filter((member) => member.role === 'ADMIN')
    .map((member) => member.nickname)

/** 문구는 서버가 준 이유로만 고른다. 역할이나 일정 상태로 추측하지 않는다. */
export const unavailableText = (
  reason: UnavailableReason | undefined,
  admins: string[],
): string => {
  switch (reason) {
    case 'ADMIN_ONLY':
      return admins.length > 0
        ? `관리자 ${admins.join('·')}님만 할 수 있어요.`
        : '관리자만 할 수 있어요.'
    case 'SPACE_DELETED':
      return '휴지통에 있는 스페이스라 할 수 없어요.'
    case 'PROJECT_DELETED':
      return '휴지통에 있는 프로젝트라 할 수 없어요.'
    case 'PERSONAL_SPACE':
      return '나의 스페이스에서는 할 수 없어요.'
    case 'LAST_ADMIN':
      return '다른 관리자를 정한 뒤 나갈 수 있어요.'
    case 'SCHEDULE_RUNNING':
      return '진행 중이거나 멈춘 일정은 삭제할 수 없어요.'
    case 'TASK_COMPLETED':
      return '완료한 작업은 일정에 넣을 수 없어요.'
    case 'PREDECESSOR_INCOMPLETE':
      return '먼저 할 작업을 끝내야 일정에 넣을 수 있어요.'
    case 'ALREADY_SCHEDULED':
      return '이미 일정에 넣은 작업이에요.'
    case 'RECURRING_TASK':
      return '반복 작업은 순서를 연결할 수 없어요.'
    // 서버가 나중에 더한 코드도 여기로 온다.
    default:
      return '지금은 할 수 없어요.'
  }
}

/** 꺼진 동작들의 문구. 같은 문구는 한 줄로 합친다. */
export const unavailableLines = (
  actions: Array<{ off: boolean; reason: UnavailableReason | undefined }>,
  admins: string[],
): string[] => [
  ...new Set(
    actions
      .filter((action) => action.off)
      .map((action) => unavailableText(action.reason, admins)),
  ),
]
