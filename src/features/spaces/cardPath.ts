import type { Project, Space } from './types'
import type { RouteScope } from './scope'

export type CardPath = { spaceId: number | null; text: string } | null

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
