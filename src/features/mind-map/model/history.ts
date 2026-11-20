import type { MindMapNode } from './tree'

export type Snapshot = { tree: MindMapNode; selectedId: string }
export type History = { past: Snapshot[]; future: Snapshot[] }

export const HISTORY_LIMIT = 200

const capped = (list: Snapshot[]): Snapshot[] =>
  list.length > HISTORY_LIMIT ? list.slice(list.length - HISTORY_LIMIT) : list

export const emptyHistory = (): History => ({ past: [], future: [] })

/** 바꾸기 전의 상태를 넣는다. 한도를 넘으면 가장 오래된 것을 버리고, 다시 하기는 비운다. */
export const record = (history: History, snapshot: Snapshot): History => ({
  past: capped([...history.past, snapshot]),
  future: [],
})

/** 취소한 편집의 기록을 뺀다. */
export const dropLast = (history: History): History => ({
  past: history.past.slice(0, -1),
  future: history.future,
})

export const undo = (
  history: History,
  current: Snapshot,
): { history: History; snapshot: Snapshot } | null => {
  const snapshot = history.past.at(-1)
  if (!snapshot) return null
  return {
    history: { past: history.past.slice(0, -1), future: capped([...history.future, current]) },
    snapshot,
  }
}

export const redo = (
  history: History,
  current: Snapshot,
): { history: History; snapshot: Snapshot } | null => {
  const snapshot = history.future.at(-1)
  if (!snapshot) return null
  return {
    history: { past: capped([...history.past, current]), future: history.future.slice(0, -1) },
    snapshot,
  }
}
