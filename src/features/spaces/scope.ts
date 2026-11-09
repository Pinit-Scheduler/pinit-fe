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

export function createSpaceIdFor(
  search: string,
  defaultSpaceId: number | null,
): number | undefined {
  if (new URLSearchParams(search).get('from') !== 'today') return undefined
  if (defaultSpaceId === null || !Number.isFinite(defaultSpaceId)) {
    return undefined
  }
  return defaultSpaceId === 0 ? undefined : defaultSpaceId
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
