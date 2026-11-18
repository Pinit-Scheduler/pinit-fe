import type { SplitCheckPiece, SplitPiece } from '../api/splitProposals'
import PieceSummary from './PieceSummary'

type PieceViewProps = {
  piece: SplitPiece
  info: SplitCheckPiece
  titleOf: (key: string) => string
  formatDay: (date: string) => string
  busy: boolean
  onRemove: () => void
  onEdit: () => void
}

/** 조각 내용 창의 읽기 단계. 제목, 요약, 설명 전체와 빼기·고치기. */
export default function PieceView({
  piece,
  info,
  titleOf,
  formatDay,
  busy,
  onRemove,
  onEdit,
}: PieceViewProps) {
  return (
    <div className="split-piece split-piece--plain">
      <div className="split-piece__body">
        <div className="split-piece__head">
          <strong>{piece.title || '제목 없음'}</strong>
        </div>
        <PieceSummary piece={piece} info={info} titleOf={titleOf} formatDay={formatDay} />
        <p className="split-piece__text">{piece.description}</p>
        <div className="split-dialog__actions">
          <button type="button" className="workspace-button" disabled={busy} onClick={onRemove}>
            빼기
          </button>
          <button
            type="button"
            className="workspace-button workspace-button--primary"
            disabled={busy}
            onClick={onEdit}
          >
            고치기
          </button>
        </div>
      </div>
    </div>
  )
}
