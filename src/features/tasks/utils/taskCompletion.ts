import type { Task } from '../types/task'

/** A successful mutation remains successful if the following detail refresh fails. */
export async function saveTaskCompletion(
  task: Task,
  operations: {
    mutate: (id: number, expectedVersion?: number) => Promise<Task>
    refresh: (id: number) => Promise<Task>
    onSaved: (task: Task) => void
  },
): Promise<{ task: Task; refreshError: string | null }> {
  const saved = await operations.mutate(task.id, task.version)
  operations.onSaved(saved)
  try {
    return { task: await operations.refresh(task.id), refreshError: null }
  } catch {
    return {
      task: saved,
      refreshError: '상태는 저장되었지만 최신 정보를 불러오지 못했어요.',
    }
  }
}
