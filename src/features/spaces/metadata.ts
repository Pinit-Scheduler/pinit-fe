import type { AllowedActions } from './types'
export type ResourceLocation = { spaceId: number; projectId: number | null }
export type WorkspaceMetadata = ResourceLocation & {
  linkedTaskId?: number | null
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
export type ResourceKind = 'task' | 'schedule' | 'series'
let revision = 0
const invalidated = new Map<string, number>()
const unavailableResources = new Set<string>()
let rejectedResponses = new WeakSet<object>()
const resourceKey = (kind: ResourceKind, id: number) => `${kind}:${id}`
export const getResourceRevision = () => revision
export const isResourceUnavailable = (
  kind: ResourceKind,
  id: number,
  response?: object,
) =>
  unavailableResources.has(resourceKey(kind, id)) ||
  (response !== undefined && rejectedResponses.has(response))
export function rejectResourceResponse(response: object) {
  rejectedResponses.add(response)
}
export function rememberMetadata(
  kind: ResourceKind,
  id: number,
  metadata: WorkspaceMetadata,
  requestRevision = revision,
) {
  const key = resourceKey(kind, id)
  if (
    unavailableSpaces.has(metadata.spaceId) ||
    requestRevision < (invalidated.get(key) ?? 0)
  ) return false
  const registry =
    kind === 'task'
      ? taskMetadata
      : kind === 'schedule'
        ? scheduleMetadata
        : seriesMetadata
  const existing = registry.get(id)
  if (existing && existing.version > metadata.version) return false
  unavailableResources.delete(key)
  registry.set(id, metadata)
  return true
}
/** Invalidate only an identified resource, even when its old space is still accessible. */
export function evictWorkspaceResource(
  kind: ResourceKind, id: number, force = false,
) {
  const key = resourceKey(kind, id)
  if (unavailableResources.has(key) && !force) return false
  const taskIds = kind === 'task' ? [id] : []
  const scheduleIds = kind === 'schedule' ? [id] : []
  if (kind === 'task')
    for (const [scheduleId, metadata] of scheduleMetadata)
      if (metadata.linkedTaskId === id) scheduleIds.push(scheduleId)
  revision++
  const remove = (resourceKind: ResourceKind, resourceId: number) => {
    const resource = resourceKey(resourceKind, resourceId)
    invalidated.set(resource, revision)
    unavailableResources.add(resource)
    const registry = resourceKind === 'task'
      ? taskMetadata
      : resourceKind === 'schedule' ? scheduleMetadata : seriesMetadata
    registry.delete(resourceId)
  }
  for (const taskId of taskIds) remove('task', taskId)
  for (const scheduleId of scheduleIds) remove('schedule', scheduleId)
  if (kind === 'series') remove(kind, id)
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('workspace:resources-evicted', { detail: { taskIds, scheduleIds } }),
    )
    if (taskIds.length) window.dispatchEvent(
      new CustomEvent('task:changed', { detail: { reason: 'resource-unavailable' } }),
    )
    if (scheduleIds.length) window.dispatchEvent(
      new CustomEvent('schedule:changed', { detail: { reason: 'resource-unavailable' } }),
    )
  }
  return true
}
/** Only authoritative read failures revoke access; network and server outages retain caches. */
export function handleResourceReadError(
  kind: ResourceKind,
  id: number,
  error: unknown,
  requestRevision: number,
) {
  if (requestRevision < (invalidated.get(resourceKey(kind, id)) ?? 0)) return
  const status =
    typeof error === 'object' && error !== null && 'status' in error
      ? error.status : undefined
  if (status === 403 || status === 404 || status === 410)
    evictWorkspaceResource(kind, id)
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
  invalidated.clear()
  unavailableResources.clear()
  rejectedResponses = new WeakSet<object>()
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
