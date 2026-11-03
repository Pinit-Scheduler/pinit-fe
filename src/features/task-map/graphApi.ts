import { fetchTaskDetail, searchTasks } from '@features/tasks/api/tasks'
import type { TaskGraphSource } from './graphData'

/** COMPLETED search includes today's/future completed tasks; the archive cursor alone does not. */
export const taskGraphSource: TaskGraphSource = {
  openPage: (page, signal) =>
    searchTasks({ page, size: 100, params: [['status', 'OPEN']], signal }),
  completedPage: async (cursor, signal) => {
    const page = cursor === null ? 0 : Number(cursor)
    const response = await searchTasks({
      page,
      size: 100,
      params: [['status', 'COMPLETED']],
      signal,
    })
    const last =
      response.last ??
      (response.totalPages != null
        ? page + 1 >= response.totalPages
        : response.content.length < (response.size ?? 100))
    return {
      items: response.content,
      hasNext: !last,
      nextCursor: last ? null : String(page + 1),
    }
  },
  detail: fetchTaskDetail,
}
