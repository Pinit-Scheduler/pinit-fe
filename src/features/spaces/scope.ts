export type RouteScope = 'selected' | 'all' | 'personal'

const selectedListPaths = ['/app/tasks', '/app/schedules', '/app/task-map']
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
