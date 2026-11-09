import type { DayReplanApplyRequest, DayReplanPreview } from '../types/replan'

const REASON_LABELS: Record<string, string> = {
  INDEPENDENT_APPOINTMENT: '작업에 연결되지 않은 약속은 유지해요.',
  RECURRING_SCHEDULE: '반복 일정은 이번 재배치에서 유지해요.',
  IN_PROGRESS: '진행 중인 일정은 유지해요.',
  SUSPENDED: '일시정지한 일정은 유지해요.',
  COMPLETED: '완료한 일정은 유지해요.',
  TASK_UNAVAILABLE: '연결된 작업을 배치할 수 없어 유지해요.',
  OUTSIDE_TODAY: '오늘 밖에서 시작한 일정은 유지해요.',
  NOT_ASSIGNED_TO_YOU: '나에게 배정되지 않은 작업·일정은 유지해요.',
  OUTSIDE_PROJECT: '선택한 프로젝트 밖의 일정은 유지해요.',
  DEADLINE_PASSED: '마감 안에 끝낼 수 없어 배치하지 못했어요.',
  PREDECESSOR_NOT_PLACED: '선행 작업을 먼저 끝낼 수 없어 배치하지 못했어요.',
  NO_FITTING_SLOT: '오늘 남은 시간과 마감·생활 시간·다른 일정을 고려하면 충분한 시간이 없어요.',
}

export const replanReasonLabel = (reason: string) =>
  REASON_LABELS[reason] ?? '현재 조건에서 이동할 수 없어요. 기존 일정을 유지해요.'

export const validateReplanDelay = (value: string): string | null => {
  if (!/^\d+$/.test(value)) return '늦어진 시간을 0~240분의 정수로 입력해 주세요.'
  const minutes = Number(value)
  return minutes >= 0 && minutes <= 240
    ? null
    : '늦어진 시간을 0~240분의 정수로 입력해 주세요.'
}

/** Preserve server proposal order, discard IDs outside this snapshot, never send new times. */
export const buildReplanApplyRequest = (
  preview: DayReplanPreview,
  selectedIds: number[],
): DayReplanApplyRequest => {
  const selected = new Set(selectedIds)
  return {
    spaceId: preview.spaceId,
    projectId: preview.projectId,
    date: preview.date,
    zoneId: preview.zoneId,
    delayMinutes: preview.delayMinutes,
    plannedAt: preview.plannedAt,
    snapshotToken: preview.snapshotToken,
    selectedScheduleIds: preview.changes
      .filter((change) => selected.has(change.scheduleId))
      .map((change) => change.scheduleId),
  }
}

export const isReplanExpired = (plannedAt: string, now: number) => {
  const generated = Date.parse(plannedAt)
  return !Number.isFinite(generated) || now - generated >= 15 * 60_000
}
