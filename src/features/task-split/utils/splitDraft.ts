import type {
  SplitCheck,
  SplitCheckPiece,
  SplitDraftAction,
  SplitFieldError,
  SplitPiece,
} from '../api/splitProposals'

/**
 * 제안 다듬기 상태(ui-design §5.5~§5.7). 규칙(오류·합계·단계·순서 후보)은 모두 서버 검사 결과(`SplitCheck`)가 정한다.
 * 여기서는 멤버가 바꾼 조각을 들고, 보낼 조각을 만들고, 검사 결과를 받아들일지와 되돌리기 기록만 다룬다.
 * 기록에는 검사 결과를 함께 쌓아 되돌릴 때 서버를 다시 부르지 않는다.
 */
export type DraftSnapshot = { pieces: SplitPiece[]; check: SplitCheck }
export type DraftState = DraftSnapshot & { history: DraftSnapshot[] }

export const initDraft = (pieces: SplitPiece[], check: SplitCheck): DraftState => ({
  pieces,
  check,
  history: [],
})

/** 동작을 반영한 조각 전체. EXCLUDE → selected false, INCLUDE → true, CONFIRM → edited로 바꿔 끼운다. state는 바꾸지 않는다. */
export const piecesAfter = (
  state: DraftState,
  action: SplitDraftAction,
  edited?: SplitPiece,
): SplitPiece[] =>
  state.pieces.map((piece) => {
    if (piece.key !== action.key) return piece
    if (action.type === 'EXCLUDE') return { ...piece, selected: false }
    if (action.type === 'INCLUDE') return { ...piece, selected: true }
    return edited ? { ...edited } : piece
  })

export const infoOf = (check: SplitCheck, key: string): SplitCheckPiece | undefined =>
  check.pieces.find((piece) => piece.key === key)

/** 검사 결과를 따른다. CONFIRM이고 check.accepted === false면 state 그대로와 그 조각의 errors, 아니면 지금 모습을 기록에 쌓고 새 모습으로. */
export const adoptCheck = (
  state: DraftState,
  pieces: SplitPiece[],
  check: SplitCheck,
  action: SplitDraftAction,
): { state: DraftState; accepted: boolean; errors: SplitFieldError[] } => {
  if (action.type === 'CONFIRM' && check.accepted === false) {
    return { state, accepted: false, errors: [...(infoOf(check, action.key)?.errors ?? [])] }
  }
  return {
    state: {
      pieces,
      check,
      history: [...state.history, { pieces: state.pieces, check: state.check }],
    },
    accepted: true,
    errors: [],
  }
}

/** 만들기 거부에 실린 최신 검사 결과로 바꾼다. 조각과 기록은 그대로다. */
export const replaceCheck = (state: DraftState, check: SplitCheck): DraftState => ({
  ...state,
  check,
})

/** 한 번 되돌린다. 기록이 없으면 그대로. */
export const undoLast = (state: DraftState): DraftState => {
  const last = state.history[state.history.length - 1]
  if (!last) return state
  return { pieces: last.pieces, check: last.check, history: state.history.slice(0, -1) }
}

/** 기록의 첫 모습(받은 제안)으로 돌아가고 기록을 비운다. 기록이 없으면 그대로. */
export const resetToFirst = (state: DraftState): DraftState => {
  const first = state.history[0]
  if (!first) return state
  return { pieces: first.pieces, check: first.check, history: [] }
}

/** 토스트의 되돌리기. 바꾸기 전에 잡아 둔 모습으로 돌아가고 기록을 그때의 깊이로 자른다. */
export const restoreTo = (state: DraftState, snapshot: DraftSnapshot, depth: number): DraftState => ({
  pieces: snapshot.pieces,
  check: snapshot.check,
  history: state.history.slice(0, depth),
})

/** 만들 조각(서버가 단계를 준 조각, 단계 순·같은 단계는 받은 순), 단계별 묶음(빈 단계 없음), 뺀 조각. */
export const viewOf = (
  state: DraftState,
): { made: SplitPiece[]; stages: SplitPiece[][]; dropped: SplitPiece[] } => {
  const staged = state.pieces.flatMap((piece) => {
    const stage = infoOf(state.check, piece.key)?.stage
    return typeof stage === 'number' ? [{ piece, stage }] : []
  })
  // Array.prototype.sort는 안정 정렬이라 같은 단계는 받은 순서를 지킨다.
  staged.sort((a, b) => a.stage - b.stage)
  const stages: SplitPiece[][] = []
  let current: number | null = null
  for (const { piece, stage } of staged) {
    if (stage !== current) {
      stages.push([])
      current = stage
    }
    stages[stages.length - 1].push(piece)
  }
  return {
    made: staged.map(({ piece }) => piece),
    stages,
    dropped: state.pieces.filter((piece) => !piece.selected),
  }
}
