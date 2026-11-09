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
    case 'SCHEDULE_RUNNING':
      return '진행 중이거나 멈춘 일정은 삭제할 수 없어요.'
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
