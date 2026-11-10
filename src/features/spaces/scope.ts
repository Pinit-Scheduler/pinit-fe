export type RouteScope = 'selected' | 'all' | 'personal'

const selectedListPaths = [
  '/app/tasks',
  '/app/schedules',
  '/app/task-map',
  '/app/plan',
  '/app/settings/recurrences',
]
const personalListPaths = ['/app/deadline-risk']

function listPath(pathname: string) {
  return pathname.length > 1 && pathname.endsWith('/')
    ? pathname.slice(0, -1)
    : pathname
}

export function routeScope(pathname: string): RouteScope {
  const path = listPath(pathname)
  if (selectedListPaths.includes(path)) return 'selected'
  if (personalListPaths.includes(path)) return 'personal'
  return 'all'
}

export function projectSelectionTarget(pathname: string): string | null {
  return routeScope(pathname) === 'selected' ? null : '/app/tasks'
}

/** 나의 스페이스 id. 아직 모르면(불러오는 중의 0 포함) 없다. */
function personalSpaceId(defaultSpaceId: number | null): number | undefined {
  return defaultSpaceId === null ||
    !Number.isFinite(defaultSpaceId) ||
    defaultSpaceId === 0
    ? undefined
    : defaultSpaceId
}

export type CreateAffiliation = { spaceId?: number; categoryId?: number }

/**
 * Where a new task or schedule starts, from the screen the create form was opened over.
 * - Today (its buttons, or `?from=today`): the personal space, as before.
 * - A list that shows the selected space (tasks, schedules, map, plan, recurrences):
 *   the selected space and, when one is chosen, its project.
 *   A completed or deleted project, or one from another space, is not a default.
 * - Anywhere else, or no screen behind the form: nothing, so the form falls back
 *   to the selected space and no project.
 * The person can change all of it in the form.
 */
export function createAffiliationFor(
  from: { pathname: string } | null | undefined,
  search: string,
  workspace: {
    defaultSpaceId: number | null
    selectedSpaceId: number | null
    selectedProjectId: number | null
    projects: {
      id: number
      spaceId: number
      completed: boolean
      deleted?: boolean
    }[]
  },
): CreateAffiliation {
  const today =
    new URLSearchParams(search).get('from') === 'today' ||
    (from ? listPath(from.pathname) === '/app/today' : false)
  if (today) {
    const spaceId = personalSpaceId(workspace.defaultSpaceId)
    return spaceId === undefined ? {} : { spaceId }
  }
  if (!from || routeScope(from.pathname) !== 'selected') return {}
  const { selectedSpaceId: spaceId, selectedProjectId: projectId } = workspace
  if (spaceId === null || projectId === null) return {}
  const project = workspace.projects.find((item) => item.id === projectId)
  if (
    !project ||
    project.spaceId !== spaceId ||
    project.deleted ||
    project.completed
  )
    return {}
  return { spaceId, categoryId: projectId }
}

export function scopeCrumb(
  scope: RouteScope,
  space: { name: string; personal: boolean } | null,
  project: { name: string } | null,
): string {
  if (scope === 'all') return '모든 스페이스'
  if (scope === 'personal') return space?.name ?? '나의 스페이스'
  if (!space) return '스페이스'
  return project ? `${space.name} › ${project.name}` : space.name
}

export function switcherLabel(
  scope: RouteScope,
  space: { name: string } | null,
  project: { name: string } | null,
  loading: boolean,
): string {
  if (!space) return loading ? '스페이스 불러오는 중' : '스페이스 선택'
  return scope === 'selected' && project
    ? `${space.name} › ${project.name}`
    : space.name
}

export type ScheduleAudience = 'mine' | 'team'

export function scheduleMineParam(
  personal: boolean,
  audience: ScheduleAudience,
): boolean | undefined {
  return personal ? undefined : audience === 'mine'
}

export function audienceFor(
  spaceId: number | null,
  stored: { spaceId: number | null; audience: ScheduleAudience } | null,
): ScheduleAudience {
  return stored && stored.spaceId === spaceId ? stored.audience : 'mine'
}

// Same rule as the server's mine=true: the caller is the assignee.
export function audienceSchedules<T extends { assigneeId?: number | null }>(
  schedules: T[],
  shared: boolean,
  audience: ScheduleAudience,
  memberId: number,
): { visible: T[]; hidden: number } {
  if (!shared || audience === 'team') return { visible: schedules, hidden: 0 }
  const visible = schedules.filter((item) => item.assigneeId === memberId)
  return { visible, hidden: schedules.length - visible.length }
}

export function sheetProjects<
  T extends { spaceId: number; deleted?: boolean },
>(projects: T[], spaceId: number | null): T[] {
  if (spaceId === null) return []
  return projects.filter(
    (project) => project.spaceId === spaceId && !project.deleted,
  )
}
