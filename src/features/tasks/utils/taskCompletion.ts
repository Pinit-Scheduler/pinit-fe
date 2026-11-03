import type { Task } from '../types/task'

/** A successful mutation remains successful if the following detail refresh fails. */
export async function saveTaskCompletion(
  task: Task,
  completed: boolean,
  operations: {
    mutate: (id: number) => Promise<unknown>
    refresh: (id: number) => Promise<Task>
    onSaved: (task: Task) => void
  },
): Promise<{ task: Task; refreshError: string | null }> {
  await operations.mutate(task.id)
  const saved = { ...task, completed, isCompleted: completed }
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
