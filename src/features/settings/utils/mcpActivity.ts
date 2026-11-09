// AI 사용 이력(ADR-0026) 표시 규칙. 서버는 값 없이 tool 이름·인자 이름·대상 id만 준다.

type ActivityLike = {
  tool: string
  outcome: string
  argumentNames?: string[] | null
  targets?: { type: string; id: number }[] | null
}

const TOOL_LABELS: Record<string, string> = {
  list_spaces: '스페이스 목록 조회',
  list_workspace_trash: '휴지통 조회',
  get_space: '스페이스 조회',
  create_space: '스페이스 만들기',
  update_space: '스페이스·목적 수정',
  restore_space: '스페이스 복구',
  delete_space: '스페이스 삭제',
  set_space_member_role: '스페이스 관리자 역할 변경',
  remove_space_member: '스페이스 참여자 제외',
  leave_space: '스페이스 탈퇴',
  create_space_invitation: '스페이스 초대 링크 만들기',
  preview_space_invitation: '스페이스 초대 확인',
  accept_space_invitation: '스페이스 초대 수락',
  revoke_space_invitation: '스페이스 초대 링크 철회',
  list_projects: '프로젝트 목록 조회',
  create_project: '프로젝트 만들기',
  update_project: '프로젝트 수정·이동',
  delete_project: '프로젝트 삭제',
  restore_project: '프로젝트 복구',
  workspace_task_draft: '공유 작업 기본값 조회',
  list_workspace_tasks: '스페이스 작업 목록 조회',
  get_workspace_task: '스페이스 작업 조회',
  create_workspace_task: '스페이스 작업 만들기',
  update_workspace_task: '스페이스 작업 수정·이동',
  change_workspace_task_state: '스페이스 작업 상태 변경',
  update_workspace_dependencies: '스페이스 작업 선후관계 변경',
  delete_workspace_task: '스페이스 작업 삭제',
  restore_workspace_task: '스페이스 작업 복구',
  schedule_workspace_task: '스페이스 작업 일정 배정',
  list_workspace_schedules: '스페이스 일정 목록 조회',
  get_workspace_schedule: '스페이스 일정 조회',
  create_workspace_schedule: '스페이스 일정 만들기',
  update_workspace_schedule: '스페이스 일정 수정·이동',
  change_workspace_schedule_state: '스페이스 일정 상태 변경',
  delete_workspace_schedule: '스페이스 일정 삭제',
  restore_workspace_schedule: '스페이스 일정 복구',
  create_workspace_recurrence: '스페이스 반복 만들기',
  list_workspace_recurrences: '스페이스 반복 목록 조회',
  get_workspace_recurrence: '스페이스 반복 조회',
  update_workspace_recurrence: '스페이스 반복 수정·이동',
  delete_workspace_recurrence: '스페이스 반복 삭제',
  list_schedules_by_date: '날짜별 일정 조회',
  list_schedules_by_week: '주간 일정 조회',
  get_schedule: '일정 조회',
  create_schedule: '일정 만들기',
  update_schedule: '일정 수정',
  start_schedule: '일정 시작',
  complete_schedule: '일정 완료',
  suspend_schedule: '일정 일시중지',
  cancel_schedule: '일정 시작 취소',
  list_tasks: '작업 목록 조회',
  list_tasks_by_deadline: '마감일별 작업 조회',
  get_task: '작업 조회',
  create_task: '작업 만들기',
  update_task: '작업 수정',
  complete_task: '작업 완료',
  reopen_task: '작업 다시 열기',
  schedule_task: '작업을 일정에 등록',
  link_tasks: '작업 순서 연결',
  unlink_tasks: '작업 순서 끊기',
  plan_day: '하루 계획 제안',
  apply_plan: '계획 적용',
  weekly_review: '주간 리뷰 조회',
  get_time_calibration: '시간 보정 조회',
  get_statistics: '통계 조회',
  get_recurrence_statistics: '반복 달성률 조회',
  get_routines: '생활 시간 조회',
  replace_routines: '생활 시간 저장',
  create_recurrence: '반복 만들기',
  list_recurrences: '반복 목록 조회',
  update_recurrence: '반복 수정',
  delete_schedule: '일정 삭제',
  delete_task: '작업 삭제',
  delete_recurrence: '반복 삭제',
}

const DELETE_TOOLS = new Set([
  'delete_schedule',
  'delete_task',
  'delete_recurrence',
  'delete_space',
  'delete_project',
  'revoke_space_invitation',
  'remove_space_member',
  'leave_space',
  'delete_workspace_task',
  'delete_workspace_schedule',
  'delete_workspace_recurrence',
])

const TARGET_LABELS: Record<string, string> = {
  task: '작업',
  schedule: '일정',
  recurrence: '반복',
}

const OUTCOME_BADGES: Record<string, string> = {
  ERROR: '실패',
  DENIED: '권한 없음',
  RATE_LIMITED: '호출 한도 초과',
}

/** 화면에 보일 대상 수. 나머지는 "외 N개"로 줄인다. */
export const MAX_SHOWN_TARGETS = 3

/**
 * 한국어 동작 이름. 삭제 tool은 확인 token 없이 부른 1단계를 "미리보기"로 구분한다(ADR-0014).
 * 모르는 tool은 이름을 그대로 보인다.
 */
export const describeActivity = (activity: ActivityLike) => {
  const label = TOOL_LABELS[activity.tool] ?? activity.tool
  if (
    DELETE_TOOLS.has(activity.tool) &&
    !(activity.argumentNames ?? []).includes('confirmationToken')
  ) {
    return `${label} 미리보기`
  }
  return label
}

/** "작업 #12 · 일정 #30 외 2개". 대상이 없으면 null. */
export const formatTargets = (targets: ActivityLike['targets']) => {
  const list = targets ?? []
  if (list.length === 0) return null
  const shown = list
    .slice(0, MAX_SHOWN_TARGETS)
    .map(
      (target) => `${TARGET_LABELS[target.type] ?? target.type} #${target.id}`,
    )
    .join(' · ')
  const rest = list.length - MAX_SHOWN_TARGETS
  return rest > 0 ? `${shown} 외 ${rest}개` : shown
}

/** 결과 배지. 정상(OK)이면 null. */
export const outcomeBadge = (outcome: string) =>
  OUTCOME_BADGES[outcome] ?? (outcome === 'OK' ? null : outcome)
