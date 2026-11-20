import { buildApiUrl } from '@shared/api/config'
import { getRequestFailureMessage, readFailureMessage } from '@shared/api/errorMessage'
import { httpClient } from '@shared/api/httpClient'
import type { Limits } from '../model/editor'
import type { MindMapNode } from '../model/tree'

/** `GET /v2/mind-map`(ADR-0036 §5). `cursorNodeId`는 서버가 보정한 값이라 늘 나무에 있다. */
export type MindMapResponse = { version: number; root: MindMapNode; cursorNodeId: string; limits: Limits }
export type MindMapSaveRequest = { expectedVersion: number; saveId: string; root: MindMapNode }
/** 400 `ErrorResponse`의 `errors[i]`. 나무 규칙 위반이면 `nodeId`가 가지 id, `rule`이 규칙 이름이다. */
export type Violation = { nodeId: string; rule: string; reason: string }
export type SaveFailure =
  | { kind: 'conflict'; latestVersion: number; lastSaveId: string | null; message: string }
  | { kind: 'rejected'; message: string; violations: Violation[] }
  | { kind: 'lost'; message: string }

const MIND_MAP_URL = () => buildApiUrl('/mind-map', 'v2')
const SAVE_FAILED = '마인드맵을 저장하지 못했어요.'
const CONFLICT_FALLBACK = '다른 곳에서 마인드맵이 먼저 바뀌었어요. 최신 내용을 불러왔어요.'

export const fetchMindMap = (signal?: AbortSignal) =>
  httpClient<MindMapResponse>(MIND_MAP_URL(), { signal })

export const saveMindMap = (
  request: MindMapSaveRequest,
  options: { signal?: AbortSignal; keepalive?: boolean } = {},
) =>
  httpClient<{ version: number }>(MIND_MAP_URL(), {
    method: 'PUT',
    json: request,
    signal: options.signal,
    keepalive: options.keepalive,
  })

export const saveMindMapCursor = (nodeId: string, options: { keepalive?: boolean } = {}) =>
  httpClient<void>(buildApiUrl('/mind-map/cursor', 'v2'), {
    method: 'PUT',
    json: { nodeId },
    keepalive: options.keepalive,
  })

/** 서버가 답한 실패(ApiError)의 상태와 본문. ApiError는 다른 vm 컨텍스트에서 올 수 있어 `name`으로 가린다. */
const answered = (error: unknown): { status: number; body: Record<string, unknown> } | null => {
  if (!error || typeof error !== 'object') return null
  const { name, status, data } = error as { name?: unknown; status?: unknown; data?: unknown }
  if (name !== 'ApiError' || typeof status !== 'number') return null
  const body = data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : {}
  return { status, body }
}

const violationsOf = (errors: unknown): Violation[] =>
  Array.isArray(errors)
    ? errors.flatMap((entry: unknown) => {
        if (!entry || typeof entry !== 'object') return []
        const { field, rejectedValue, reason } = entry as Record<string, unknown>
        if (typeof field !== 'string') return []
        return [{
          nodeId: field,
          rule: typeof rejectedValue === 'string' ? rejectedValue : '',
          reason: typeof reason === 'string' ? reason : '',
        }]
      })
    : []

/**
 * 저장 실패를 저장기의 세 사건으로 가른다. 409 `VERSION_CONFLICT`만 충돌이다(최신을 받아들인다).
 * 400과 그 밖의 409(`MEMBER_WITHDRAWN`)는 거부, 응답이 없거나(status 0, 시간 초과·취소) 5xx면 잃은 저장이다.
 */
export const classifySaveError = (error: unknown): SaveFailure => {
  const response = answered(error)
  if (response?.status === 409 && response.body.code === 'VERSION_CONFLICT' && typeof response.body.latestVersion === 'number') {
    const { latestVersion, lastSaveId } = response.body
    return {
      kind: 'conflict',
      latestVersion,
      lastSaveId: typeof lastSaveId === 'string' ? lastSaveId : null,
      message: readFailureMessage(error) ?? CONFLICT_FALLBACK,
    }
  }
  if (response?.status === 400 || response?.status === 409) {
    return {
      kind: 'rejected',
      message: readFailureMessage(error) ?? SAVE_FAILED,
      violations: violationsOf(response.body.errors),
    }
  }
  return { kind: 'lost', message: getRequestFailureMessage(error, SAVE_FAILED) }
}
