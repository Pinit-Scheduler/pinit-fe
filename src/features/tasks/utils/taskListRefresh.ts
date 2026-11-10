import type { DataChangeBatch } from '@shared/utils/events'

const COMPLETION_REASONS = new Set(['state-mutated', 'complete', 'reopen'])

/** Only completions or reopens of known tasks: the rows on screen already show the new state. */
export const isCompletionOnly = ({ tasks, schedules }: DataChangeBatch) =>
  tasks.length > 0 &&
  tasks.every(
    (detail) =>
      detail.taskId !== undefined && COMPLETION_REASONS.has(detail.reason ?? ''),
  ) &&
  schedules.every((detail) => detail.reason === 'task-state-mutated')
