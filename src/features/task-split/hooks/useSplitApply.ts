import { useCallback, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useToast } from '@contexts/ToastContext'
import { useTaskCache } from '@contexts/TaskCacheContext'
import { getRequestFailureMessage } from '@shared/api/errorMessage'
import { dispatchTaskChanged } from '@shared/utils/events'
import { selectSpace } from '@features/spaces/store'
import { UNDO_TOAST_MS } from '@features/trash/hooks/useTrashUndo'
import { restoreTaskMessage } from '@features/trash/utils/trashLabels'
import { applySplit } from '../api/splitProposals'
import { undoSplitApply } from '../api/splitUndo'
import { stashDraft, takeDraft } from '../utils/draftStash'
import { replaceCheck } from '../utils/splitDraft'
import { splitProposalPath } from '../utils/splitPaths'
import { madeToast } from '../utils/splitProposalLabels'
import { applyRejectionOf } from '../utils/splitProposalScreen'
import type { SplitProposalState } from './useSplitProposal'

/**
 * 고른 조각을 만든다(ui-design §5.6·§5.7). 만들면 원본의 스페이스로 바꿔 작업 맵으로 가고, 토스트의 되돌리기가
 * 조각을 지우고 원본을 돌려 제안 화면을 고치던 그대로 다시 연다. 거부는 모두 "아무것도 만들어지지 않았다"로 읽히게 하고,
 * 응답이 오지 않았으면 그렇게 말하지 않고 실제 상태를 다시 읽는다.
 */
export const useSplitApply = (requestId: number, proposal: SplitProposalState) => {
  const { addToast } = useToast()
  const { removeTask } = useTaskCache()
  const navigate = useNavigate()
  const [applying, setApplyingState] = useState(false)
  const [adminRefused, setAdminRefused] = useState(false)
  // 두 번 눌러도 한 번만 보낸다. 상태는 다음 렌더에야 보이므로 ref로 막는다.
  const applyingRef = useRef(false)
  const setApplying = useCallback((next: boolean) => {
    applyingRef.current = next
    setApplyingState(next)
  }, [])

  const { draft, busy, setScreen, setDraft, reload, hold } = proposal

  const undo = useCallback(() => {
    void undoSplitApply(requestId)
      .then((undone) => {
        dispatchTaskChanged({ reason: 'split-undone' })
        // 제안 화면이 맡아 둔 조각으로 다시 연다.
        navigate(splitProposalPath(requestId))
        if (undone.notRestored.length > 0)
          addToast(restoreTaskMessage(undone.notRestored.length), 'success')
      })
      .catch((error) => {
        takeDraft(requestId)
        addToast(getRequestFailureMessage(error, '되돌리지 못했어요.'), 'error')
      })
  }, [requestId, addToast, navigate])

  const apply = useCallback(async () => {
    if (applyingRef.current || busy || !draft) return
    setApplying(true)
    // 보낸 조각과 화면의 조각이 갈라지지 않게 만드는 동안 고치기를 잠근다.
    hold(true)
    try {
      const result = await applySplit(requestId, draft.pieces)
      stashDraft(requestId, draft.pieces)
      removeTask(result.trashedTaskId)
      dispatchTaskChanged({ reason: 'split-applied' })
      selectSpace(result.request.spaceId)
      // 제안 화면을 기록에서 바꾼다. 뒤로 가기로 처리된 제안을 열어 맡긴 조각을 써 버리지 않게 한다.
      navigate('/app/task-map', { replace: true })
      addToast(madeToast(result.created.length, result.notInherited.length), 'success', {
        durationMs: UNDO_TOAST_MS,
        action: { label: '되돌리기', onAction: undo },
      })
    } catch (error) {
      const rejection = applyRejectionOf(error)
      if (rejection.kind === 'screen') setScreen(rejection.screen)
      else if (rejection.kind === 'admin-only') setAdminRefused(true)
      else if (rejection.kind === 'problems') setDraft(replaceCheck(draft, rejection.check))
      else if (rejection.kind === 'toast') addToast(rejection.message, 'error')
      else {
        // 만들어졌을 수도 있다. 고치던 조각을 잃지 않게 맡겨 두고 실제 상태를 다시 읽는다.
        addToast(rejection.message, 'error')
        stashDraft(requestId, draft.pieces)
        dispatchTaskChanged({ reason: 'split-apply-unconfirmed' })
        reload()
      }
    } finally {
      hold(false)
      setApplying(false)
    }
  }, [
    requestId, draft, busy, setScreen, setDraft, reload, hold, addToast, removeTask, navigate, undo,
    setApplying,
  ])

  return { applying, adminRefused, apply }
}
