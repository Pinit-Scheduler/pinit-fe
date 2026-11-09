import { ApiError } from '@shared/api/httpClient'

export const EVENT = 'workspace:edit-conflict'
export function isEditConflict(error: unknown): error is ApiError {
  if (!(error instanceof ApiError) || error.status !== 409) return false
  const data = error.data as {
    code?: string
    errorCode?: string
    type?: string
  } | null
  return /VERSION|OPTIMISTIC|STALE/i.test(
    String(data?.code ?? data?.errorCode ?? data?.type ?? ''),
  )
}
export function reportEditConflict(error: unknown): boolean {
  if (!isEditConflict(error)) return false
  window.dispatchEvent(new Event(EVENT))
  return true
}
