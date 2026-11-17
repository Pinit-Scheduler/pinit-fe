import { useCallback } from 'react'
import { useToast } from '@contexts/ToastContext'
import { getRequestFailureMessage } from '@shared/api/errorMessage'
import { askConfirm } from '@shared/components/common/confirm'
import { dispatchTaskChanged } from '@shared/utils/events'
import { UNDO_TOAST_MS } from '@features/trash/hooks/useTrashUndo'
import { cancelSplitRequest, discardSplitRequest, fetchSplitInbox } from '../api/splitRequests'
import { splitErrorOf } from '../api/splitErrors'
import { undoSplitDiscard } from '../api/splitUndo'
import {
  CANCEL_CONFIRM,
  CANCELLED_TOAST,
  DISCARDED_TOAST,
  discardConfirm,
} from '../utils/splitLabels'

export type DiscardTarget = {
  requestId: number
  status?: 'READY' | 'FAILED'
  violationRemaining?: boolean | null
}

/** 작업 상세는 요청 ID만 안다. 보관함에서 그 요청을 찾아 위반이 남았는지 본다. 찾지 못하거나 읽지 못하면 false. */
const lookUpViolation = async (requestId: number) => {
  try {
    const inbox = await fetchSplitInbox()
    return inbox.items.find((item) => item.requestId === requestId)?.violationRemaining === true
  } catch {
    return false
  }
}

/** 쪼개기 요청의 취소·버리기. 성공하면 작업 변경 이벤트를 보내 화면이 다시 읽게 한다. */
export const useSplitCommands = () => {
  const { addToast } = useToast()

  const fail = useCallback(
    (error: unknown, fallback: string) => {
      console.error(fallback, error)
      addToast(getRequestFailureMessage(error, fallback), 'error')
      // 쪼개기 오류는 그사이 요청 상태가 바뀌었다는 뜻이다. 화면이 바뀐 상태를 다시 읽게 한다.
      if (splitErrorOf(error)) dispatchTaskChanged({ reason: 'split' })
      return false
    },
    [addToast],
  )

  /** 확인 창 → 취소. 취소했으면 true. */
  const cancel = useCallback(
    async (requestId: number) => {
      if (!(await askConfirm(CANCEL_CONFIRM))) return false
      try {
        const result = await cancelSplitRequest(requestId)
        addToast(CANCELLED_TOAST, 'success')
        dispatchTaskChanged({ taskId: result.request.taskId, reason: 'split' })
        return true
      } catch (error) {
        return fail(error, '요청을 취소하지 못했어요.')
      }
    },
    [addToast, fail],
  )

  /** 준비된 제안은 확인 창 → 버리기, 실패 항목은 바로 버리기. 버렸으면 true. */
  const discard = useCallback(
    async (target: DiscardTarget, options?: { onUndone?: () => void }) => {
      const confirmed = target.status !== 'FAILED'
      if (confirmed) {
        const violationRemaining =
          target.violationRemaining === undefined
            ? await lookUpViolation(target.requestId)
            : target.violationRemaining === true
        if (!(await askConfirm(discardConfirm(violationRemaining)))) return false
      }
      try {
        const result = await discardSplitRequest(target.requestId)
        dispatchTaskChanged({ taskId: result.request.taskId, reason: 'split' })
        if (confirmed) {
          if (result.undoable) {
            addToast(DISCARDED_TOAST, 'success', {
              durationMs: UNDO_TOAST_MS,
              action: {
                label: '되돌리기',
                onAction: () => {
                  void undoSplitDiscard(target.requestId)
                    .then((undone) => {
                      dispatchTaskChanged({ taskId: undone.request.taskId, reason: 'split' })
                      options?.onUndone?.()
                    })
                    .catch((error) => void fail(error, '되돌리지 못했어요.'))
                },
              },
            })
          } else addToast(DISCARDED_TOAST, 'success')
        }
        return true
      } catch (error) {
        return fail(error, '제안을 버리지 못했어요.')
      }
    },
    [addToast, fail],
  )

  return { cancel, discard }
}
