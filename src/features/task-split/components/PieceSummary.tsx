import WorkspaceIcon from '@shared/components/common/WorkspaceIcon'
import { formatMinutesLabel } from '@shared/utils/isoDuration'
import type { SplitCheckPiece, SplitPiece } from '../api/splitProposals'
import { OVER_NOTE, pieceNotes } from '../utils/splitProposalLabels'

type PieceSummaryProps = {
  piece: SplitPiece
  info: SplitCheckPiece
  titleOf: (key: string) => string
  formatDay: (date: string) => string
}

/** 조각의 시간·난이도·마감, 이전 조각, 경고와 오류. 값은 모두 서버 검사 결과(`info`)에서 온다. */
export default function PieceSummary({ piece, info, titleOf, formatDay }: PieceSummaryProps) {
  return (
    <>
      <div className="split-piece__meta">
        <span data-warn={info.over || undefined}>
          {info.over && <WorkspaceIcon name="warning" />}
          {formatMinutesLabel(info.shownMinutes)}
          {info.shownMinutes !== piece.minutes && (
            <small> 입력 {formatMinutesLabel(piece.minutes)}</small>
          )}
        </span>
        <span>난이도 {piece.difficulty}</span>
        {piece.dueDate != null && <span>{formatDay(piece.dueDate)} 마감</span>}
      </div>
      {info.before.length > 0 && (
        <p className="split-piece__before">이전 조각: {info.before.map(titleOf).join(', ')}</p>
      )}
      {pieceNotes(piece, info).map((note) => (
        <p key={note} className="split-piece__note">
          {note}
        </p>
      ))}
      {info.over && (
        <p className="split-piece__note" data-warn>
          {OVER_NOTE}
        </p>
      )}
      {info.errors.map((error, index) => (
        <p key={`${error.field}-${index}`} className="split-piece__problem" role="alert">
          {error.message}
        </p>
      ))}
    </>
  )
}
