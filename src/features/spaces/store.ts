import { useEffect, useState, useSyncExternalStore } from 'react'
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
export function selectSpace(spaceId: number, projectId: number | null = null) {
  if (actor !== subject()) resetSpaces()
  selectionVersion++
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
  state = { ...state, selectedProjectId: projectId }
  emit()
  dispatchTaskChanged({ reason: 'space-scope' })
  dispatchScheduleChanged({ reason: 'space-scope' })
}
export function resetSpaces() {
  generation++
  clearWorkspaceMetadata()
  invalidated = false
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
              : '공간을 불러오지 못했어요.',
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
  const snapshot = useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => state,
  )
  useEffect(() => {
    if (actor !== subject() || (state.loading && !pending))
      void reloadSpaces().catch(() => {})
  }, [])
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
    const auth = () => {
      if (actor !== subject()) {
        resetSpaces()
        invalidate()
      }
    }
    window.addEventListener('auth:changed', auth)
    window.addEventListener('storage', auth)
    window.addEventListener('focus', invalidate)
    return () => {
      window.removeEventListener('auth:changed', auth)
      window.removeEventListener('storage', auth)
      window.removeEventListener('focus', invalidate)
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
