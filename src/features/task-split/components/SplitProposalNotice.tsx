import { Link } from 'react-router-dom'
import WorkspaceIcon from '@shared/components/common/WorkspaceIcon'
import type { SplitRequestItem } from '../api/splitRequests'
import { SPLIT_INBOX_PATH } from '../utils/splitPaths'
import {
  EXPIRED_REOPEN,
  EXPIRED_TITLE,
  expiredBody,
  LOADING,
  MISSING,
  PROCESSED,
  TO_INBOX,
} from '../utils/splitProposalLabels'

export type NoticeScreen =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'processed' }
  | { kind: 'expired' }
  | { kind: 'error'; message: string }

type SplitProposalNoticeProps = {
  screen: NoticeScreen
  /** 마지막으로 읽은 요청. 만료 안내의 원본 제목과 원본 링크에 쓴다. */
  request: SplitRequestItem | null
  onRetry: () => void
}

/** 제안을 보일 수 없을 때의 안내: 불러오는 중·볼 수 없음·이미 처리됨·만료·오류. */
export default function SplitProposalNotice({ screen, request, onRetry }: SplitProposalNoticeProps) {
  if (screen.kind === 'expired')
    return (
      <section className="split-page">
        <div className="split-done">
          <span className="split-done__mark split-done__mark--muted">
            <WorkspaceIcon name="clock" />
          </span>
          <h1>{EXPIRED_TITLE}</h1>
          <p>{expiredBody(request?.originalTitle ?? null)}</p>
          <div className="split-done__actions">
            {request && (
              <Link
                className="workspace-button workspace-button--primary"
                to={`/app/tasks/${request.taskId}`}
              >
                {EXPIRED_REOPEN}
              </Link>
            )}
            <Link className="workspace-button" to={SPLIT_INBOX_PATH}>
              {TO_INBOX}
            </Link>
          </div>
        </div>
      </section>
    )

  if (screen.kind === 'loading')
    return (
      <section className="split-page">
        <div className="split-empty" role="status">
          <p>{LOADING}</p>
        </div>
      </section>
    )

  if (screen.kind === 'error')
    return (
      <section className="split-page">
        <div className="split-empty" role="alert">
          <p>{screen.message}</p>
          <button type="button" className="workspace-button" onClick={onRetry}>
            다시 시도
          </button>
        </div>
      </section>
    )

  return (
    <section className="split-page">
      <div className="split-empty">
        <p>{screen.kind === 'missing' ? MISSING : PROCESSED}</p>
        <Link className="workspace-button" to={SPLIT_INBOX_PATH}>
          {TO_INBOX}
        </Link>
      </div>
    </section>
  )
}
