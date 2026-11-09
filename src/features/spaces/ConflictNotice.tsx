import { useEffect, useState } from 'react'
import Modal from '@shared/components/common/Modal'
import { EVENT } from './conflicts'

export default function ConflictNotice() {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const show = () => setOpen(true)
    window.addEventListener(EVENT, show)
    return () => window.removeEventListener(EVENT, show)
  }, [])
  if (!open) return null
  return (
    <Modal
      labelledBy="workspace-conflict-title"
      backdropClassName="space-dialog-backdrop space-conflict-backdrop"
      className="space-dialog space-dialog--notice"
      closeOnBackdrop={false}
    >
      <h2 id="workspace-conflict-title">다른 참여자가 먼저 수정했어요</h2>
      <p>
        이 항목이 업데이트되어 입력한 내용은 저장되지 않았어요. 확인하면 최신
        내용으로 갱신합니다.
      </p>
      <div className="space-dialog__actions">
        <button
          type="button"
          className="workspace-button workspace-button--primary"
          onClick={() => window.location.reload()}
        >
          최신 내용 확인
        </button>
      </div>
    </Modal>
  )
}
