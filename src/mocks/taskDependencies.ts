import type { Task, TaskDependency } from '../features/tasks/types/task'

const completed = (task: Task) => task.completed ?? task.isCompleted ?? false
export const recomputeMockTaskReadiness = (tasks: Task[]) => {
  const records = new Map(tasks.map((task) => [task.id, task]))
  for (const task of tasks)
    task.inboundDependencyCount = (task.previousTaskIds ?? []).filter((id) => {
      const previous = records.get(id)
      return !previous || !completed(previous)
    }).length
}

/** Apply bidirectional dependency changes atomically, rejecting cross-owner, missing and cyclic edges. */
export const applyMockTaskDependencies = (
  tasks: Task[],
  taskId: number,
  changes: {
    addDependencies?: TaskDependency[]
    removeDependencies?: TaskDependency[]
  },
): { ok: true } | { ok: false; status: number; message: string } => {
  const task = tasks.find((item) => item.id === taskId)
  if (!task)
    return { ok: false, status: 404, message: '작업을 찾을 수 없습니다.' }
  const owner = task.ownerId ?? 1,
    owned = tasks.filter((item) => (item.ownerId ?? 1) === owner),
    ids = new Set(owned.map((item) => item.id))
  const edges = new Map<string, TaskDependency>()
  const put = (fromId: number, toId: number) =>
    edges.set(`${fromId}:${toId}`, { fromId, toId })
  for (const item of owned) {
    for (const id of item.previousTaskIds ?? [])
      if (ids.has(id)) put(id, item.id)
    for (const id of item.nextTaskIds ?? []) if (ids.has(id)) put(item.id, id)
  }
  for (const field of ['removeDependencies', 'addDependencies'] as const) {
    const list = changes[field]
    if (list === undefined) continue
    if (!Array.isArray(list))
      return {
        ok: false,
        status: 400,
        message: '작업 연결 형식이 올바르지 않습니다.',
      }
    for (const edge of list) {
      if (!edge || typeof edge !== 'object')
        return {
          ok: false,
          status: 400,
          message: '작업 연결 형식이 올바르지 않습니다.',
        }
      const fromId = edge.fromId === 0 ? taskId : edge.fromId,
        toId = edge.toId === 0 ? taskId : edge.toId
      if (
        !Number.isInteger(fromId) ||
        !Number.isInteger(toId) ||
        !ids.has(fromId) ||
        !ids.has(toId) ||
        (fromId !== taskId && toId !== taskId)
      )
        return {
          ok: false,
          status: 400,
          message: '본인의 작업만 연결할 수 있습니다.',
        }
      if (fromId === toId)
        return {
          ok: false,
          status: 409,
          message: '자기 자신을 이전·다음 작업으로 연결할 수 없습니다.',
        }
      if (field === 'removeDependencies') edges.delete(`${fromId}:${toId}`)
      else put(fromId, toId)
    }
  }
  const outgoing = new Map(owned.map((item) => [item.id, [] as number[]])),
    degree = new Map(owned.map((item) => [item.id, 0]))
  for (const { fromId, toId } of edges.values()) {
    outgoing.get(fromId)!.push(toId)
    degree.set(toId, degree.get(toId)! + 1)
  }
  const queue = owned
    .filter((item) => degree.get(item.id) === 0)
    .map((item) => item.id)
  for (let index = 0; index < queue.length; index++)
    for (const next of outgoing.get(queue[index])!) {
      degree.set(next, degree.get(next)! - 1)
      if (degree.get(next) === 0) queue.push(next)
    }
  if (queue.length !== owned.length)
    return {
      ok: false,
      status: 409,
      message: '작업 순서에 순환 연결을 만들 수 없습니다.',
    }
  for (const item of owned) {
    item.previousTaskIds = []
    item.nextTaskIds = []
  }
  const records = new Map(owned.map((item) => [item.id, item]))
  for (const { fromId, toId } of edges.values()) {
    records.get(fromId)!.nextTaskIds!.push(toId)
    records.get(toId)!.previousTaskIds!.push(fromId)
  }
  recomputeMockTaskReadiness(owned)
  return { ok: true }
}
