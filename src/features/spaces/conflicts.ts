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
export type InputRow = { label: string; value: string }
const text = (value: unknown) =>
  Array.isArray(value) ? value.join(', ') : String(value ?? '')
/** labels 순서대로, 서버 값과 달라진 내 입력만 돌려준다. */
export function changedInput(
  before: Record<string, unknown>,
  mine: Record<string, unknown>,
  labels: Record<string, string>,
): InputRow[] {
  return Object.keys(labels)
    .filter((key) => text(before[key]).trim() !== text(mine[key]).trim())
    .map((key) => ({ label: labels[key], value: text(mine[key]) }))
}
export function reportEditConflict(error: unknown): boolean {
  if (!isEditConflict(error)) return false
  window.dispatchEvent(new Event(EVENT))
  return true
}
