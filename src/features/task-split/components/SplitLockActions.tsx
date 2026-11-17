import WorkspaceIcon from '@shared/components/common/WorkspaceIcon'
import type { SplitLock } from '../api/taskSplitInfo'

type SplitLockActionsProps = {
  lock: SplitLock
  /** 제안 화면이 있으면 "제안 보기"를 둔다. */
  proposalScreen: boolean
  onOpen: () => void
  onCancel: () => void
  onDiscard: () => void
  /** 이 요청의 취소·버리기가 진행 중이면 그 버튼을 끈다. */
  busy?: boolean
}

/** 잠긴 원본의 버튼 줄. 지금 할 수 있는 것만 두고, 꺼진 버튼을 늘어놓지 않는다. 다른 참여자의 요청이면 비운다. */
const SplitLockActions = ({
  lock,
  proposalScreen,
  onOpen,
  onCancel,
  onDiscard,
  busy = false,
}: SplitLockActionsProps) => {
  if (!lock.mine) return null
  if (lock.stage === 'PROCESSING')
    return (
      <button
        type="button"
        disabled={busy}
        onClick={onCancel}
        className="task-detail-modal__action-btn"
      >
        요청 취소
      </button>
    )
  return (
    <>
      {proposalScreen && (
        <button
          type="button"
          onClick={onOpen}
          className="task-detail-modal__action-btn task-detail-modal__action-btn--edit"
        >
          <WorkspaceIcon name="split" /> 제안 보기
        </button>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={onDiscard}
        className="task-detail-modal__action-btn"
      >
        제안 버리기
      </button>
    </>
  )
}

export default SplitLockActions
