import { useId } from 'react'
import { createPortal } from 'react-dom'
import Modal from '@shared/components/common/Modal'
import type { Disclosure } from '../utils/splitLabels'

type SplitConsentDialogProps = {
  disclosure: Disclosure
  /** 동의와 접수를 보내는 중. 두 버튼을 잠근다. */
  busy: boolean
  onAgree: () => void
  onClose: () => void
}

/** 처음 쪼갤 때의 외부 전송 동의 창. 처음의 맡기기 확인을 겸한다. */
const SplitConsentDialog = ({ disclosure, busy, onAgree, onClose }: SplitConsentDialogProps) => {
  const titleId = useId()
  const leadId = useId()
  // 작업 상세(route-surface)는 안쪽을 잘라 낸다. 그 밖에 그려야 창이 잘리지 않는다.
  return createPortal(
    <Modal
      backdropClassName="confirm-dialog__backdrop"
      className="confirm-dialog split-consent"
      labelledBy={titleId}
      describedBy={leadId}
      onClose={busy ? undefined : onClose}
    >
      <h2 id={titleId}>{disclosure.title}</h2>
      <p id={leadId} className="confirm-dialog__lead">
        {disclosure.lead}
      </p>
      <dl className="split-consent__list">
        <div>
          <dt>보내는 것</dt>
          <dd>{disclosure.sends}</dd>
        </div>
        <div>
          <dt>보내지 않는 것</dt>
          <dd>{disclosure.withholds}</dd>
        </div>
        <div>
          <dt>결과</dt>
          <dd>{disclosure.result}</dd>
        </div>
      </dl>
      <div className="confirm-dialog__actions">
        <button className="workspace-button" onClick={onClose} disabled={busy}>
          나중에
        </button>
        <button
          className="workspace-button workspace-button--primary"
          onClick={onAgree}
          disabled={busy}
        >
          동의하고 쪼개기
        </button>
      </div>
    </Modal>,
    document.querySelector('.workspace-theme') ?? document.body,
  )
}

export default SplitConsentDialog
