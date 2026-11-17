import { useCallback, useEffect, useRef, useState } from 'react'
import { useToast } from '@contexts/ToastContext'
import { getRequestFailureMessage } from '@shared/api/errorMessage'
import { UNDO_TOAST_MS } from '@features/trash/hooks/useTrashUndo'
import {
  checkSplitDraft,
  fetchSplitDetail,
  type SplitDraftAction,
  type SplitFieldError,
  type SplitPiece,
} from '../api/splitProposals'
import type { SplitRequestItem } from '../api/splitRequests'
import { stashDraft, takeDraft } from '../utils/draftStash'
import {
  adoptCheck,
  initDraft,
  piecesAfter,
  resetToFirst,
  restoreTo,
  undoLast,
  type DraftState,
} from '../utils/splitDraft'
import {
  EDITED_TOAST,
  removedToast,
  restoredToast,
} from '../utils/splitProposalLabels'
import {
  checkFailureOf,
  screenOfDetail,
  screenOfError,
  type ProposalScreen,
} from '../utils/splitProposalScreen'

export type SplitProposalState = {
  screen: ProposalScreen | { kind: 'loading' }
  /** screen이 ready일 때만 */
  draft: DraftState | null
  /** 마지막으로 읽은 요청. 만료 안내가 원본 제목과 작업 ID를 쓴다. 읽기 전이면 null. */
  request: SplitRequestItem | null
  /** 검사를 기다리는 중 */
  busy: boolean
  exclude: (key: string) => void
  include: (key: string) => void
  /** 통과하면 null, 거부면 그 조각의 오류. 요청이 실패하면 빈 배열 */
  confirm: (next: SplitPiece) => Promise<SplitFieldError[] | null>
  undo: () => void
  reset: () => void
  /** 제안을 다시 읽는다 */
  reload: () => void
  /** Task 8이 쓴다. `reload`를 주면 고치던 조각을 이어 제안을 다시 읽는다. */
  setScreen: (screen: ProposalScreen) => void
  /** Task 8이 쓴다 */
  setDraft: (draft: DraftState) => void
}

const LOAD_FAILED = '제안을 불러오지 못했어요.'

const titleIn = (pieces: SplitPiece[], key: string) =>
  pieces.find((piece) => piece.key === key)?.title || '제목 없음'

/**
 * 제안 화면의 상태(ui-design §5.5). 조각을 바꿀 때마다 조각 전체를 서버 검사(S6)에 보내고 그 결과를 그린다.
 * 서버에는 아무것도 저장하지 않는다. 규칙은 모두 검사 결과가 정하고, 여기서는 순수 함수(splitDraft)로 상태만 옮긴다.
 */
export const useSplitProposal = (requestId: number): SplitProposalState => {
  const { addToast } = useToast()
  const [screen, setScreenState] = useState<SplitProposalState['screen']>({ kind: 'loading' })
  const [draft, setDraftState] = useState<DraftState | null>(null)
  const [request, setRequest] = useState<SplitRequestItem | null>(null)
  const [busy, setBusyState] = useState(false)
  // 응답이 올 때 지금 모습을 봐야 해서 상태를 ref에도 둔다.
  const draftRef = useRef<DraftState | null>(null)
  const busyRef = useRef(false)
  // 받아들일 응답의 차례. 새 요청·되돌리기·다시 읽기·화면을 떠날 때 올라가 그 전 응답을 버린다.
  const turnRef = useRef(0)

  const commitDraft = useCallback((next: DraftState | null) => {
    draftRef.current = next
    setDraftState(next)
  }, [])
  const setBusy = useCallback((next: boolean) => {
    busyRef.current = next
    setBusyState(next)
  }, [])
  const show = useCallback(
    (next: Exclude<ProposalScreen, { kind: 'reload' }> | { kind: 'loading' }) => {
      commitDraft(null)
      setBusy(false)
      setScreenState(next)
    },
    [commitDraft, setBusy],
  )

  /**
   * 제안을 읽는다. `keep`이 있으면 키가 맞는 조각은 그 모습으로 바꿔 다시 검사받고(실패하면 받은 제안으로),
   * 없으면 받은 제안과 첫 검사 결과로 시작한다. 요청이 아직 READY인데 거부되면 한 번만 다시 읽는다.
   */
  const open = useCallback(
    (keep: SplitPiece[] | null): Promise<void> => {
      const turn = ++turnRef.current
      const live = () => turn === turnRef.current
      const read = async (retried: boolean): Promise<void> => {
        try {
          const detail = await fetchSplitDetail(requestId)
          if (!live()) return
          setRequest(detail.request)
          const next = screenOfDetail(detail)
          if (next.kind !== 'ready') {
            if (next.kind !== 'reload') show(next)
            return
          }
          const { proposal, check } = next.detail
          if (proposal == null || check == null) return
          let start = initDraft(proposal.pieces, check)
          if (keep) {
            const pieces = proposal.pieces.map(
              (piece) => keep.find((kept) => kept.key === piece.key) ?? piece,
            )
            try {
              const rechecked = await checkSplitDraft(requestId, { pieces })
              if (!live()) return
              start = initDraft(pieces, rechecked)
            } catch {
              if (!live()) return
            }
          }
          commitDraft(start)
          setBusy(false)
          setScreenState(next)
        } catch (error) {
          if (!live()) return
          const next = screenOfError(error)
          if (next.kind !== 'reload') show(next)
          else if (!retried) await read(true)
          else show({ kind: 'error', message: getRequestFailureMessage(error, LOAD_FAILED) })
        }
      }
      return read(false)
    },
    [requestId, commitDraft, setBusy, show],
  )

  /** 화면이 그대로면 검사 중처럼 두고 다시 읽는다. 안내 화면이었으면 불러오는 중으로 바꾼다. */
  const reread = useCallback(
    (keep: SplitPiece[] | null) => {
      if (draftRef.current) setBusy(true)
      else show({ kind: 'loading' })
      void open(keep)
    },
    [open, setBusy, show],
  )

  useEffect(() => {
    // 맡아 둔 조각은 꺼내면 지워진다. 열기를 끝내기 전에 떠나면(개발 모드의 effect 재실행 포함) 돌려놓는다.
    const kept = takeDraft(requestId)
    let opened = false
    void open(kept).then(() => {
      opened = true
    })
    return () => {
      turnRef.current += 1
      draftRef.current = null
      if (kept && !opened) stashDraft(requestId, kept)
    }
  }, [requestId, open])

  /** 서버를 부르지 않고 기록의 모습으로 돌아간다. 기다리던 검사 응답은 버린다. */
  const rewind = useCallback(
    (change: (state: DraftState) => DraftState) => {
      const current = draftRef.current
      if (!current) return
      turnRef.current += 1
      setBusy(false)
      commitDraft(change(current))
    },
    [commitDraft, setBusy],
  )

  const send = useCallback(
    async (action: SplitDraftAction, edited?: SplitPiece): Promise<SplitFieldError[] | null> => {
      const before = draftRef.current
      if (!before || busyRef.current) return []
      const pieces = piecesAfter(before, action, edited)
      const turn = ++turnRef.current
      setBusy(true)
      let check
      try {
        check = await checkSplitDraft(requestId, { pieces, action })
      } catch (error) {
        if (turn !== turnRef.current) return []
        setBusy(false)
        const failure = checkFailureOf(error)
        if (failure.kind === 'toast') addToast(failure.message, 'error')
        else if (failure.screen.kind === 'reload') reread(before.pieces)
        else show(failure.screen)
        return []
      }
      if (turn !== turnRef.current) return []
      setBusy(false)
      const adopted = adoptCheck(before, pieces, check, action)
      if (!adopted.accepted) return adopted.errors
      commitDraft(adopted.state)
      const title = titleIn(pieces, action.key)
      const message =
        action.type === 'EXCLUDE'
          ? removedToast(title)
          : action.type === 'INCLUDE'
            ? restoredToast(title)
            : EDITED_TOAST
      // 토스트의 되돌리기는 나중에 눌린다. 바꾸기 전 모습과 그때의 기록 깊이를 지금 잡아 둔다.
      const snapshot = { pieces: before.pieces, check: before.check }
      const depth = before.history.length
      addToast(message, 'success', {
        durationMs: UNDO_TOAST_MS,
        action: {
          label: '되돌리기',
          onAction: () => rewind((state) => restoreTo(state, snapshot, depth)),
        },
      })
      return null
    },
    [requestId, addToast, commitDraft, reread, rewind, setBusy, show],
  )

  const setScreen = useCallback(
    (next: ProposalScreen) => {
      if (next.kind === 'reload') reread(draftRef.current?.pieces ?? null)
      else if (next.kind === 'ready') setScreenState(next)
      else show(next)
    },
    [reread, show],
  )

  return {
    screen,
    draft,
    request,
    busy,
    exclude: (key) => void send({ type: 'EXCLUDE', key }),
    include: (key) => void send({ type: 'INCLUDE', key }),
    confirm: (next) => send({ type: 'CONFIRM', key: next.key }, next),
    undo: () => rewind(undoLast),
    reset: () => rewind(resetToFirst),
    reload: () => reread(draftRef.current?.pieces ?? null),
    setScreen,
    setDraft: commitDraft,
  }
}
