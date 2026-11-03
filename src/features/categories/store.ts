import { useEffect, useSyncExternalStore } from 'react'
import { buildApiUrl } from '@shared/api/config'
import { httpClient } from '@shared/api/httpClient'
import { getAccessToken } from '@shared/api/authTokens'
import { onTaskChanged, onScheduleChanged } from '@shared/utils/events'

export type Category = { id: number; name: string; builtIn: boolean }
export type CategoryFilterValue = number | 'none' | 'all'
export type CategorySnapshot = {
  categories: Category[]
  taskAssignments: Record<string, number>
  scheduleAssignments: Record<string, number>
  seriesAssignments?: Record<string, number>
}
const defaults = [
  '업무·커리어',
  '학습',
  '개인 프로젝트',
  '생활·행정',
  '건강·운동',
  '여가·관계',
].map((name, i) => ({ id: -i - 1, name, builtIn: true }))
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
  consumers = 0
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
  const offTask = onTaskChanged(invalidate),
    offSchedule = onScheduleChanged(invalidate)
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
    offTask()
    offSchedule()
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
  const request = httpClient<CategorySnapshot>(url())
    .then((data) => {
      if (actor !== key || epoch !== requestEpoch) return
      state = { ...data, isLoading: false, hasLoaded: true, error: null }
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
              : '카테고리를 불러오지 못했어요.',
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
  const requestedBy = sessionKey()
  await httpClient<void>(url('/' + kind + '/' + id), {
    method: 'PUT',
    json: { categoryId },
  })
  if (actor !== requestedBy || sessionKey() !== requestedBy) return
  const field = kind === 'tasks' ? 'taskAssignments' : 'scheduleAssignments',
    next = { ...state[field] }
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
  await httpClient<void>(url('/recurrences/' + id), {
    method: 'PUT',
    json: { categoryId, scope, fromDate },
  })
  if (pending) await pending.catch(() => {})
  // 분류 PUT은 이미 저장됐다. 이후 조회 실패는 store.error로 알리고 저장 실패로 바꾸지 않는다.
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
    if (consumers++ === 0) stopEvents = subscribeEvents()
    return () => {
      if (--consumers === 0) {
        stopEvents?.()
        stopEvents = null
        resetCategories()
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
