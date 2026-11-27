export type RouteScope = 'selected' | 'all' | 'personal'

// 일정(`/app/schedules`)은 여기에 없다. 오늘·마인드맵·통계처럼 스페이스를 고르지 않는 내 화면이고
// 모든 스페이스의 일정을 보여 준다.
const selectedListPaths = [
  '/app/tasks',
  '/app/task-map',
  '/app/plan',
  '/app/settings/recurrences',
]
const personalListPaths = ['/app/deadline-risk']
const spaceFreePaths = ['/app/mind-map', '/app/schedules']

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

/**
 * 스페이스와 상관없는 내 화면인지. 마인드맵과 일정은 개인 것이고 어느 스페이스에도 속하지 않는다.
 * 이런 화면에는 범위 표시("모든 스페이스", 고른 스페이스의 목적·프로젝트)를 두지 않는다.
 */
export function isSpaceFreeScreen(pathname: string): boolean {
  return spaceFreePaths.includes(listPath(pathname))
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
 * Where a new task starts, from the screen the create form was opened over.
 * (A schedule is personal and belongs to no space, so its form does not ask.)
 * - Today (its buttons, or `?from=today`): the personal space, as before.
 * - A list that shows the selected space (tasks, map, plan, recurrences):
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

/**
 * 상단 경로에 보일 범위 이름. 스페이스와 상관없는 내 화면(마인드맵, 일정)에는 없다(`null`).
 * 나의 스페이스만 보는 화면은 나의 스페이스를, 그 밖은 고른 스페이스·프로젝트나 "모든 스페이스"를 말한다.
 */
export function scopeLabelFor(
  pathname: string,
  personalSpace: { name: string; personal: boolean } | null,
  selectedSpace: { name: string; personal: boolean } | null,
  selectedProject: { name: string } | null,
): string | null {
  if (isSpaceFreeScreen(pathname)) return null
  const scope = routeScope(pathname)
  return scopeCrumb(
    scope,
    scope === 'personal' ? personalSpace : selectedSpace,
    selectedProject,
  )
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

/**
 * 일정 조회 캐시 key에서 요청이 읽는 스페이스 범위를 가리키는 부분. 모든 스페이스를 읽는 요청은
 * 고른 스페이스·프로젝트를 보내지 않으므로 선택이 바뀌어도 같은 key다. 그래서 화면의 목록이 그대로 남는다
 * (선택이 바뀔 때 나는 `schedule:changed`에는 같은 key로 백그라운드에서 다시 받는다).
 */
export function scheduleScopeKey(
  allSpaces: boolean,
  selectedSpaceId: number | null,
  selectedProjectId: number | null,
): string {
  return allSpaces
    ? 'every-space'
    : `${selectedSpaceId ?? 'all'}/${selectedProjectId ?? 'all'}`
}

/**
 * 고른 스페이스가 나의 스페이스가 아닌지. 새 일정·반복 일정은 늘 나의 스페이스에 생기므로, 고른 스페이스만
 * 보여 주는 화면(반복 관리)이 "여기에 모인다"고 말해도 되는지를 가린다.
 * 아직 모르는 동안(불러오는 중의 나의 스페이스 0, 고른 스페이스 없음)에는 아니라고 답해 평소 문구를 둔다.
 */
export function outsidePersonalSpace(
  defaultSpaceId: number | null,
  selectedSpaceId: number | null,
): boolean {
  const personal = personalSpaceId(defaultSpaceId)
  return (
    personal !== undefined &&
    selectedSpaceId !== null &&
    selectedSpaceId !== personal
  )
}

/**
 * 일정 화면이 보여 주는 내 일정: 내가 주인(`ownerId`)인 일정. 일정은 개인 것이고 주인만 읽는다(BE ADR-0037).
 * 서버도 내 일정만 돌려주지만 받은 응답을 그릴 때 한 번 더 거른다(mock API는 아직 볼 수 있는 스페이스의 일정을 모두 준다).
 * 회원을 아직 모르면(불러오는 중의 0) 아무것도 내 일정으로 보지 않는다.
 */
export function ownSchedules<T extends { ownerId: number }>(
  schedules: T[],
  memberId: number,
): T[] {
  if (!memberId) return []
  return schedules.filter((schedule) => schedule.ownerId === memberId)
}

export function sheetProjects<
  T extends { spaceId: number; deleted?: boolean },
>(projects: T[], spaceId: number | null): T[] {
  if (spaceId === null) return []
  return projects.filter(
    (project) => project.spaceId === spaceId && !project.deleted,
  )
}
