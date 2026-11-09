import { useEffect, useSyncExternalStore } from 'react'
import { buildApiUrl } from '@shared/api/config'
import { httpClient } from '@shared/api/httpClient'
import {
  getMetadata,
  rememberMetadata,
  getResourceRevision,
  type WorkspaceMetadata,
} from '@features/spaces/metadata'
import { getAccessToken } from '@shared/api/authTokens'
import { onDataChanged } from '@shared/utils/events'

export type Category = {
  id: number
  name: string
  builtIn: boolean
  spaceId?: number
}
export type CategoryFilterValue = number | 'none' | 'all'
export type CategorySnapshot = {
  categories: Category[]
  taskAssignments: Record<string, number>
  scheduleAssignments: Record<string, number>
  seriesAssignments?: Record<string, number>
}
const defaults: Category[] = []
const empty = (): CategorySnapshot => ({
  categories: defaults,
  taskAssignments: {},
  scheduleAssignments: {},
  seriesAssignments: {},
})
let state = {
  ...empty(),
  isLoading: true,
  hasLoaded: false,
  error: null as string | null,
}
let actor = '',
  pending: Promise<void> | null = null,
  epoch = 0,
  reloadQueued = false,
  consumers = 0,
  // Nobody listened for changes for a while, so the kept snapshot may be behind the server.
  missedEvents = false
let stopEvents: (() => void) | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((listener) => listener())
export const resetCategories = () => {
  epoch++
  actor = sessionKey()
  pending = null
  reloadQueued = false
  state = { ...empty(), isLoading: true, hasLoaded: false, error: null }
  emit()
}
const invalidate = () => {
  if (pending) reloadQueued = true
  else void reloadCategories().catch(() => {})
}
const subscribeEvents = () => {
  const offData = onDataChanged(invalidate)
  const auth = () => {
    if (actor !== sessionKey()) {
      resetCategories()
      if (sessionKey()) invalidate()
    }
  }
  window.addEventListener('auth:changed', auth)
  window.addEventListener('storage', auth)
  window.addEventListener('focus', invalidate)
  return () => {
    offData()
    window.removeEventListener('auth:changed', auth)
    window.removeEventListener('storage', auth)
    window.removeEventListener('focus', invalidate)
  }
}
const sessionKey = () => {
  try {
    const token = getAccessToken()
    if (!token) return ''
    const payload = JSON.parse(
      atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')),
    ) as { sub?: string; memberId?: string }
    return String(payload.sub ?? payload.memberId ?? token)
  } catch {
    return getAccessToken() ?? ''
  }
}
const url = (suffix = '') => buildApiUrl('/categories' + suffix, 'v2')
// A reload that returns the same content keeps the same objects, so screens that read
// assignments (TaskListPage filters with them) do not re-render or refetch on focus.
function same<T>(previous: T, next: T): T {
  return JSON.stringify(previous) === JSON.stringify(next) ? previous : next
}
export const reloadCategories = (): Promise<void> => {
  const key = sessionKey()
  // A refresh is not a new anonymous category session. Never fetch without a member token.
  if (!key) {
    if (actor) resetCategories()
    return Promise.resolve()
  }
  if (pending && actor === key) return pending
  if (actor !== key) {
    actor = key
    state = { ...empty(), isLoading: true, hasLoaded: false, error: null }
    emit()
  }
  const requestEpoch = epoch
  const request = httpClient<CategorySnapshot & { projects?: Category[] }>(
    buildApiUrl('/projects/snapshot', 'v2'),
  )
    .then((data) => {
      if (actor !== key || epoch !== requestEpoch) return
      const next = {
        ...data,
        categories: same(
          state.categories,
          (data.projects ?? data.categories ?? []).map((project) => ({
            ...project,
            builtIn: false,
          })),
        ),
        taskAssignments: same(state.taskAssignments, data.taskAssignments),
        scheduleAssignments: same(
          state.scheduleAssignments,
          data.scheduleAssignments,
        ),
        seriesAssignments: same(state.seriesAssignments, data.seriesAssignments),
        isLoading: false,
        hasLoaded: true,
        error: null,
      }
      const unchanged =
        state.hasLoaded &&
        !state.isLoading &&
        state.error === null &&
        next.categories === state.categories &&
        next.taskAssignments === state.taskAssignments &&
        next.scheduleAssignments === state.scheduleAssignments &&
        next.seriesAssignments === state.seriesAssignments
      if (unchanged) return
      state = next
      emit()
    })
    .catch((error) => {
      if (actor === key && epoch === requestEpoch) {
        state = {
          ...state,
          isLoading: false,
          error:
            error instanceof Error
              ? error.message
              : '프로젝트를 불러오지 못했어요.',
        }
        emit()
      }
      throw error
    })
    .finally(() => {
      if (pending === request) {
        pending = null
        if (reloadQueued) {
          reloadQueued = false
          void reloadCategories().catch(() => {})
        }
      }
    })
  pending = request
  return request
}
const assign = async (
  kind: 'tasks' | 'schedules',
  id: number,
  categoryId: number | null,
) => {
  const resource = kind === 'tasks' ? 'task' : 'schedule'
  let current = getMetadata(resource, id)
  if (!current) {
    const revision = getResourceRevision()
    const view = await httpClient<WorkspaceMetadata>(
      buildApiUrl(`/workspace/${kind}/${id}`, 'v2'),
    )
    if (!rememberMetadata(resource, id, view, revision))
      throw new Error('업무 접근 권한이 변경됐습니다. 목록에서 다시 확인해 주세요.')
    current = view
  }
  const project = state.categories.find((item) => item.id === categoryId)
  const spaceId = project?.spaceId ?? current.spaceId
  if (current.spaceId === spaceId && current.projectId === categoryId) return
  const revision = getResourceRevision()
  const result = await httpClient<WorkspaceMetadata>(
    buildApiUrl(`/workspace/${kind}/${id}`, 'v2'),
    {
      method: 'PATCH',
      json: {
        expectedVersion: current.version,
        location: { spaceId, projectId: categoryId },
      },
    },
  )
  rememberMetadata(resource, id, result, revision)
  const field = kind === 'tasks' ? 'taskAssignments' : 'scheduleAssignments'
  const next = { ...state[field] }
  if (categoryId === null) delete next[id]
  else next[id] = categoryId
  state = { ...state, [field]: next }
  emit()
}
export const assignSeriesCategory = async (
  id: number,
  categoryId: number | null,
  scope: 'ALL' | 'FOLLOWING' | 'TEMPLATE' = 'TEMPLATE',
  fromDate?: string,
) => {
  const revision = getResourceRevision()
  const current = await httpClient<WorkspaceMetadata>(
    buildApiUrl(`/workspace/recurrences/${id}`, 'v2'),
  )
  const project = state.categories.find((item) => item.id === categoryId)
  const spaceId = project?.spaceId ?? current.spaceId
  const result = await httpClient<WorkspaceMetadata>(
    buildApiUrl(`/workspace/recurrences/${id}`, 'v2'),
    {
      method: 'PATCH',
      json: {
        expectedVersion: current.version,
        recurrence: {
          scope: scope === 'TEMPLATE' ? 'ALL' : scope,
          fromDate,
          changes: {},
        },
        location: { spaceId, projectId: categoryId },
      },
    },
  )
  rememberMetadata('series', id, result, revision)
  if (pending) await pending.catch(() => {})
  // 프로젝트 배정은 이미 저장됐다. 이후 조회 실패는 store.error로 알리고 저장 실패로 바꾸지 않는다.
  await reloadCategories().catch(() => {})
}
export const createCategory = async (name: string) => {
  const requestedBy = sessionKey()
  const category = await httpClient<Category>(url(), {
    method: 'POST',
    json: { name },
  })
  if (actor !== requestedBy || sessionKey() !== requestedBy) return category
  state = { ...state, categories: [...state.categories, category] }
  emit()
  return category
}
export const renameCategory = async (id: number, name: string) => {
  const requestedBy = sessionKey()
  const category = await httpClient<Category>(url('/' + id), {
    method: 'PATCH',
    json: { name },
  })
  if (actor !== requestedBy || sessionKey() !== requestedBy) return
  state = {
    ...state,
    categories: state.categories.map((item) =>
      item.id === id ? category : item,
    ),
  }
  emit()
}
export const deleteCategory = async (id: number) => {
  await httpClient<void>(url('/' + id), { method: 'DELETE' })
  if (pending) await pending.catch(() => {})
  await reloadCategories()
}
export const assignTaskCategory = (id: number, value: number | null) =>
  assign('tasks', id, value)
export const assignScheduleCategory = (id: number, value: number | null) =>
  assign('schedules', id, value)
export function useCategories() {
  const snapshot = useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    () => state,
  )
  const key = sessionKey()
  useEffect(() => {
    if (consumers++ === 0) {
      stopEvents = subscribeEvents()
      // Changes made while no screen listened were missed. Refresh in the background and keep
      // showing the kept snapshot meanwhile, so chips and filters never blank on a page change.
      if (missedEvents && state.hasLoaded && !pending && actor === sessionKey())
        invalidate()
      missedEvents = false
    }
    return () => {
      if (--consumers === 0) {
        // Keep the snapshot for the session (audit B4). Another account never sees it:
        // useCategories hides a snapshot whose actor differs, and reloadCategories replaces it.
        stopEvents?.()
        stopEvents = null
        missedEvents = true
      }
    }
  }, [])
  useEffect(() => {
    if (key && (actor !== key || (state.isLoading && !pending)))
      void reloadCategories().catch(() => {})
  }, [key])
  const visible =
    actor === key
      ? snapshot
      : { ...empty(), isLoading: true, hasLoaded: false, error: null }
  const find = (id?: number) =>
    visible.categories.find((item) => item.id === id) ?? null
  return {
    ...visible,
    reload: reloadCategories,
    taskCategory: (id: number) => find(visible.taskAssignments[id]),
    scheduleCategory: (id: number) => find(visible.scheduleAssignments[id]),
    seriesCategory: (id: number) => find(visible.seriesAssignments?.[id]),
    assignTaskCategory,
    assignScheduleCategory,
    assignSeriesCategory,
  }
}
