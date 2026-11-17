import type { SplitPiece } from '../api/splitProposals'

/**
 * 화면을 떠났다 돌아올 때(만들기·버리기 되돌리기) 고치던 조각을 잇는 메모리 보관소.
 * 새로 고치면 사라진다.
 */
const stash = new Map<number, SplitPiece[]>()

export const stashDraft = (requestId: number, pieces: SplitPiece[]): void => {
  stash.set(requestId, [...pieces])
}

/** 맡아 둔 조각. 꺼내면 지운다. 없으면 null. */
export const takeDraft = (requestId: number): SplitPiece[] | null => {
  const pieces = stash.get(requestId)
  if (!pieces) return null
  stash.delete(requestId)
  return pieces
}
