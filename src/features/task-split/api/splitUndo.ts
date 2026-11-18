import { buildApiUrl } from '@shared/api/config'
import { httpClient } from '@shared/api/httpClient'
import type { SplitRequestItem } from './splitRequests'

/** 만들기·버리기 되돌리기 API(ADR-0035 §8.2). 본문이 없다. */
export type SplitUndoApplyResult = {
  request: SplitRequestItem
  restoredTaskId: number
  restoredEdgeCount: number
  notRestored: { taskId: number; direction: 'BEFORE' | 'AFTER' }[]
}

export const undoSplitApply = (requestId: number) =>
  httpClient<SplitUndoApplyResult>(buildApiUrl(`/task-splits/${requestId}/undo-apply`, 'v2'), {
    method: 'POST',
  })

export const undoSplitDiscard = (requestId: number) =>
  httpClient<{ request: SplitRequestItem }>(
    buildApiUrl(`/task-splits/${requestId}/undo-discard`, 'v2'),
    { method: 'POST' },
  )
