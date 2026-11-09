import type { DataChangeBatch } from '@shared/utils/events'

/**
 * After a completion the row keeps its place this long, so the check, the strike and the muted
 * colour play out before a refresh can take the row off a filtered list.
 */
export const COMPLETION_SETTLE_MS = 600

const COMPLETION_REASONS = new Set(['state-mutated', 'complete', 'reopen'])

/** Only completions or reopens of known tasks: the rows on screen already show the new state. */
export const isCompletionOnly = ({ tasks, schedules }: DataChangeBatch) =>
  tasks.length > 0 &&
  tasks.every(
    (detail) =>
      detail.taskId !== undefined && COMPLETION_REASONS.has(detail.reason ?? ''),
  ) &&
  schedules.every((detail) => detail.reason === 'task-state-mutated')
