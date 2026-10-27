import { deleteRecurrence, updateRecurrence } from '../api/recurrences'
import type { RecurrenceChanges, RecurrenceRef, RecurrenceScope } from '../types/recurrence'
import { deleteImpactMessage, editImpactMessage } from './recurrenceRules'

/**
 * "이번 및 이후"·"전체" 삭제: dry-run으로 지울 회차 수를 보여 주고, 확인하면 지운다(ADR-0019 §7·§14).
 * @returns 지웠으면 true, 사용자가 그만두면 false
 */
export const confirmAndDeleteSeries = async (ref: RecurrenceRef, scope: RecurrenceScope): Promise<boolean> => {
  const fromDate = scope === 'FOLLOWING' ? ref.occurrenceDate : undefined
  const preview = await deleteRecurrence(ref.seriesId, scope, fromDate, true)
  if (!window.confirm(`${deleteImpactMessage(preview.impact)}\n계속할까요?`)) return false
  await deleteRecurrence(ref.seriesId, scope, fromDate, false)
  return true
}

/**
 * "이번 및 이후"·"전체" 수정: dry-run 결과(하나씩 고친 회차가 덮어써지는 수 포함)를 보여 주고, 확인하면 바꾼다(ADR-0019 §6·§14).
 * @returns 바꿨으면 'updated', 바꿀 값이 없으면 'unchanged', 사용자가 그만두면 'cancelled'
 */
export const confirmAndUpdateSeries = async (
  ref: RecurrenceRef,
  scope: RecurrenceScope,
  changes: RecurrenceChanges,
): Promise<'updated' | 'unchanged' | 'cancelled'> => {
  if (Object.keys(changes).length === 0) return 'unchanged'
  const payload = { scope, ...(scope === 'FOLLOWING' ? { fromDate: ref.occurrenceDate } : {}), changes }
  const preview = await updateRecurrence(ref.seriesId, payload, true)
  const message = editImpactMessage(preview.impact) ?? '지금 있는 회차는 바뀌지 않고, 앞으로 만들 회차부터 반영돼요.'
  if (!window.confirm(`${message}\n계속할까요?`)) return 'cancelled'
  await updateRecurrence(ref.seriesId, payload, false)
  return 'updated'
}
