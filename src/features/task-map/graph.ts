import type { Task } from '@features/tasks/types/task'

export type GraphSort = 'priority' | 'importance' | 'deadline'
export type TaskReadiness = 'completed' | 'ready' | 'blocked' | 'unknown'
export type GraphNode = {
  id: number
  task: Task
  x: number
  y: number
  width: number
  height: number
  group: number
  rank: number
  completedPredecessors: Task[]
  missingPredecessors: number[]
  unresolvedOrder: boolean
}
export type GraphEdge = { from: number; to: number }
export type GraphGroup = {
  id: number
  title: string
  x: number
  y: number
  width: number
  height: number
  count: number
}
export type TaskGraph = {
  nodes: GraphNode[]
  edges: GraphEdge[]
  groups: GraphGroup[]
  width: number
  height: number
  unresolvedCount: number
  mobile: boolean
}

export const isTaskCompleted = (task: Task) =>
  task.completed ?? task.isCompleted ?? false
export const taskDateKey = (task: Task): string | null => {
  const value = task.dueDate?.date
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
    ? value
    : null
}
const day = (value: string | null) =>
  value ? Date.parse(`${value}T00:00:00Z`) / 86400000 : Infinity

/** Readiness is a server fact. Missing graph vertices must never make a task ready. */
export const taskReadiness = (task: Task): TaskReadiness => {
  if (isTaskCompleted(task)) return 'completed'
  if (
    typeof task.inboundDependencyCount !== 'number' ||
    !Number.isInteger(task.inboundDependencyCount) ||
    task.inboundDependencyCount < 0
  )
    return 'unknown'
  return task.inboundDependencyCount === 0 ? 'ready' : 'blocked'
}

export const matrixQuadrant = (
  task: Task,
  today: string,
  urgentDays = 2,
): number => {
  const important = task.importance >= 7
  const urgent = day(taskDateKey(task)) <= day(today) + Math.max(0, urgentDays)
  return important ? (urgent ? 0 : 1) : urgent ? 2 : 3
}

export const compareGraphTasks =
  (sort: GraphSort, today: string) => (a: Task, b: Task) => {
    const completed = Number(isTaskCompleted(a)) - Number(isTaskCompleted(b))
    if (completed) return completed
    const dueA = day(taskDateKey(a)),
      dueB = day(taskDateKey(b))
    const primary =
      sort === 'importance'
        ? b.importance - a.importance
        : sort === 'deadline'
          ? dueA === dueB
            ? 0
            : dueA - dueB
          : matrixQuadrant(a, today) - matrixQuadrant(b, today)
    return (
      primary ||
      b.importance - a.importance ||
      (dueA === dueB ? 0 : dueA - dueB) ||
      a.id - b.id
    )
  }

/** Weak components keep independent flows separate; Kahn ranks preserve every valid dependency. */
export const buildTaskGraph = (
  records: Task[],
  {
    includeCompleted = false,
    mobile = false,
    sort = 'priority',
    today,
  }: {
    includeCompleted?: boolean
    mobile?: boolean
    sort?: GraphSort
    today: string
  },
): TaskGraph => {
  const all = new Map(records.map((task) => [task.id, task]))
  const tasks = [...all.values()]
    .filter((task) => includeCompleted || !isTaskCompleted(task))
    .sort(compareGraphTasks(sort, today))
  const visible = new Map(tasks.map((task) => [task.id, task]))
  const outgoing = new Map(tasks.map((task) => [task.id, new Set<number>()]))
  const incoming = new Map(tasks.map((task) => [task.id, new Set<number>()]))
  const edges: GraphEdge[] = []
  const connect = (from: number, to: number) => {
    if (!visible.has(from) || !visible.has(to) || outgoing.get(from)!.has(to))
      return
    outgoing.get(from)!.add(to)
    incoming.get(to)!.add(from)
    edges.push({ from, to })
  }
  for (const task of tasks) {
    for (const previous of task.previousTaskIds ?? [])
      connect(previous, task.id)
    for (const next of task.nextTaskIds ?? []) connect(task.id, next)
  }
  const visited = new Set<number>(),
    components: number[][] = [],
    independent: number[] = []
  for (const task of tasks) {
    if (visited.has(task.id)) continue
    if (!outgoing.get(task.id)!.size && !incoming.get(task.id)!.size) {
      visited.add(task.id)
      independent.push(task.id)
      continue
    }
    const members = [task.id]
    visited.add(task.id)
    for (let i = 0; i < members.length; i++) {
      for (const neighbor of [
        ...outgoing.get(members[i])!,
        ...incoming.get(members[i])!,
      ]) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor)
          members.push(neighbor)
        }
      }
    }
    components.push(members)
  }
  if (independent.length) components.push(independent)
  const nodes: GraphNode[] = [],
    groups: GraphGroup[] = []
  let top = 16,
    unresolvedCount = 0
  for (let group = 0; group < components.length; group++) {
    const members = components[group],
      isIndependent = members === independent
    const degree = new Map(members.map((id) => [id, incoming.get(id)!.size]))
    const ranks = new Map(members.map((id) => [id, 0]))
    const queue = members.filter((id) => degree.get(id) === 0),
      processed = new Set<number>()
    for (let index = 0; index < queue.length; index++) {
      const id = queue[index]
      processed.add(id)
      for (const next of outgoing.get(id)!) {
        ranks.set(next, Math.max(ranks.get(next)!, ranks.get(id)! + 1))
        degree.set(next, degree.get(next)! - 1)
        if (degree.get(next) === 0) queue.push(next)
      }
    }
    const unresolved = members.filter((id) => !processed.has(id))
    unresolvedCount += unresolved.length
    for (const id of unresolved) ranks.set(id, 0)
    const maxRank = Math.max(0, ...ranks.values()),
      width = 248,
      height = 188
    const layers = new Map<number, number[]>()
    for (const id of members) {
      const rank = ranks.get(id)!
      if (!layers.has(rank)) layers.set(rank, [])
      layers.get(rank)!.push(id)
    }
    for (const layer of layers.values())
      layer.sort((a, b) =>
        compareGraphTasks(sort, today)(visible.get(a)!, visible.get(b)!),
      )
    const columns = isIndependent
      ? mobile
        ? 1
        : Math.min(3, members.length)
      : mobile
        ? Math.max(...[...layers.values()].map((layer) => layer.length))
        : maxRank + 1
    const rows = isIndependent
      ? Math.ceil(members.length / columns)
      : mobile
        ? maxRank + 1
        : Math.max(...[...layers.values()].map((layer) => layer.length))
    const groupWidth = 24 + columns * width + (columns - 1) * 48
    const groupHeight = 46 + rows * height + (rows - 1) * 36
    groups.push({
      id: group,
      title: isIndependent ? '독립 작업' : `연결 흐름 ${group + 1}`,
      x: 16,
      y: top,
      width: groupWidth,
      height: groupHeight,
      count: members.length,
    })
    const positions = new Map(members.map((id, index) => [id, index]))
    for (const [rank, layer] of layers) {
      layer.forEach((id, position) => {
        const index = positions.get(id)!
        const column = isIndependent
          ? index % columns
          : mobile
            ? position
            : rank
        const row = isIndependent
          ? Math.floor(index / columns)
          : mobile
            ? rank
            : position
        const task = visible.get(id)!,
          previous = task.previousTaskIds ?? []
        nodes.push({
          id,
          task,
          x: 28 + column * (width + 48),
          y: top + 36 + row * (height + 36),
          width,
          height,
          rank,
          group,
          completedPredecessors: previous.flatMap((id) => {
            const t = all.get(id)
            return t && isTaskCompleted(t) ? [t] : []
          }),
          missingPredecessors: previous.filter((id) => !all.has(id)),
          unresolvedOrder: !processed.has(id),
        })
      })
    }
    top += groupHeight + 24
  }
  return {
    nodes,
    edges,
    groups,
    width: groups.length
      ? Math.max(...groups.map((g) => g.x + g.width)) + 16
      : 400,
    height: Math.max(240, top),
    unresolvedCount,
    mobile,
  }
}

export type GraphView = { x: number; y: number; scale: number }
export const MIN_GRAPH_SCALE = 0.25
export const MAX_GRAPH_SCALE = 1.5
export const fitGraph = (
  bounds: { x?: number; y?: number; width: number; height: number },
  width: number,
  height: number,
): GraphView => {
  const scale = Math.min(
    1,
    Math.max(
      MIN_GRAPH_SCALE,
      Math.min(
        (width - 32) / Math.max(1, bounds.width),
        (height - 32) / Math.max(1, bounds.height),
      ),
    ),
  )
  return {
    scale,
    x: (width - bounds.width * scale) / 2 - (bounds.x ?? 0) * scale,
    y: (height - bounds.height * scale) / 2 - (bounds.y ?? 0) * scale,
  }
}
export const zoomGraph = (
  view: GraphView,
  scale: number,
  point: { x: number; y: number },
): GraphView => {
  const next = Math.min(MAX_GRAPH_SCALE, Math.max(MIN_GRAPH_SCALE, scale))
  const ratio = next / view.scale
  return {
    scale: next,
    x: point.x - (point.x - view.x) * ratio,
    y: point.y - (point.y - view.y) * ratio,
  }
}
