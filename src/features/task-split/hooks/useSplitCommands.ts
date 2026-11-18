import { useCallback, useRef, useState } from 'react'
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

/**
 * 쪼개기 요청의 취소·버리기. 성공하면 작업 변경 이벤트를 보내 화면이 다시 읽게 한다.
 * 서버는 이미 끝난 요청에도 200으로 그때의 상태를 답한다. 알림은 응답의 상태가 한 일을 말할 때만 띄운다.
 * 한 요청의 취소·버리기·버리기 되돌리기는 확인 창부터 응답까지 하나씩만 한다(`pending`).
 */
export const useSplitCommands = () => {
  const { addToast } = useToast()
  // 누른 즉시 막아야 해서 ref로 막고, 버튼을 끄도록 상태로도 둔다.
  const pendingRef = useRef(new Set<number>())
  const [pending, setPending] = useState<ReadonlySet<number>>(() => new Set())
  const mark = useCallback((requestId: number, busy: boolean) => {
    if (busy) pendingRef.current.add(requestId)
    else pendingRef.current.delete(requestId)
    setPending(new Set(pendingRef.current))
  }, [])
  /** 이 요청의 일이 진행 중이면 false. 아니면 `run`을 돌리고 그 값을 준다. */
  const exclusive = useCallback(
    async (requestId: number, run: () => Promise<boolean>) => {
      if (pendingRef.current.has(requestId)) return false
      mark(requestId, true)
      try {
        return await run()
      } finally {
        mark(requestId, false)
      }
    },
    [mark],
  )

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

  /** 확인 창 → 취소. 취소됐으면 true. 이미 끝난 요청이었으면 알리지 않고 다시 읽게 한 뒤 false. */
  const cancel = useCallback(
    (requestId: number) =>
      exclusive(requestId, async () => {
        if (!(await askConfirm(CANCEL_CONFIRM))) return false
        try {
          const result = await cancelSplitRequest(requestId)
          dispatchTaskChanged({ taskId: result.request.taskId, reason: 'split' })
          if (result.request.status !== 'CANCELLED') return false
          addToast(CANCELLED_TOAST, 'success')
          return true
        } catch (error) {
          return fail(error, '요청을 취소하지 못했어요.')
        }
      }),
    [addToast, exclusive, fail],
  )

  /**
   * 준비된 제안은 확인 창 → 버리기, 실패 항목은 바로 버리기. 버렸거나 그사이 만료로 끝났으면 true.
   * 이미 다른 상태로 끝난 요청이었으면 알리지 않고 다시 읽게 하고 `onUnchanged`를 부른 뒤 false.
   * `onStart`는 이 요청의 다른 일이 진행 중이 아니어서 이 호출을 받아들였을 때만, 확인 창보다 먼저 불린다.
   * 진행 중이라 막힌 호출(false)은 `onStart`를 부르지 않는다.
   */
  const discard = useCallback(
    (
      target: DiscardTarget,
      options?: { onStart?: () => void; onUndone?: () => void; onUnchanged?: () => void },
    ) =>
      exclusive(target.requestId, async () => {
        options?.onStart?.()
        const confirmed = target.status !== 'FAILED'
        if (confirmed) {
          const violationRemaining =
            target.violationRemaining === undefined
              ? await lookUpViolation(target.requestId)
              : target.violationRemaining === true
          if (!(await askConfirm(discardConfirm(violationRemaining)))) return false
        }
        let result
        try {
          result = await discardSplitRequest(target.requestId)
        } catch (error) {
          return fail(error, '제안을 버리지 못했어요.')
        }
        dispatchTaskChanged({ taskId: result.request.taskId, reason: 'split' })
        const { status } = result.request
        if (status === 'EXPIRED') return true
        if (status !== 'DISCARDED') {
          options?.onUnchanged?.()
          return false
        }
        if (!confirmed) return true
        if (result.undoable) {
          addToast(DISCARDED_TOAST, 'success', {
            durationMs: UNDO_TOAST_MS,
            action: {
              label: '되돌리기',
              onAction: () => {
                void exclusive(target.requestId, () =>
                  undoSplitDiscard(target.requestId)
                    .then((undone) => {
                      dispatchTaskChanged({ taskId: undone.request.taskId, reason: 'split' })
                      options?.onUndone?.()
                      return true
                    })
                    .catch((error) => fail(error, '되돌리지 못했어요.')),
                )
              },
            },
          })
        } else addToast(DISCARDED_TOAST, 'success')
        return true
      }),
    [addToast, exclusive, fail],
  )

  return { cancel, discard, pending }
}
