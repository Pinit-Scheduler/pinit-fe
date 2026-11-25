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

type CreateWorkspace = {
  defaultSpaceId: number | null
  selectedSpaceId: number | null
  selectedProjectId: number | null
  projects: {
    id: number
    spaceId: number
    completed: boolean
    deleted?: boolean
  }[]
}

/**
 * Where a new task starts, from the screen the create form was opened over.
 * - Today (its buttons, or `?from=today`): the personal space, as before.
 * - A list that shows the selected space (tasks, map, plan, recurrences):
 *   the selected space and, when one is chosen, its project.
 *   A completed or deleted project, or one from another space, is not a default.
 * - Anywhere else, or no screen behind the form: nothing, so the form falls back
 *   to the selected space and no project.
 * The person can change all of it in the form.
 */
function taskAffiliationFor(
  from: { pathname: string } | null | undefined,
  search: string,
  workspace: CreateWorkspace,
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

/**
 * Where a new task or schedule starts.
 * - A task follows the screen behind the form (see `taskAffiliationFor`).
 * - A schedule is personal: it always starts in the personal space, whichever space is
 *   selected and whatever screen is behind the form. A project is kept only when the
 *   selected space is the personal one. Until the personal space is known nothing is
 *   named, and the form waits for it instead of falling back to the selected space.
 */
export function createAffiliationFor(
  from: { pathname: string } | null | undefined,
  search: string,
  workspace: CreateWorkspace,
  kind: 'task' | 'schedule' = 'task',
): CreateAffiliation {
  const preferred = taskAffiliationFor(from, search, workspace)
  if (kind === 'task') return preferred
  const personal = personalSpaceId(workspace.defaultSpaceId)
  if (personal === undefined) return {}
  return preferred.spaceId === personal ? preferred : { spaceId: personal }
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
 * 일정 화면이 보여 주는 내 일정. 일정은 개인 단위로 본다.
 * - 내가 담당인 일정.
 * - 담당자가 없는 일정은, 다른 참여자가 있는 팀 스페이스의 것이 아니면 내 것으로 본다
 *   (나의 스페이스, 나만 있는 스페이스, 스페이스를 아직 모르는 일정). 그 일정을 볼 사람이 나뿐이다.
 * 다른 사람이 담당인 일정과, 다른 참여자가 있는 팀 스페이스의 담당자 없는 일정은 내 일정이 아니다.
 * 회원을 아직 모르면(불러오는 중의 0) 아무것도 내 일정으로 보지 않는다.
 */
export function ownSchedules<
  T extends { assigneeId?: number | null; spaceId?: number },
>(
  schedules: T[],
  memberId: number,
  spaces: { id: number; personal: boolean; members: unknown[] }[],
): T[] {
  if (!memberId) return []
  const shared = new Set(
    spaces
      .filter((space) => !space.personal && space.members.length >= 2)
      .map((space) => space.id),
  )
  return schedules.filter((schedule) =>
    schedule.assigneeId == null
      ? schedule.spaceId === undefined || !shared.has(schedule.spaceId)
      : schedule.assigneeId === memberId,
  )
}

export function sheetProjects<
  T extends { spaceId: number; deleted?: boolean },
>(projects: T[], spaceId: number | null): T[] {
  if (spaceId === null) return []
  return projects.filter(
    (project) => project.spaceId === spaceId && !project.deleted,
  )
}
