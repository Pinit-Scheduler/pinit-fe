import type { BlockRejectionReason, PlanRejection, UnplacedReason } from '../types/plan'

// 하루 계획 응답을 화면 문구로 옮기는 순수 함수 모음. 배치 규칙은 서버(ADR-0015 domain/planning)에 있고,
// 여기서는 사유 라벨과 승인 전 "명백한" 오류만 다룬다. 승인 가능 여부는 서버가 최종 판단한다.

/** 한 번에 승인할 수 있는 블록 수 (서버 @Size(max = 100)) */
export const MAX_APPLY_BLOCKS = 100

export const UNPLACED_REASON_LABEL: Record<UnplacedReason, string> = {
  NO_FITTING_SLOT: '남은 시간 안에 들어갈 빈 시간이 없어요.',
  DAILY_OBJECTIVE_EXCEEDED: '하루 목표 작업시간을 넘어서 제외했어요.',
  PREDECESSOR_NOT_PLACED: '선행 작업이 끝나지도, 이 계획에 배치되지도 않았어요.',
}

export const BLOCK_REJECTION_LABEL: Record<BlockRejectionReason, string> = {
  TASK_NOT_FOUND: '작업을 찾을 수 없어요. 삭제되었을 수 있어요.',
  TASK_COMPLETED: '이미 완료된 작업이에요.',
  TASK_ALREADY_SCHEDULED: '이미 일정이 잡힌 작업이에요.',
  DUPLICATE_TASK: '같은 작업이 두 번 선택되었어요.',
  STARTS_IN_PAST: '시작 시각이 이미 지났어요.',
  OVERLAPS_BLOCK: '선택한 다른 블록과 시간이 겹쳐요.',
  OVERLAPS_SCHEDULE: '기존 일정과 시간이 겹쳐요.',
  PREDECESSOR_ENDS_AFTER_START: '선행 작업이 끝나기 전에 시작해요.',
  PREDECESSOR_NOT_SCHEDULED: '선행 작업이 완료되지도, 일정에 잡히지도 않았어요.',
}

const hasOwn = <T extends object>(map: T, key: string): key is Extract<keyof T, string> =>
  Object.prototype.hasOwnProperty.call(map, key)

export const unplacedReasonLabel = (reason: string): string =>
  hasOwn(UNPLACED_REASON_LABEL, reason) ? UNPLACED_REASON_LABEL[reason] : `배치하지 못했어요. (${reason})`

export const blockRejectionLabel = (reason: string): string =>
  hasOwn(BLOCK_REJECTION_LABEL, reason) ? BLOCK_REJECTION_LABEL[reason] : `승인이 거부되었어요. (${reason})`

/** 409 본문에서 블록별 거부 사유를 꺼낸다. 거부 본문이 아니면 null. */
export const parsePlanRejections = (payload: unknown): PlanRejection[] | null => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const raw = (payload as { rejections?: unknown }).rejections
  if (!Array.isArray(raw)) return null
  return raw.flatMap((item): PlanRejection[] => {
    if (!item || typeof item !== 'object') return []
    const { blockIndex, taskId, reason, detail } = item as Record<string, unknown>
    if (typeof blockIndex !== 'number' || typeof reason !== 'string') return []
    return [{
      blockIndex,
      taskId: typeof taskId === 'number' ? taskId : NaN,
      reason,
      detail: typeof detail === 'string' && detail.trim() ? detail : undefined,
    }]
  })
}

export type BlockIssue = {
  /** 서버 거부 사유 코드. 클라이언트 검사면 없다 */
  reason?: string
  message: string
  detail?: string
}

/**
 * 거부 사유를 블록(작업 ID)별로 묶는다. blockIndex는 요청에 실은 블록 순서이므로 그 순서의 작업 ID로
 * 되돌리고, 위치가 맞지 않으면 응답의 taskId를 쓴다.
 */
export const mapRejectionsToBlocks = (
  rejections: PlanRejection[],
  submittedTaskIds: number[],
): Record<number, BlockIssue[]> => {
  const result: Record<number, BlockIssue[]> = {}
  rejections.forEach((rejection) => {
    const byIndex = submittedTaskIds[rejection.blockIndex]
    const taskId = byIndex !== undefined && (Number.isNaN(rejection.taskId) || byIndex === rejection.taskId)
      ? byIndex
      : rejection.taskId
    if (!Number.isFinite(taskId)) return
    const issues = result[taskId] ?? (result[taskId] = [])
    issues.push({ reason: rejection.reason, message: blockRejectionLabel(rejection.reason), detail: rejection.detail })
  })
  return result
}

export type SelectionBlock = {
  taskId: number
  title: string
  /** 시작 시각(epoch ms). 입력이 올바르지 않으면 null */
  startMs: number | null
  endMs: number | null
}

export type SelectionObstacle = {
  title: string
  startMs: number
  endMs: number
}

const overlaps = (a: { startMs: number; endMs: number }, b: { startMs: number; endMs: number }) =>
  a.startMs < b.endMs && b.startMs < a.endMs

/**
 * 승인 전에 고칠 수 있는 명백한 오류를 찾는다: 시각 누락, 지난 시각, 선택한 블록끼리 겹침, 기존 일정과 겹침.
 * 구간은 서버와 같은 [start, end)이고 맞닿는 것은 겹침이 아니다. 선후관계·진행 중 일정 점유는 서버가 본다.
 */
export const validatePlanSelection = (
  blocks: SelectionBlock[],
  obstacles: SelectionObstacle[],
  nowMs: number,
): Record<number, BlockIssue[]> => {
  const result: Record<number, BlockIssue[]> = {}
  const add = (taskId: number, issue: BlockIssue) => {
    const issues = result[taskId] ?? (result[taskId] = [])
    issues.push(issue)
  }

  blocks.forEach((block) => {
    if (block.startMs === null || block.endMs === null) {
      add(block.taskId, { message: '시작 시각을 입력하세요.' })
      return
    }
    const span = { startMs: block.startMs, endMs: block.endMs }
    if (span.startMs < nowMs) {
      add(block.taskId, { reason: 'STARTS_IN_PAST', message: BLOCK_REJECTION_LABEL.STARTS_IN_PAST })
    }
    blocks.forEach((other) => {
      if (other === block || other.startMs === null || other.endMs === null) return
      if (overlaps(span, { startMs: other.startMs, endMs: other.endMs })) {
        add(block.taskId, { reason: 'OVERLAPS_BLOCK', message: `선택한 "${other.title}" 블록과 시간이 겹쳐요.` })
      }
    })
    obstacles.forEach((obstacle) => {
      if (overlaps(span, obstacle)) {
        add(block.taskId, { reason: 'OVERLAPS_SCHEDULE', message: `기존 일정 "${obstacle.title}"과 시간이 겹쳐요.` })
      }
    })
  })
  return result
}
