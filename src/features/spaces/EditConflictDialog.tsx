import Modal from '@shared/components/common/Modal'
import MyInputDisclosure from './MyInputDisclosure'
import type { InputRow } from './conflicts'

export default function EditConflictDialog({
  rows,
  noun,
  onLoadLatest,
}: {
  rows: InputRow[]
  noun: '작업' | '일정'
  onLoadLatest: () => void
}) {
  return (
    <Modal
      labelledBy="edit-conflict-title"
      backdropClassName="space-dialog-backdrop space-conflict-backdrop"
      className="space-dialog space-dialog--notice"
      closeOnBackdrop={false}
    >
      <h2 id="edit-conflict-title">다른 참여자가 먼저 수정했어요</h2>
      <div className="space-dialog__body">
        <p>
          저장하기 전에 이 {noun}이 바뀌어서 내 입력은 저장되지 않았어요. 최신
          내용을 불러온 뒤 필요한 내용만 다시 입력하세요.
        </p>
        <MyInputDisclosure rows={rows} open />
      </div>
      <div className="space-dialog__actions">
        <button
          type="button"
          className="workspace-button workspace-button--primary"
          onClick={onLoadLatest}
        >
          최신 내용 불러오기
        </button>
      </div>
    </Modal>
  )
}
