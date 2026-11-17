import { useState } from 'react'
import { createPortal } from 'react-dom'
import Modal from '@shared/components/common/Modal'
import WorkspaceIcon from '@shared/components/common/WorkspaceIcon'
import type {
  SplitCheck,
  SplitCheckPiece,
  SplitFieldError,
  SplitPiece,
} from '../api/splitProposals'
import PieceForm from './PieceForm'
import PieceView from './PieceView'

type PieceDialogProps = {
  piece: SplitPiece
  info: SplitCheckPiece
  limits: SplitCheck['limits']
  titleOf: (key: string) => string
  formatDay: (date: string) => string
  /** 고치기 단계로 연다(목록 보기의 "고치기"). */
  startEditing: boolean
  busy: boolean
  onClose: () => void
  onRemove: () => void
  /** 서버 검사를 받는다. 통과하면 null, 아니면 서버가 준 칸별 오류. */
  onSave: (next: SplitPiece) => Promise<SplitFieldError[] | null>
}

/** 조각 내용 창. 읽기 단계에서 "고치기"를 누르면 폼이 되고, "확인"을 누를 때 서버 검사를 받는다. */
export default function PieceDialog({
  piece,
  info,
  limits,
  titleOf,
  formatDay,
  startEditing,
  busy,
  onClose,
  onRemove,
  onSave,
}: PieceDialogProps) {
  const [editing, setEditing] = useState(startEditing)
  const [errors, setErrors] = useState<SplitFieldError[]>(startEditing ? info.errors : [])
  const read = () => {
    setEditing(false)
    setErrors([])
  }
  return createPortal(
    <Modal
      backdropClassName="split-dialog__backdrop split-dialog__backdrop--sheet"
      className="split-dialog split-dialog--piece"
      ariaLabel="조각 내용"
      sheet
      closeOnBackdrop={!editing}
      onClose={busy ? undefined : onClose}
    >
      <header className="split-dialog__head">
        <h2>{editing ? '조각 고치기' : '조각 내용'}</h2>
        <button type="button" aria-label="닫기" disabled={busy} onClick={onClose}>
          <WorkspaceIcon name="close" />
        </button>
      </header>
      {editing ? (
        <PieceForm
          piece={piece}
          info={info}
          limits={limits}
          errors={errors}
          busy={busy}
          onCancel={read}
          onSubmit={(next) => {
            void onSave(next).then((failed) => {
              if (failed) setErrors(failed)
              else read()
            })
          }}
        />
      ) : (
        <PieceView
          piece={piece}
          info={info}
          titleOf={titleOf}
          formatDay={formatDay}
          busy={busy}
          onRemove={onRemove}
          onEdit={() => {
            setEditing(true)
            setErrors(info.errors)
          }}
        />
      )}
    </Modal>,
    // 페이지 영역 밖에 그려야 미니 플레이어와 하단 탭 위로 올라온다.
    document.querySelector('.workspace-theme') ?? document.body,
  )
}
