import { getRequestFailureMessage } from '@shared/api/errorMessage'
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
/** 편집 화면 밖(목록·카드·배정)의 409 안내. 화면은 최신 내용을 다시 받고, 자동으로 다시 보내지 않는다. */
export const CONFLICT_RELOADED =
  '다른 참여자가 먼저 수정했어요. 최신 내용을 다시 불러왔으니 확인한 뒤 다시 해 주세요.'
/** 충돌 뒤 최신 내용 조회가 실패한 이유. 화면에 그대로 보인다. */
export function latestLoadError(error: unknown, noun: '작업' | '일정'): string {
  return getRequestFailureMessage(error, `최신 ${noun} 내용을 불러오지 못했어요.`)
}
export function reportEditConflict(error: unknown): boolean {
  if (!isEditConflict(error)) return false
  window.dispatchEvent(new Event(EVENT))
  return true
}
