import { buildApiUrl } from '@shared/api/config'
import { httpClient } from '@shared/api/httpClient'
import type { SplitRequestItem } from './splitRequests'

/**
 * 제안·검사·만들기 API(ADR-0035 §8.3). 서버 모양은 pinit-monolith `SplitProposalView`·`SplitCheckResult`·
 * `SplitApplyResult`와 같다. null인 필드는 빠진 채 올 수 있으므로 `== null`로만 가른다.
 */
export type DraftPiece = {
  key: string
  title: string
  description: string
  minutes: number
  difficulty: number
  /** 서버는 마감이 없는 조각을 null(또는 빠짐)로 줄 수 있다. */
  dueDate: string | null
  /** 원래 간선. 뺀 조각의 간선도 남는다. */
  after: string[]
  selected: boolean
}
export type SplitPiece = DraftPiece & {
  dueDateAdjusted?: boolean | null
  exclusion?: {
    reason: 'ALREADY_DONE' | 'DUPLICATES_OPEN'
    evidenceTaskId: number
    evidenceTitle: string
  } | null
}
export type SplitProposalView = {
  originalTitle: string
  originalMinutes: number
  originalDueDate: string | null
  expiresAt: string
  violationRemaining: boolean
  factors: Record<string, number>
  pieces: SplitPiece[]
}
export type SplitCheck = {
  pieces: {
    key: string
    shownMinutes: number
    over: boolean
    stage?: number | null
    before: string[]
    errors: {
      field: 'title' | 'description' | 'minutes' | 'difficulty' | 'dueDate' | 'after'
      message: string
    }[]
    warnings: {
      kind: 'OVERLAPS_OPEN_TASK'
      evidenceTaskId: number
      evidenceTitle: string
    }[]
    orderChoices: {
      key: string
      title: string
      link: 'DIRECT' | 'VIA_EXCLUDED' | 'NONE'
      blocked: boolean
    }[]
  }[]
  selectedCount: number
  totalMinutes: number
  overCount: number
  problemCount: number
  canApply: boolean
  cannotApplyReason?: 'NOTHING_SELECTED' | 'HAS_PROBLEMS' | 'ADMIN_ONLY' | null
  emptyReason?: 'ALL_EXCLUDED_BY_AI' | 'ALL_REMOVED_BY_MEMBER' | null
  accepted?: boolean | null
  limits: {
    titleMax: number
    descriptionMax: number
    minutesMin: number
    minutesMax: number
    dueMin: string | null
    dueMax: string | null
  }
}

export type SplitFieldError = SplitCheck['pieces'][number]['errors'][number]
export type SplitCheckPiece = SplitCheck['pieces'][number]
export type SplitOrderChoice = SplitCheckPiece['orderChoices'][number]
export type SplitDraftAction = { type: 'CONFIRM' | 'EXCLUDE' | 'INCLUDE'; key: string }
export type SplitDraft = { pieces: SplitPiece[]; action?: SplitDraftAction }
export type SplitDetail = {
  request: SplitRequestItem
  proposal?: SplitProposalView | null
  check?: SplitCheck | null
}
export type SplitApplyResult = {
  request: SplitRequestItem
  created: { key: string; taskId: number }[]
  createdEdges: { fromTaskId: number; toTaskId: number }[]
  notInherited: { taskId: number; direction: 'BEFORE' | 'AFTER'; reason: string }[]
  trashedTaskId: number
}

/** 서버가 읽는 여덟 칸만 남긴다. `exclusion`·`dueDateAdjusted`는 저장된 제안의 값을 서버가 쓴다. */
export const toDraftPieces = (pieces: SplitPiece[]): DraftPiece[] =>
  pieces.map((piece) => ({
    key: piece.key,
    title: piece.title,
    description: piece.description,
    minutes: piece.minutes,
    difficulty: piece.difficulty,
    dueDate: piece.dueDate,
    after: piece.after,
    selected: piece.selected,
  }))

export const fetchSplitDetail = (requestId: number, signal?: AbortSignal) =>
  httpClient<SplitDetail>(buildApiUrl(`/task-splits/${requestId}`, 'v2'), { signal })

export const checkSplitDraft = (requestId: number, draft: SplitDraft) =>
  httpClient<SplitCheck>(buildApiUrl(`/task-splits/${requestId}/check`, 'v2'), {
    method: 'POST',
    json: draft.action
      ? { pieces: toDraftPieces(draft.pieces), action: draft.action }
      : { pieces: toDraftPieces(draft.pieces) },
  })

export const applySplit = (requestId: number, pieces: SplitPiece[]) =>
  httpClient<SplitApplyResult>(buildApiUrl(`/task-splits/${requestId}/apply`, 'v2'), {
    method: 'POST',
    json: { pieces: toDraftPieces(pieces) },
  })
