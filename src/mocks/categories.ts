import type { Task } from '../features/tasks/types/task'
import type { ScheduleResponse } from '../features/schedules/types/schedule'
import { mockSchedules, mockTasks } from './db'

type Category = { id: number; name: string; builtIn: boolean }
type Assignment = Record<string, number>
type Scope = 'ALL' | 'FOLLOWING' | 'TEMPLATE'
type TemplateRule = { from: string; categoryId: number | null }
type OwnerCategories = {
  custom: Category[]
  tasks: Assignment
  schedules: Assignment
  series: Assignment
  templates: Map<number, TemplateRule[]>
}
const builtIns: Category[] = [
  '업무·커리어',
  '학습',
  '개인 프로젝트',
  '생활·행정',
  '건강·운동',
  '여가·관계',
].map((name, i) => ({ id: -i - 1, name, builtIn: true }))
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
const failure = (message: string, status = 400) => json({ message }, status)

/** Mock JWTs are deliberately unsigned; real authentication stays in the API server. */
export const mockCategoryOwnerId = (request: Request): number | null => {
  try {
    const token = request.headers
      .get('Authorization')
      ?.replace(/^Bearer\s+/i, '')
    if (!token) return null
    const payload = JSON.parse(
      atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')),
    ) as { sub?: number | string; exp?: number }
    const owner = Number(payload.sub)
    return Number.isInteger(owner) &&
      owner > 0 &&
      (!payload.exp || payload.exp > Date.now() / 1000)
      ? owner
      : null
  } catch {
    return null
  }
}

/** Owner-scoped, in-memory sidecar. Task tags are never read or rewritten. */
export const createCategoryMockRepository = (
  tasks: Task[],
  schedules: ScheduleResponse[],
) => {
  const owners = new Map<number, OwnerCategories>(),
    seriesOwners = new Map<number, number>()
  let sequence = 0
  const state = (owner: number) => {
    if (!owners.has(owner))
      owners.set(owner, {
        custom: [],
        tasks: {},
        schedules: {},
        series: {},
        templates: new Map(),
      })
    return owners.get(owner)!
  }
  const ownerOf = (item: { ownerId?: number }) => item.ownerId ?? 1
  const validCategory = (owner: number, id: unknown): id is number | null =>
    id === null ||
    (typeof id === 'number' &&
      Number.isInteger(id) &&
      [...builtIns, ...state(owner).custom].some(
        (category) => category.id === id,
      ))
  const assign = (
    target: Assignment,
    id: number,
    categoryId: number | null,
  ) => {
    if (categoryId === null) delete target[id]
    else target[id] = categoryId
  }
  const templateCategory = (owner: number, seriesId: number, date: string) => {
    const rules = state(owner).templates.get(seriesId) ?? []
    return (
      rules
        .filter((rule) => rule.from <= date)
        .sort((a, b) => b.from.localeCompare(a.from))[0]?.categoryId ?? null
    )
  }
  const registerSeries = (
    seriesId: number,
    owner: number,
    inheritFrom?: number,
  ) => {
    seriesOwners.set(seriesId, owner)
    if (inheritFrom !== undefined && seriesOwners.get(inheritFrom) === owner) {
      const rules = state(owner).templates.get(inheritFrom)
      if (rules)
        state(owner).templates.set(
          seriesId,
          rules.map((rule) => ({ ...rule })),
        )
      const categoryId = state(owner).series[inheritFrom]
      if (categoryId !== undefined) state(owner).series[seriesId] = categoryId
    }
  }
  const seriesOwner = (seriesId: number) => seriesOwners.get(seriesId)
  const inheritOccurrence = (
    kind: 'task' | 'schedule',
    id: number,
    owner: number,
    seriesId: number,
    date: string,
  ) => {
    if (seriesOwners.get(seriesId) !== owner) return
    assign(
      kind === 'task' ? state(owner).tasks : state(owner).schedules,
      id,
      templateCategory(owner, seriesId, date),
    )
  }
  const inheritTaskSchedule = (taskId: number, scheduleId: number) => {
    const task = tasks.find((item) => item.id === taskId),
      schedule = schedules.find((item) => item.id === scheduleId)
    if (!task || !schedule || ownerOf(task) !== ownerOf(schedule)) return
    const owner = ownerOf(task),
      categoryId = state(owner).tasks[taskId] ?? null
    assign(state(owner).schedules, scheduleId, categoryId)
  }
  const ownedAssignments = (
    owner: number,
    source: Assignment,
    items: { id: number; ownerId?: number }[],
  ) => {
    const result: Assignment = {}
    for (const item of items)
      if (ownerOf(item) === owner && source[item.id] !== undefined)
        result[item.id] = source[item.id]
    return result
  }
  const snapshot = (owner: number) => ({
    categories: [...builtIns, ...state(owner).custom].map((category) => ({
      ...category,
    })),
    taskAssignments: ownedAssignments(owner, state(owner).tasks, tasks),
    scheduleAssignments: ownedAssignments(
      owner,
      state(owner).schedules,
      schedules,
    ),
    seriesAssignments: Object.fromEntries(
      Object.entries(state(owner).series).filter(
        ([id]) => seriesOwners.get(Number(id)) === owner,
      ),
    ),
  })
  const handle = async (
    path: string,
    method: string,
    request: Request,
  ): Promise<Response | null> => {
    if (!/^\/v2\/categories(?:\/|$)/.test(path)) return null
    const owner = mockCategoryOwnerId(request)
    if (!owner) return failure('로그인이 필요합니다.', 401)
    const current = state(owner)
    if (path === '/v2/categories' && method === 'GET')
      return json(snapshot(owner))
    const body = ['POST', 'PATCH', 'PUT'].includes(method)
      ? ((await request.json().catch(() => null)) as {
          name?: unknown
          categoryId?: unknown
          scope?: unknown
          fromDate?: unknown
        } | null)
      : null
    if (path === '/v2/categories' && method === 'POST') {
      if (
        typeof body?.name !== 'string' ||
        !body.name.trim() ||
        body.name.trim().length > 30
      )
        return failure('프로젝트 이름은 1–30자로 입력해 주세요.')
      const name = body.name.trim()
      if (
        [...builtIns, ...current.custom].some(
          (category) =>
            category.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
        )
      )
        return failure('같은 이름의 프로젝트가 있습니다.', 409)
      const category = { id: ++sequence, name, builtIn: false }
      current.custom.push(category)
      return json(category, 201)
    }
    const categoryMatch = path.match(/^\/v2\/categories\/(-?\d+)$/)
    if (categoryMatch) {
      const id = Number(categoryMatch[1]),
        category = current.custom.find((item) => item.id === id)
      if (builtIns.some((item) => item.id === id))
        return failure('기본 프로젝트는 수정하거나 삭제할 수 없습니다.', 409)
      if (!category) return failure('프로젝트를 찾을 수 없습니다.', 404)
      if (method === 'PATCH') {
        if (
          typeof body?.name !== 'string' ||
          !body.name.trim() ||
          body.name.trim().length > 30
        )
          return failure('프로젝트 이름은 1–30자로 입력해 주세요.')
        const name = body.name.trim()
        if (
          [...builtIns, ...current.custom].some(
            (item) =>
              item.id !== id &&
              item.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
          )
        )
          return failure('같은 이름의 프로젝트가 있습니다.', 409)
        category.name = name
        return json(category)
      }
      if (method === 'DELETE') {
        current.custom = current.custom.filter((item) => item.id !== id)
        for (const source of [current.tasks, current.schedules, current.series])
          for (const key of Object.keys(source))
            if (source[key] === id) delete source[key]
        for (const [seriesId, rules] of current.templates)
          current.templates.set(
            seriesId,
            rules.map((rule) =>
              rule.categoryId === id ? { ...rule, categoryId: null } : rule,
            ),
          )
        return new Response(null, { status: 204 })
      }
    }
    const assignment = path.match(
      /^\/v2\/categories\/(tasks|schedules|recurrences)\/(\d+)$/,
    )
    if (assignment && method === 'PUT') {
      const [, kind, rawId] = assignment,
        id = Number(rawId)
      if (
        !body ||
        !Object.hasOwn(body, 'categoryId') ||
        !validCategory(owner, body.categoryId)
      )
        return failure('사용할 수 없는 프로젝트입니다.')
      const categoryId = body.categoryId
      if (kind === 'recurrences') {
        if (seriesOwners.get(id) !== owner)
          return failure('반복을 찾을 수 없습니다.', 404)
        if (!['ALL', 'FOLLOWING', 'TEMPLATE'].includes(String(body.scope)))
          return failure('반복 적용 범위를 선택해 주세요.')
        const scope = body.scope as Scope
        if (
          scope === 'FOLLOWING' &&
          (typeof body.fromDate !== 'string' ||
            !/^\d{4}-\d{2}-\d{2}$/.test(body.fromDate))
        )
          return failure('이번 및 이후에 적용할 기준 날짜가 필요합니다.')
        const from = scope === 'FOLLOWING' ? (body.fromDate as string) : ''
        const rules = current.templates.get(id) ?? []
        current.templates.set(
          id,
          scope === 'ALL' || scope === 'TEMPLATE'
            ? [{ from: '', categoryId }]
            : [
                ...rules.filter((rule) => rule.from < from),
                { from, categoryId },
              ],
        )
        assign(current.series, id, categoryId)
        if (scope !== 'TEMPLATE') {
          for (const [items, target] of [
            [tasks, current.tasks],
            [schedules, current.schedules],
          ] as const)
            for (const item of items) {
              if (
                ownerOf(item) === owner &&
                item.recurrence?.seriesId === id &&
                item.recurrence.occurrenceDate >= from
              )
                assign(target, item.id, categoryId)
            }
        }
      } else {
        const item = (kind === 'tasks' ? tasks : schedules).find(
          (candidate) => candidate.id === id,
        )
        if (!item || ownerOf(item) !== owner)
          return failure('항목을 찾을 수 없습니다.', 404)
        assign(
          kind === 'tasks' ? current.tasks : current.schedules,
          id,
          categoryId,
        )
      }
      return new Response(null, { status: 204 })
    }
    return failure('지원하지 않는 프로젝트 요청입니다.', 405)
  }
  return {
    handle,
    snapshot,
    registerSeries,
    seriesOwner,
    inheritOccurrence,
    inheritTaskSchedule,
  }
}

const repository = createCategoryMockRepository(mockTasks, mockSchedules)
export const handleCategories = repository.handle
export const registerMockCategorySeries = repository.registerSeries
export const mockCategorySeriesOwner = repository.seriesOwner
export const inheritMockOccurrenceCategory = repository.inheritOccurrence
export const inheritMockTaskScheduleCategory = repository.inheritTaskSchedule
