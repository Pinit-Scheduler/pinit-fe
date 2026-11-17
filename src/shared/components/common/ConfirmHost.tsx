import { useEffect, useId, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import Modal from './Modal'
import { answerConfirm, currentConfirm, subscribeConfirm } from './confirm'
import './ConfirmDialog.css'

/** 확인 창이 그려지는 자리. 앱 셸에 한 번만 둔다. */
const ConfirmHost = () => {
  const ask = useSyncExternalStore(subscribeConfirm, currentConfirm)
  const titleId = useId()
  const bodyId = useId()
  // 앱 셸이 사라지면(로그아웃, 계정 전환으로 다시 세움) 떠 있던 창은 "아니오"로 끝낸다. 저장소는 모듈에 있어
  // 그대로 두면 다음 로그인 뒤 같은 창이 다시 뜨고, 확인하면 지난 계정의 동작이 실행된다.
  useEffect(() => () => answerConfirm(false), [])
  if (!ask) return null
  return createPortal(
    <Modal
      backdropClassName="confirm-dialog__backdrop"
      className="confirm-dialog"
      labelledBy={titleId}
      describedBy={bodyId}
      onClose={() => answerConfirm(false)}
    >
      <h2 id={titleId}>{ask.title}</h2>
      <p id={bodyId} className="confirm-dialog__lead">
        {ask.body}
      </p>
      <div className="confirm-dialog__actions">
        <button className="workspace-button" onClick={() => answerConfirm(false)}>
          {ask.cancelLabel}
        </button>
        <button
          className="workspace-button workspace-button--primary"
          onClick={() => answerConfirm(true)}
        >
          {ask.confirmLabel}
        </button>
      </div>
    </Modal>,
    document.querySelector('.workspace-theme') ?? document.body,
  )
}

export default ConfirmHost
