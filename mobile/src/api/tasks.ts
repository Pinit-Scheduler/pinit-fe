import { apiUrl } from '@/config'
import { api } from './http'
import type { AllowedActions, DateWithOffset, Task, TaskAction, TaskPage } from './types'

// 서버 응답(WorkspaceResourceController.TaskResponse): 작업 본문과 스페이스 정보가 나란히 온다.
type TaskView = {
  task: {
    id: number
    title: string
    description?: string | null
    dueDate: DateWithOffset
    importance: number
    difficulty: number
    effectiveExpectedDuration?: string | null
    completed?: boolean | null
    isCompleted?: boolean | null
    inboundDependencyCount?: number | null
    recurrence?: unknown
  }
  spaceId: number
  projectId: number | null
  assigneeId: number | null
  assigneeNickname: string | null
  version: number
  allowedActions?: AllowedActions | null
}

type PageResponse = { content?: TaskView[]; last?: boolean }

const url = (path = '') => apiUrl('/workspace/tasks' + path)

const normalize = ({ task, ...metadata }: TaskView): Task => ({
  id: task.id,
  title: task.title,
  description: task.description ?? '',
  dueDate: task.dueDate,
  importance: task.importance,
  difficulty: task.difficulty,
  effectiveExpectedDuration: task.effectiveExpectedDuration ?? null,
  completed: task.completed ?? task.isCompleted ?? false,
  inboundDependencyCount: task.inboundDependencyCount ?? 0,
  recurring: task.recurrence != null,
  spaceId: metadata.spaceId,
  projectId: metadata.projectId,
  assigneeId: metadata.assigneeId,
  assigneeNickname: metadata.assigneeNickname,
  version: metadata.version,
  allowedActions: metadata.allowedActions ?? {},
})

const readPage = async (query: URLSearchParams, size: number, signal?: AbortSignal): Promise<TaskPage> => {
  const response = await api<PageResponse>(url(`?${query}`), { signal })
  const items = (response.content ?? []).map(normalize)
  return { items, last: response.last ?? items.length < size }
}

/** 오늘 마감인 내 작업 전부. */
export const fetchMyTasksDueOn = async (dateKey: string, signal?: AbortSignal) => {
  const result: Task[] = []
  for (let page = 0; ; page += 1) {
    const size = 100
    const query = new URLSearchParams({ date: dateKey, mine: 'true', page: String(page), size: String(size) })
    const response = await readPage(query, size, signal)
    result.push(...response.items)
    if (response.last) return result
  }
}

/** 이전 작업이 모두 끝나 바로 시작할 수 있는 내 작업 10개. */
export const fetchMyReadyTasks = async (signal?: AbortSignal) => {
  const size = 10
  const query = new URLSearchParams({ page: '0', size: String(size), readyOnly: 'true', mine: 'true' })
  return (await readPage(query, size, signal)).items
}

/** CURRENT: 진행 중(웹 작업 탭의 기본 필터), COMPLETED: 완료. */
export type TaskListStatus = 'CURRENT' | 'COMPLETED'

export const TASK_PAGE_SIZE = 20

/**
 * 작업 탭 목록의 앞 `pages`쪽. 모든 스페이스에서 내게 배정된 작업을 마감 빠른 순으로 본다.
 * 화면이 다시 받을 때 이미 보던 쪽까지 한 번에 받아, 목록 길이와 스크롤 위치가 유지된다.
 */
export const fetchMyTasks = async (status: TaskListStatus, pages: number, signal?: AbortSignal): Promise<TaskPage> => {
  const items: Task[] = []
  const seen = new Set<number>()
  for (let page = 0; page < pages; page += 1) {
    const query = new URLSearchParams({
      status,
      sort: 'DEADLINE_ASC',
      mine: 'true',
      page: String(page),
      size: String(TASK_PAGE_SIZE),
    })
    const response = await readPage(query, TASK_PAGE_SIZE, signal)
    // 쪽을 받는 사이 목록이 바뀌면 같은 작업이 두 쪽에 걸칠 수 있다.
    for (const task of response.items) {
      if (seen.has(task.id)) continue
      seen.add(task.id)
      items.push(task)
    }
    if (response.last) return { items, last: true }
  }
  return { items, last: false }
}

export const fetchTask = async (id: number, signal?: AbortSignal) =>
  normalize(await api<TaskView>(url(`/${id}`), { signal }))

/** 완료·완료 취소. expectedVersion이 서버 버전과 다르면 409(isEditConflict)다. */
export const changeTaskState = async (id: number, action: TaskAction, expectedVersion: number) =>
  normalize(await api<TaskView>(url(`/${id}/state`), { method: 'POST', json: { expectedVersion, action } }))
