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

/**
 * A refresh re-reads the pages on screen. "More" may land while it runs, so pages added meanwhile
 * are read too and the refresh does not take the rows it just added off the screen again.
 */
export async function readShownPages<T>(
  read: (page: number) => Promise<T>,
  shown: () => number,
  isLast: (response: T, page: number) => boolean,
): Promise<T[]> {
  const responses = await Promise.all(
    Array.from({ length: shown() }, (_, page) => read(page)),
  )
  while (
    responses.length < shown() &&
    !isLast(responses[responses.length - 1], responses.length - 1)
  )
    responses.push(await read(responses.length))
  return responses
}
