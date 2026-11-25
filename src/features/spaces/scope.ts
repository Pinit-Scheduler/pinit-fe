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

/** 모든 스페이스를 보여 주는 내 화면 가운데, 여기서 만든 것이 나의 스페이스에서 시작하는 화면. */
const personalCreatePaths = ['/app/today', '/app/schedules']

/**
 * Where a new task or schedule starts, from the screen the create form was opened over.
 * - Today (its buttons, or `?from=today`) and the schedule screen: the personal space.
 *   Both show every space, so the space held by the switcher is not what the person is looking at.
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
  const mineScreen =
    new URLSearchParams(search).get('from') === 'today' ||
    (from ? personalCreatePaths.includes(listPath(from.pathname)) : false)
  if (mineScreen) {
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

/**
 * 일정 조회 캐시 key에서 요청이 읽는 스페이스 범위를 가리키는 부분. 모든 스페이스를 읽는 요청은
 * 고른 스페이스·프로젝트를 보내지 않으므로 선택이 바뀌어도 같은 key다.
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

export type ScheduleAudience = 'mine' | 'team'

export function scheduleMineParam(
  personal: boolean,
  audience: ScheduleAudience,
): boolean | undefined {
  return personal ? undefined : audience === 'mine'
}

/**
 * 일정 화면에 내 일정/팀 전체 전환을 둘지. 일정 화면은 모든 스페이스를 보여 주므로, 고른 스페이스가
 * 아니라 내가 참여한 스페이스 가운데 다른 참여자가 있는 팀 스페이스가 하나라도 있는지로 정한다.
 * 휴지통에 있는 스페이스의 일정은 목록에 오지 않으므로 세지 않는다.
 */
export function hasSharedSpace(
  spaces: { personal: boolean; members: unknown[]; deleted?: boolean }[],
): boolean {
  return spaces.some(
    (space) => !space.deleted && !space.personal && space.members.length >= 2,
  )
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
