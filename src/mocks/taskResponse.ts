import type { Task } from '../features/tasks/types/task'
import { effectiveExpectedMinutes } from './planner'

export const formatIsoMinutes = (minutes: number) => {
  const safe = Math.max(0, Math.floor(minutes))
  const h = Math.floor(safe / 60)
  const m = safe % 60
  return `PT${h}H${m}M`
}

/** v2 작업 응답 모양. 기존 `/v2/tasks`와 `/v2/workspace/tasks`가 같은 본문을 쓴다. */
export const toTaskResponse = (task: Task) => ({
  id: task.id,
  title: task.title,
  description: task.description,
  dueDate: task.dueDate,
  importance: task.importance,
  difficulty: task.difficulty,
  expectedDuration:
    task.expectedDuration && task.expectedDuration !== 'PT0S'
      ? task.expectedDuration
      : null,
  effectiveExpectedDuration: formatIsoMinutes(effectiveExpectedMinutes(task)),
  completed: task.completed ?? task.isCompleted ?? false,
  inboundDependencyCount: task.inboundDependencyCount ?? 0,
  previousTaskIds: task.previousTaskIds ?? [],
  nextTaskIds: task.nextTaskIds ?? [],
  ownerId: task.ownerId ?? 1,
  createdAt: task.createdAt ?? new Date().toISOString(),
  updatedAt: task.updatedAt ?? new Date().toISOString(),
  recurrence: task.recurrence ?? null,
  missed: task.missed ?? false,
  tags: task.tags ?? [],
})
