import { useId, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import Modal from './Modal'
import { answerConfirm, currentConfirm, subscribeConfirm } from './confirm'
import './ConfirmDialog.css'

/** 확인 창이 그려지는 자리. 앱 셸에 한 번만 둔다. */
const ConfirmHost = () => {
  const ask = useSyncExternalStore(subscribeConfirm, currentConfirm)
  const titleId = useId()
  const bodyId = useId()
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
