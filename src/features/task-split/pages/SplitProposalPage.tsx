import { useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import dayjs from 'dayjs'
import WorkspaceIcon from '@shared/components/common/WorkspaceIcon'
import { toDisplayDayjs } from '@shared/utils/datetime'
import { useSpaces } from '@features/spaces/store'
import { adminNames } from '@features/spaces/unavailable'
import type { SplitPiece } from '../api/splitProposals'
import PieceDialog from '../components/PieceDialog'
import PieceSummary from '../components/PieceSummary'
import SplitMap from '../components/SplitMap'
import SplitProposalNotice from '../components/SplitProposalNotice'
import { useSplitApply } from '../hooks/useSplitApply'
import { useSplitCommands } from '../hooks/useSplitCommands'
import { useSplitProposal } from '../hooks/useSplitProposal'
import { infoOf, viewOf } from '../utils/splitDraft'
import type { MapPiece } from '../utils/splitMapLayout'
import { SPLIT_INBOX_PATH } from '../utils/splitPaths'
import {
  adminOnlyNotice,
  applySummary,
  compareLine,
  droppedNote,
  droppedTitle,
  emptyText,
  originLine,
} from '../utils/splitProposalLabels'
import '@features/task-map/TaskMapPage.css'
import '../task-split.css'

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/
/** 날짜 문자열(조각·원본 마감). 마감이 없는 조각은 빈 문자열로 온다. */
const formatDate = (value: string) => (value ? dayjs(value).format('M/D') : '')
/** 원본 줄에는 날짜(원본 마감)와 시각(보관 기한)이 함께 온다. */
const formatOrigin = (value: string) =>
  DATE_ONLY.test(value) ? formatDate(value) : toDisplayDayjs(value).format('M/D')

const titleOf = (pieces: SplitPiece[], key: string) =>
  pieces.find((piece) => piece.key === key)?.title || '제목 없음'

/** 쪼개기 제안 화면. 요청이 바뀌면 새로 연다. */
export default function SplitProposalPage() {
  const requestId = Number(useParams().requestId)
  if (!Number.isInteger(requestId) || requestId <= 0)
    return <SplitProposalNotice screen={{ kind: 'missing' }} request={null} onRetry={() => {}} />
  return <SplitProposal key={requestId} requestId={requestId} />
}

function SplitProposal({ requestId }: { requestId: number }) {
  const state = useSplitProposal(requestId)
  const navigate = useNavigate()
  const commands = useSplitCommands()
  const { spaces } = useSpaces()
  const { applying, adminRefused, apply } = useSplitApply(requestId, state)
  const [view, setView] = useState<'map' | 'list'>('map')
  const [dialog, setDialog] = useState<{ key: string; editing: boolean } | null>(null)
  const { screen, draft, busy } = state
  const adminOnly =
    adminRefused ||
    (screen.kind === 'ready' && draft?.check.cannotApplyReason === 'ADMIN_ONLY')
  const rejectRef = useRef<HTMLDivElement>(null)
  // 안내는 위에 뜨고 "만들기"는 아래에 있다. 누른 회원이 보도록 그 자리로 올린다.
  useEffect(() => {
    if (adminOnly) rejectRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [adminOnly])

  if (screen.kind === 'to-inbox') return <Navigate to={SPLIT_INBOX_PATH} replace />
  if (screen.kind !== 'ready' || draft == null)
    return (
      <SplitProposalNotice
        screen={screen.kind === 'ready' || screen.kind === 'reload' ? { kind: 'loading' } : screen}
        request={state.request}
        onRetry={state.reload}
      />
    )

  const { proposal, request } = screen.detail
  if (proposal == null) return null
  const { check } = draft
  const { made, stages, dropped } = viewOf(draft)
  const nameOf = (key: string) => titleOf(draft.pieces, key)
  const remove = (key: string) => {
    setDialog(null)
    state.exclude(key)
  }
  const mapPieces: MapPiece[] = made.flatMap((piece) => {
    const info = infoOf(check, piece.key)
    if (info == null || info.stage == null) return []
    return [
      {
        key: piece.key,
        title: piece.title,
        shownMinutes: info.shownMinutes,
        over: info.over,
        stage: info.stage,
        dueDate: piece.dueDate ?? '',
        before: info.before,
        problem: info.errors.length > 0,
      },
    ]
  })
  const active = dialog && made.find((piece) => piece.key === dialog.key)
  const activeInfo = active ? infoOf(check, active.key) : undefined
  const compare = compareLine(proposal, check)
  const summary = applySummary(check)
  const members = spaces.find((space) => space.id === request.spaceId)?.members ?? []
  const notice = adminOnly ? adminOnlyNotice(adminNames(members), adminRefused) : null

  const card = (piece: SplitPiece) => {
    const info = infoOf(check, piece.key)
    if (info == null) return null
    return (
      <article
        key={piece.key}
        className="split-piece"
        data-problem={info.errors.length > 0 || undefined}
      >
        <div className="split-piece__body">
          <div className="split-piece__head">
            <strong>{piece.title || '제목 없음'}</strong>
            <span className="split-piece__tools">
              <button
                type="button"
                className="split-piece__edit"
                disabled={busy}
                onClick={() => setDialog({ key: piece.key, editing: true })}
              >
                고치기
              </button>
              <button
                type="button"
                className="split-piece__edit split-piece__edit--quiet"
                disabled={busy}
                onClick={() => remove(piece.key)}
              >
                빼기
              </button>
            </span>
          </div>
          <PieceSummary piece={piece} info={info} titleOf={nameOf} formatDay={formatDate} />
          <details className="split-piece__desc">
            <summary>목적·진행 방법·완료 기준</summary>
            <p>{piece.description}</p>
          </details>
        </div>
      </article>
    )
  }

  return (
    <section className="split-page split-page--proposal" aria-busy={busy || undefined}>
      <header className="split-page__header">
        <div>
          <p className="task-page__eyebrow">쪼개기 제안</p>
          <h1 className="task-page__title">{proposal.originalTitle}</h1>
          <p className="split-page__origin">{originLine(proposal, formatOrigin)}</p>
          <p className="split-page__compare">
            {compare.before} → 조각 합계 <strong>{compare.after}</strong>
          </p>
        </div>
        <button
          type="button"
          className="workspace-button split-page__discard"
          disabled={applying}
          onClick={() =>
            void commands
              .discard({
                requestId: request.requestId,
                status: 'READY',
                violationRemaining: proposal.violationRemaining,
              })
              .then((done) => done && navigate(SPLIT_INBOX_PATH))
          }
        >
          제안 버리기
        </button>
      </header>

      {notice && (
        <div className="split-reject" role="alert" ref={rejectRef}>
          <WorkspaceIcon name="warning" />
          <div>
            <strong>{notice.strong}</strong>
            <p>{notice.body}</p>
          </div>
        </div>
      )}

      <div className="split-toolbar">
        <div className="split-view" role="group" aria-label="보기 방식">
          <button type="button" aria-pressed={view === 'map'} onClick={() => setView('map')}>
            지도
          </button>
          <button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')}>
            목록
          </button>
        </div>
        <button
          type="button"
          className="split-view__undo"
          disabled={draft.history.length === 0 || busy}
          onClick={state.undo}
        >
          되돌리기
        </button>
        <button
          type="button"
          className="split-view__undo"
          disabled={draft.history.length === 0 || busy}
          onClick={state.reset}
        >
          처음 제안으로
        </button>
        {busy && (
          <span className="split-view__busy" role="status">
            <span className="split-spinner" aria-hidden /> 확인하는 중
          </span>
        )}
      </div>

      {view === 'map' ? (
        <SplitMap
          pieces={mapPieces}
          emptyReason={check.emptyReason}
          activeKey={active?.key ?? null}
          busy={busy}
          formatDay={formatDate}
          onActivate={(key) => setDialog({ key, editing: false })}
          onRemove={remove}
        />
      ) : stages.length === 0 ? (
        <div className="split-map split-map--empty">{emptyText(check.emptyReason)}</div>
      ) : (
        <ol className="split-stages">
          {stages.map((stage, index) => (
            <li key={stage.map((piece) => piece.key).join()} className="split-stage">
              <div className="split-stage__label">
                <span>{index + 1}</span>
              </div>
              <div className="split-stage__pieces">{stage.map(card)}</div>
            </li>
          ))}
        </ol>
      )}

      {active && activeInfo && (
        <PieceDialog
          key={active.key}
          piece={active}
          info={activeInfo}
          limits={check.limits}
          titleOf={nameOf}
          formatDay={formatDate}
          startEditing={dialog.editing}
          busy={busy}
          onClose={() => setDialog(null)}
          onRemove={() => remove(active.key)}
          onSave={state.confirm}
        />
      )}

      {dropped.length > 0 && (
        <section className="split-dropped">
          <h2>{droppedTitle(dropped.length)}</h2>
          <ul>
            {dropped.map((piece) => {
              const info = infoOf(check, piece.key)
              return (
                <li key={piece.key}>
                  <div>
                    <strong>{piece.title || '제목 없음'}</strong>
                    <span>{droppedNote(piece, info)}</span>
                    {info?.errors.map((error, index) => (
                      <p
                        key={`${error.field}-${index}`}
                        className="split-piece__problem"
                        role="alert"
                      >
                        {error.message}
                      </p>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="workspace-button"
                    disabled={busy}
                    onClick={() => state.include(piece.key)}
                  >
                    다시 넣기
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      <footer className="split-apply">
        <div className="split-apply__summary" aria-live="polite">
          <strong>{summary.main}</strong>
          <span data-warn={summary.warn !== '' || undefined}>{summary.warn}</span>
        </div>
        <button
          type="button"
          className="workspace-button workspace-button--primary"
          disabled={!check.canApply || busy || applying || adminRefused}
          onClick={() => void apply()}
        >
          {applying ? '만드는 중…' : '만들기'}
        </button>
      </footer>
    </section>
  )
}
