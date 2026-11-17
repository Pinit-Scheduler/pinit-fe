import { useEffect, useRef, useState } from 'react'
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
  /**
   * 서버 검사를 받는다. 통과하면 null, 거부면 서버가 준 칸별 오류. reject하지 않는다: 검사 요청이 실패했거나 받지
   * 않았으면(검사 중·만드는 중) `[]`이고, 이것은 칸 오류가 아닌 실패라 창은 고치기 단계에 그대로 남는다
   * (실패는 부른 쪽이 토스트로 알린다).
   */
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
  // 읽기↔고치기를 바꾸면 누른 버튼이 사라져 초점이 body로 떨어진다. 바꾼 뒤 첫 칸(고치기)이나 제목(읽기)으로 옮긴다.
  const headRef = useRef<HTMLHeadingElement>(null)
  const switched = useRef(false)
  useEffect(() => {
    if (!switched.current) return
    switched.current = false
    const head = headRef.current
    const field = editing
      ? head
          ?.closest('.split-dialog')
          ?.querySelector<HTMLElement>('.split-form input, .split-form select, .split-form textarea')
      : null
    ;(field ?? head)?.focus()
  }, [editing])
  const read = () => {
    switched.current = true
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
        <h2 ref={headRef} tabIndex={-1}>
          {editing ? '조각 고치기' : '조각 내용'}
        </h2>
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
            void onSave(next)
              .then((failed) => {
                if (failed) setErrors(failed)
                else read()
              })
              // 계약상 reject하지 않지만, 혹시 던져도 고치던 내용을 그대로 둔다.
              .catch(() => {})
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
            switched.current = true
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
