import { buildApiUrl } from '@shared/api/config'
import { httpClient } from '@shared/api/httpClient'

/** 쪼개기 요청 API(ADR-0035). 서버 모양은 pinit-monolith `TaskSplitController`와 같다. */
export type SplitStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'READY'
  | 'FAILED'
  | 'APPLIED'
  | 'DISCARDED'
  | 'EXPIRED'
  | 'CANCELLED'
export type SplitFailureReason =
  | 'PROVIDER_UNAVAILABLE'
  | 'PROPOSAL_UNUSABLE'
  | 'PROCESSING_TIMEOUT'
export type SplitQuota = {
  limit: number
  used: number
  remaining: number
  resetsAt: string
}
export type SplitSummary = {
  available: boolean
  consent: { currentVersion: string; consented: boolean; provider: string }
  quota: SplitQuota
  archiveCount: number
}
export type SplitRequestItem = {
  requestId: number
  taskId: number
  spaceId: number
  originalTitle: string | null
  status: SplitStatus
  failureReason: SplitFailureReason | null
  requestedAt: string
  readyAt: string | null
  expiresAt: string | null
  pieceCount: number | null
  excludedCount: number | null
  violationRemaining: boolean | null
  canApply: boolean | null
  cannotApplyReason: 'ADMIN_ONLY' | null
}
export type SplitInbox = { quota: SplitQuota; items: SplitRequestItem[] }

export const fetchSplitSummary = (signal?: AbortSignal) =>
  httpClient<SplitSummary>(buildApiUrl('/task-splits/summary', 'v2'), { signal })

export const saveSplitConsent = (disclosureVersion: string) =>
  httpClient<{ disclosureVersion: string; consentedAt: string }>(
    buildApiUrl('/task-splits/consent', 'v2'),
    { method: 'PUT', json: { disclosureVersion } },
  )

export const submitSplitRequest = (taskId: number) =>
  httpClient<{ request: SplitRequestItem; quota: SplitQuota }>(
    buildApiUrl('/task-splits', 'v2'),
    { method: 'POST', json: { taskId } },
  )

export const fetchSplitInbox = (signal?: AbortSignal) =>
  httpClient<SplitInbox>(buildApiUrl('/task-splits', 'v2'), { signal })

export const cancelSplitRequest = (requestId: number) =>
  httpClient<{ request: SplitRequestItem }>(
    buildApiUrl(`/task-splits/${requestId}/cancel`, 'v2'),
    { method: 'POST' },
  )

export const discardSplitRequest = (requestId: number) =>
  httpClient<{ request: SplitRequestItem; undoable: boolean }>(
    buildApiUrl(`/task-splits/${requestId}/discard`, 'v2'),
    { method: 'POST' },
  )
