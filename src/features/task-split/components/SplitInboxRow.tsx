import type { SplitRequestItem } from '../api/splitRequests'
import { inboxNote, inboxStateLabel } from '../utils/splitLabels'

type SplitInboxRowProps = {
  item: SplitRequestItem
  now: number
  formatDay: (iso: string) => string
  /** 제안 화면이 있으면 준비된 줄에 "제안 보기"를 둔다. */
  proposalScreen: boolean
  onOpen: () => void
  onCancel: () => void
  onDiscard: () => void
}

/** 쪼개기 보관함의 한 줄. 지금 할 수 있는 버튼만 둔다. */
const SplitInboxRow = ({
  item,
  now,
  formatDay,
  proposalScreen,
  onOpen,
  onCancel,
  onDiscard,
}: SplitInboxRowProps) => {
  const processing = item.status === 'QUEUED' || item.status === 'RUNNING'
  return (
    <li className="split-row" data-status={item.status}>
      <div className="split-row__main">
        <span className="split-row__state">
          {processing && <span className="split-spinner" aria-hidden />}
          {inboxStateLabel(item.status)}
        </span>
        <strong className="split-row__title">{item.originalTitle ?? '작업'}</strong>
        <p className="split-row__note">{inboxNote(item, now, formatDay)}</p>
      </div>
      <div className="split-row__actions">
        {processing && (
          <button type="button" className="workspace-button" onClick={onCancel}>
            취소
          </button>
        )}
        {item.status === 'READY' && proposalScreen && (
          <button
            type="button"
            className="workspace-button workspace-button--primary"
            onClick={onOpen}
          >
            제안 보기
          </button>
        )}
        {(item.status === 'READY' || item.status === 'FAILED') && (
          <button type="button" className="workspace-button" onClick={onDiscard}>
            버리기
          </button>
        )}
      </div>
    </li>
  )
}

export default SplitInboxRow
