import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { getAccessToken, getTokenSubject } from '@shared/api/authTokens'
import {
  dispatchScheduleChanged,
  dispatchTaskChanged,
} from '@shared/utils/events'
import { clearWorkspaceMetadata, syncAccessibleSpaces } from './metadata'
import { fetchWorkspace } from './api'
import type { WorkspaceSnapshot } from './types'

const empty = (): WorkspaceSnapshot => ({
  memberId: 0,
  nickname: '',
  defaultSpaceId: 0,
  spaces: [],
  projects: [],
  taskAssignments: {},
  scheduleAssignments: {},
})
type State = WorkspaceSnapshot & {
  loading: boolean
  error: string | null
  selectedSpaceId: number | null
  selectedProjectId: number | null
  revision: number
}
let state: State = {
  ...empty(),
  loading: true,
  error: null,
  selectedSpaceId: null,
  selectedProjectId: null,
  revision: 0,
}
let actor: string | null = null
let generation = 0
let pending: Promise<void> | null = null
let invalidated = false
let selectionVersion = 0
// When the last snapshot arrived. Window focus reloads at most once per FOCUS_RELOAD_MS after it.
let loadedAt = 0
export const FOCUS_RELOAD_MS = 15_000
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((listener) => listener())
const subject = () => {
  const token = getAccessToken()
  return token ? getTokenSubject(token) : null
}
const selectionKey = (member: string) => `pinit.space.selection.${member}`
function readSelection(member: string): number | null {
  try {
    const raw = sessionStorage.getItem(selectionKey(member))
    if (raw === null) return null
    const value = Number(raw)
    return Number.isSafeInteger(value) ? value : null
  } catch {
    return null
  }
}
/** Plain-data deep equality for server snapshots (objects, arrays, primitives). */
export function sameData(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null)
    return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) {
    const other = b as unknown[]
    return (
      a.length === other.length &&
      a.every((item, index) => sameData(item, other[index]))
    )
  }
  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  const keys = Object.keys(left)
  return (
    keys.length === Object.keys(right).length &&
    keys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(right, key) &&
        sameData(left[key], right[key]),
    )
  )
}
const workspaceOf = (value: WorkspaceSnapshot): WorkspaceSnapshot => ({
  memberId: value.memberId,
  nickname: value.nickname,
  defaultSpaceId: value.defaultSpaceId,
  spaces: value.spaces,
  projects: value.projects,
  taskAssignments: value.taskAssignments,
  scheduleAssignments: value.scheduleAssignments,
})
export function selectSpace(spaceId: number, projectId: number | null = null) {
  if (actor !== subject()) resetSpaces()
  selectionVersion++
  // Choosing what is already chosen changes nothing: no re-render, no refetch of every list.
  if (
    state.selectedSpaceId === spaceId &&
    state.selectedProjectId === projectId
  )
    return
  // A selection is a local view preference; membership and visible records are server facts.
  state = { ...state, selectedSpaceId: spaceId, selectedProjectId: projectId }
  if (actor) {
    try {
      sessionStorage.setItem(selectionKey(actor), String(spaceId))
    } catch {
      /* optional view preference */
    }
  }
  emit()
  dispatchTaskChanged({ reason: 'space-scope' })
  dispatchScheduleChanged({ reason: 'space-scope' })
}
export function selectProject(projectId: number | null) {
  if (state.selectedProjectId === projectId) return
  state = { ...state, selectedProjectId: projectId }
  emit()
  dispatchTaskChanged({ reason: 'space-scope' })
  dispatchScheduleChanged({ reason: 'space-scope' })
}
export function resetSpaces() {
  generation++
  clearWorkspaceMetadata()
  invalidated = false
  loadedAt = 0
  actor = subject()
  pending = null
  state = {
    ...empty(),
    loading: true,
    error: null,
    selectedSpaceId: actor ? readSelection(actor) : null,
    selectedProjectId: null,
    revision: state.revision + 1,
  }
  emit()
}
export function reloadSpaces(): Promise<void> {
  const nextActor = subject()
  if (!nextActor) {
    if (actor) resetSpaces()
    return Promise.resolve()
  }
  if (actor !== nextActor) resetSpaces()
  if (pending) {
    invalidated = true
    return pending
  }
  const requestGeneration = generation
  const requestedSelectionVersion = selectionVersion
  const request = fetchWorkspace()
    .then((snapshot) => {
      if (actor !== nextActor || generation !== requestGeneration) return
      const selection = snapshot.spaces.some(
        (space) => space.id === state.selectedSpaceId && !space.deleted,
      )
        ? state.selectedSpaceId
        : selectionVersion !== requestedSelectionVersion
          ? state.selectedSpaceId
          : snapshot.defaultSpaceId
      const projectId = snapshot.projects.some(
        (project) =>
          project.id === state.selectedProjectId &&
          project.spaceId === selection &&
          !project.deleted,
      )
        ? state.selectedProjectId
        : null
      const membershipChanged =
        state.spaces
          .filter((space) => !space.deleted)
          .map((space) => space.id)
          .sort((a, b) => a - b)
          .join(',') !==
        snapshot.spaces
          .filter((space) => !space.deleted)
          .map((space) => space.id)
          .sort((a, b) => a - b)
          .join(',')
      const removed = syncAccessibleSpaces(
        snapshot.spaces
          .filter((space) => !space.deleted)
          .map((space) => space.id),
        state.spaces.filter((space) => !space.deleted).map((space) => space.id),
      )
      if (removed.spaceIds.length && typeof window !== 'undefined')
        window.dispatchEvent(
          new CustomEvent('workspace:access-changed', { detail: removed }),
        )
      const changedScope =
        selection !== state.selectedSpaceId ||
        projectId !== state.selectedProjectId
      loadedAt = Date.now()
      // A reload that brings back what is already on screen (focus, a realtime echo) emits
      // nothing, so no consumer re-renders and nothing on screen moves.
      if (
        !changedScope &&
        !state.loading &&
        state.error === null &&
        sameData(workspaceOf(state), workspaceOf(snapshot))
      )
        return
      state = {
        ...snapshot,
        loading: false,
        error: null,
        selectedSpaceId: selection,
        selectedProjectId: projectId,
        revision: state.revision + 1,
      }
      emit()
      if (changedScope || membershipChanged) {
        dispatchTaskChanged({ reason: 'space-scope' })
        dispatchScheduleChanged({ reason: 'space-scope' })
      }
    })
    .catch((error) => {
      if (actor === nextActor && generation === requestGeneration) {
        state = {
          ...state,
          loading: false,
          error:
            error instanceof Error
              ? error.message
              : '스페이스를 불러오지 못했어요.',
        }
        emit()
      }
      throw error
    })
    .finally(() => {
      if (pending === request) {
        pending = null
        if (invalidated) {
          invalidated = false
          void reloadSpaces().catch(() => {})
        }
      }
    })
  pending = request
  return request
}
export function useSpaces() {
  const snapshot = useSyncExternalStore(subscribe, getState)
  useEffect(() => {
    if (actor !== subject() || (state.loading && !pending))
      void reloadSpaces().catch(() => {})
  }, [])
  // One object per snapshot, so a parent re-render does not hand consumers a new value.
  return useMemo(() => spacesView(snapshot), [snapshot])
}
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
const getState = () => state
function spacesView(snapshot: State) {
  return {
    ...snapshot,
    selectedSpace:
      snapshot.spaces.find(
        (space) => space.id === snapshot.selectedSpaceId && !space.deleted,
      ) ?? null,
    selectedProject:
      snapshot.projects.find(
        (project) =>
          project.id === snapshot.selectedProjectId && !project.deleted,
      ) ?? null,
    reload: reloadSpaces,
    selectSpace,
    selectProject,
  }
}
export function useWorkspaceEvents() {
  useEffect(() => {
    const invalidate = () => {
      void reloadSpaces().catch(() => {})
    }
    // Focus is a hint, not a change: reload at most once per FOCUS_RELOAD_MS after the last
    // snapshot, unless the last load failed or has not finished.
    const focus = () => {
      if (
        !state.loading &&
        state.error === null &&
        actor === subject() &&
        Date.now() - loadedAt < FOCUS_RELOAD_MS
      )
        return
      invalidate()
    }
    const auth = () => {
      if (actor !== subject()) {
        resetSpaces()
        invalidate()
      }
    }
    window.addEventListener('auth:changed', auth)
    window.addEventListener('storage', auth)
    window.addEventListener('focus', focus)
    return () => {
      window.removeEventListener('auth:changed', auth)
      window.removeEventListener('storage', auth)
      window.removeEventListener('focus', focus)
    }
  }, [])
}
export function workspaceChanged() {
  void reloadSpaces().catch(() => {})
  dispatchTaskChanged({ reason: 'space' })
  dispatchScheduleChanged({ reason: 'space' })
}

export const getSelectedScope = () => ({
  spaceId: state.selectedSpaceId,
  projectId: state.selectedProjectId,
})

export function useProjectFilter() {
  const { selectedProjectId, selectProject } = useSpaces()
  const [withoutProject, setWithoutProject] = useState(false)
  const value: number | 'all' | 'none' =
    selectedProjectId ?? (withoutProject ? 'none' : 'all')
  const setValue = (next: number | 'all' | 'none') => {
    setWithoutProject(next === 'none')
    selectProject(typeof next === 'number' ? next : null)
  }
  return [value, setValue] as const
}
