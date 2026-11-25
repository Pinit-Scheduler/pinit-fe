import type { Project, Space } from './types'
import type { RouteScope } from './scope'

export type CardPath = { spaceId: number | null; text: string } | null

/**
 * 일정 카드와 일정 상세가 보이는 자리. 일정은 스페이스에 속하지 않으므로 스스로의 자리는 없다.
 * 작업에 연결된 일정만 그 작업의 자리를 보인다(서버가 작업의 스페이스·프로젝트를 일정에 복사해 둔 값이다).
 */
export function schedulePath(
  scope: RouteScope,
  selection: { spaceId: number | null; projectId: number | null },
  schedule: { taskId?: number | null; spaceId?: number; projectId?: number | null },
  spaces: Pick<Space, 'id' | 'name' | 'personal'>[],
  projects: Pick<Project, 'id' | 'name'>[],
): CardPath {
  if (schedule.taskId == null) return null
  return cardPath(scope, selection, schedule, spaces, projects)
}

export function cardPath(
  scope: RouteScope,
  selection: { spaceId: number | null; projectId: number | null },
  item: { spaceId?: number; projectId?: number | null },
  spaces: Pick<Space, 'id' | 'name' | 'personal'>[],
  projects: Pick<Project, 'id' | 'name'>[],
): CardPath {
  const project =
    item.projectId == null
      ? null
      : (projects.find((entry) => entry.id === item.projectId) ?? null)
  if (scope === 'selected') {
    if (selection.projectId !== null || !project) return null
    return { spaceId: null, text: project.name }
  }
  const space = spaces.find((entry) => entry.id === item.spaceId)
  if (!space) return null
  return {
    spaceId: space.id,
    text: project ? `${space.name} › ${project.name}` : space.name,
  }
}
