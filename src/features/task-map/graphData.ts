import type {
  Task,
  TaskArchiveCursorResponse,
  TaskListResponse,
} from '@features/tasks/types/task'

export type TaskGraphSource = {
  openPage: (page: number, signal: AbortSignal) => Promise<TaskListResponse>
  completedPage: (
    cursor: string | null,
    signal: AbortSignal,
  ) => Promise<TaskArchiveCursorResponse>
  detail: (id: number, signal: AbortSignal) => Promise<Task>
}
export type TaskGraphData = {
  tasks: Task[]
  unavailableIds: number[]
  primaryCount: number
}

/** Collect every page independently of list-view state, then resolve external predecessors.
 * A failed page rejects the snapshot; an inaccessible predecessor is explicitly retained as unknown.
 */
export const collectTaskGraph = async (
  source: TaskGraphSource,
  includeCompleted: boolean,
  signal: AbortSignal,
  onProgress: (count: number) => void = () => {},
): Promise<TaskGraphData> => {
  const records = new Map<number, Task>()
  const add = (tasks: Task[]) => {
    for (const task of tasks) records.set(task.id, task)
    onProgress(records.size)
  }
  for (let page = 0; ; page++) {
    signal.throwIfAborted()
    const result = await source.openPage(page, signal),
      prior = records.size
    add(result.content)
    const last =
      result.last ??
      (result.totalPages != null
        ? page + 1 >= result.totalPages
        : result.content.length < (result.size ?? 100))
    if (last) break
    if (!result.content.length || records.size === prior || page >= 999)
      throw new Error(
        '작업 목록의 다음 페이지를 확인할 수 없습니다. 새로고침해 주세요.',
      )
  }
  if (includeCompleted) {
    let cursor: string | null = null
    const cursors = new Set<string>()
    for (let page = 0; ; page++) {
      signal.throwIfAborted()
      const result = await source.completedPage(cursor, signal),
        prior = records.size
      add(result.items)
      const hasNext = result.hasNext ?? Boolean(result.nextCursor)
      if (!hasNext) break
      if (!result.items.length || records.size === prior)
        throw new Error(
          '완료 작업의 다음 페이지를 확인할 수 없습니다. 새로고침해 주세요.',
        )
      if (!result.nextCursor || cursors.has(result.nextCursor) || page >= 999)
        throw new Error(
          '완료 작업의 다음 페이지를 확인할 수 없습니다. 새로고침해 주세요.',
        )
      cursor = result.nextCursor
      cursors.add(cursor)
    }
  }
  const primaryCount = records.size,
    attempted = new Set(records.keys()),
    unavailableIds: number[] = []
  const pending = [
    ...new Set(
      [...records.values()].flatMap((task) => task.previousTaskIds ?? []),
    ),
  ].filter((id) => !attempted.has(id))
  while (pending.length) {
    signal.throwIfAborted()
    if (attempted.size + pending.length > 100000)
      throw new Error(
        '작업 연결이 너무 많아 전체 지도를 확인할 수 없습니다. 잠시 뒤 다시 시도해 주세요.',
      )
    const batch = pending.splice(0, 6)
    batch.forEach((id) => attempted.add(id))
    const details = await Promise.all(
      batch.map(async (id) => {
        try {
          return await source.detail(id, signal)
        } catch (error) {
          if (
            signal.aborted ||
            (error instanceof Error && error.name === 'AbortError')
          )
            throw error
          unavailableIds.push(id)
          return null
        }
      }),
    )
    for (const detail of details) {
      if (!detail) continue
      add([detail])
      for (const id of detail.previousTaskIds ?? [])
        if (!attempted.has(id) && !pending.includes(id)) pending.push(id)
    }
  }
  signal.throwIfAborted()
  return { tasks: [...records.values()], unavailableIds, primaryCount }
}
