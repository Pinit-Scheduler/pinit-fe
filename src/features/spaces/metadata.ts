import type { AllowedActions } from './types'
export type ResourceLocation = { spaceId: number; projectId: number | null }
export type WorkspaceMetadata = ResourceLocation & {
  assigneeId: number | null
  assigneeNickname: string | null
  recurrenceVersion?: number | null
  version: number
  allowedActions: AllowedActions
}
export type WorkspaceTaskView<T> = WorkspaceMetadata & { task: T }
export type WorkspaceScheduleView<T> = WorkspaceMetadata & { schedule: T }
const unavailableSpaces = new Set<number>()
const taskMetadata = new Map<number, WorkspaceMetadata>()
const seriesMetadata = new Map<number, WorkspaceMetadata>()
const scheduleMetadata = new Map<number, WorkspaceMetadata>()
export function rememberMetadata(
  kind: 'task' | 'schedule' | 'series',
  id: number,
  metadata: WorkspaceMetadata,
) {
  if (unavailableSpaces.has(metadata.spaceId)) return
  const registry =
    kind === 'task'
      ? taskMetadata
      : kind === 'schedule'
        ? scheduleMetadata
        : seriesMetadata
  const existing = registry.get(id)
  if (existing && existing.version > metadata.version) return
  registry.set(id, metadata)
}
export function getMetadata(kind: 'task' | 'schedule' | 'series', id: number) {
  return (
    kind === 'task'
      ? taskMetadata
      : kind === 'schedule'
        ? scheduleMetadata
        : seriesMetadata
  ).get(id)
}
export function clearWorkspaceMetadata() {
  unavailableSpaces.clear()
  taskMetadata.clear()
  scheduleMetadata.clear()
  seriesMetadata.clear()
}

export const isSpaceUnavailable = (spaceId?: number) =>
  spaceId !== undefined && unavailableSpaces.has(spaceId)
export function syncAccessibleSpaces(
  activeIds: number[],
  previousIds: number[],
) {
  const active = new Set(activeIds)
  for (const id of active) unavailableSpaces.delete(id)
  const spaceIds = previousIds.filter((id) => !active.has(id))
  const taskIds: number[] = [],
    scheduleIds: number[] = []
  for (const id of spaceIds) unavailableSpaces.add(id)
  for (const [id, metadata] of taskMetadata)
    if (unavailableSpaces.has(metadata.spaceId)) {
      taskIds.push(id)
      taskMetadata.delete(id)
    }
  for (const [id, metadata] of scheduleMetadata)
    if (unavailableSpaces.has(metadata.spaceId)) {
      scheduleIds.push(id)
      scheduleMetadata.delete(id)
    }
  for (const [id, metadata] of seriesMetadata)
    if (unavailableSpaces.has(metadata.spaceId)) seriesMetadata.delete(id)
  return { spaceIds, taskIds, scheduleIds }
}
