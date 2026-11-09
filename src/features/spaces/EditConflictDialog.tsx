import Modal from '@shared/components/common/Modal'
import MyInputDisclosure from './MyInputDisclosure'
import type { InputRow } from './conflicts'

export type ConflictState = {
  rows: InputRow[]
  loading?: boolean
  /** 최신 내용 조회가 실패한 이유. 있으면 다시 시도·목록으로를 보인다. */
  loadError?: string | null
}

export default function EditConflictDialog({
  rows,
  noun,
  loading = false,
  loadError = null,
  onLoadLatest,
  onClose,
  onBackToList,
}: {
  rows: InputRow[]
  noun: '작업' | '일정'
  loading?: boolean
  loadError?: string | null
  onLoadLatest: () => void
  /** 닫기·Esc. 폼에 쓴 내 입력은 그대로 남는다. */
  onClose: () => void
  onBackToList: () => void
}) {
  return (
    <Modal
      labelledBy="edit-conflict-title"
      backdropClassName="space-dialog-backdrop space-conflict-backdrop"
      className="space-dialog space-dialog--notice"
      closeOnBackdrop={false}
      onClose={onClose}
    >
      <h2 id="edit-conflict-title">다른 참여자가 먼저 수정했어요</h2>
      <div className="space-dialog__body">
        <p>
          저장하기 전에 이 {noun}이 바뀌어서 내 입력은 저장되지 않았어요. 최신
          내용을 불러온 뒤 필요한 내용만 다시 입력하세요.
        </p>
        {loadError && (
          <p role="alert" className="space-error">
            최신 내용을 불러오지 못했어요. {loadError}
          </p>
        )}
        <MyInputDisclosure rows={rows} open />
      </div>
      <div className="space-dialog__actions">
        <button type="button" className="workspace-button" onClick={onClose}>
          닫기
        </button>
        {loadError && (
          <button
            type="button"
            className="workspace-button"
            onClick={onBackToList}
          >
            목록으로
          </button>
        )}
        <button
          type="button"
          className="workspace-button workspace-button--primary"
          onClick={onLoadLatest}
          disabled={loading}
        >
          {loading
            ? '불러오는 중…'
            : loadError
              ? '다시 시도'
              : '최신 내용 불러오기'}
        </button>
      </div>
    </Modal>
  )
}
