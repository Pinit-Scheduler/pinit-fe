import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
import type { Task } from '../features/tasks/types/task'
import type {
  SplitLock,
  SplitLockStage,
  TaskSplitInfo,
} from '../features/task-split/api/taskSplitInfo'
import type {
  SplitFailureReason,
  SplitQuota,
  SplitRequestItem,
  SplitStatus,
} from '../features/task-split/api/splitRequests'
import { mockSchedules, mockTasks, nextScheduleId, nextTaskId } from './db'
import { mockCategoryOwnerId } from './categories'
import { effectiveExpectedMinutes } from './planner'
import {
  canSee,
  findSpace,
  memberOf,
  nicknameOf,
  placementOf,
  recordChange,
  setPlacement,
  spacePermissions,
} from './workspaceState'

dayjs.extend(utc)
dayjs.extend(timezone)

/**
 * `/v2/task-splits…` 개발용 모크(ADR-0035 S1~S4, S8, S9)와 작업 잠금.
 * 응답 모양과 문구는 서버 `TaskSplitController`, `SplitErrorMessages`를 따르고, 규칙은 화면 확인에 필요한 만큼의 근사다.
 * `workspace.ts`를 부르지 않는다(그쪽이 이 모듈을 불러 작업 응답에 `split`을 싣는다).
 * 제안·적용 같은 다른 쪼개기 모크는 이 모듈의 도우미(`requestOf`, `itemOf`, `splitFailure`, fixture)를 불러 쓴다.
 * 제안 상세·검사 경로는 `taskSplitProposal.ts`가 답한다(`handlers.ts`가 이 모듈보다 먼저 부른다).
 */

const ZONE_ID = 'Asia/Seoul'
const DISCLOSURE_VERSION = '1'
const PROVIDER = 'Anthropic'
const DEMO = 1
const TEAMMATE = 3

export type MockSplitRequest = {
  requestId: number
  memberId: number
  taskId: number
  spaceId: number
  originalTitle: string
  /** 저장 상태. 표시 상태는 itemOf가 만든다 */
  status: SplitStatus
  failureReason: SplitFailureReason | null
  requestedAt: string
  readyAt: string | null
  expiresAt: string | null
  pieceCount: number | null
  excludedCount: number | null
  violationRemaining: boolean | null
}

export type SplitFixtureKey =
  | 'ready'
  | 'queued'
  | 'running'
  | 'violation'
  | 'failed'
  | 'expired'
  | 'applied'
  | 'discarded'
  | 'cancelled'
  | 'adminOnly'
  | 'allExcluded'
  | 'otherProcessing'
  | 'otherReady'
  | 'free'
  | 'free2'
  | 'linked'

/** 서버 스위치·동의·오늘 쓴 횟수. 브라우저에서는 `__pinitMock.split.settings`로 바꾼다. */
export const mockSplitSettings = {
  available: true,
  consented: false,
  used: 1,
  limit: 3,
}
let consentedAt: string | null = null

export const mockSplitRequests: MockSplitRequest[] = []
export const mockSplitFixtures = {} as Record<
  SplitFixtureKey,
  { taskId: number; requestId: number | null }
>

let requestSeq = 0
const nextRequestId = () => ++requestSeq

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

const readJson = async <T>(request: Request): Promise<T | null> => {
  const raw = await request.text()
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

const nowIso = () => new Date().toISOString()
const isDone = (task: Task) => task.completed ?? task.isCompleted ?? false

// ---------------------------------------------------------------------------
// 오류 본문. 서버 `WorkspaceControllerAdvice.Error`와 같은 모양에 `split`을 더한다.
// ---------------------------------------------------------------------------

export const splitFailure = (
  code: string,
  message: string,
  status: number,
  split?: object,
) =>
  json(
    {
      code,
      message,
      resourceType: null,
      resourceId: null,
      latestVersion: null,
      split: split ?? null,
    },
    status,
  )

const MESSAGES = {
  unavailable: '지금은 작업 쪼개기를 쓸 수 없어요. 나중에 다시 시도해 주세요.',
  consentRequired: '작업 쪼개기를 쓰려면 먼저 안내를 확인하고 동의해 주세요.',
  consentOutdated: '안내 내용이 바뀌었어요. 새 안내를 확인하고 다시 동의해 주세요.',
  targetNotFound: '쪼갤 작업을 찾을 수 없어요. 이미 삭제됐거나 접근할 수 없는 작업일 수 있어요.',
  notEligible: '이 작업은 쪼갤 수 없어요. 안내된 이유를 확인해 주세요.',
  alreadyInProgressMine: '이미 이 작업의 쪼개기 요청이 진행 중이에요.',
  quotaExceeded: '오늘 쓸 수 있는 쪼개기 횟수를 모두 썼어요. 내일 다시 시도해 주세요.',
  requestNotFound: '쪼개기 요청을 찾을 수 없어요. 이미 정리됐을 수 있어요.',
  stateChanged: '요청의 상태가 바뀌어 처리할 수 없어요. 최신 상태를 확인해 주세요.',
}

const lockedMine = (stage: SplitLockStage) =>
  stage === 'PROPOSAL_READY'
    ? '쪼개기 제안을 정리한 뒤 바꿔 주세요.'
    : '쪼개기 요청이 처리 중이라 바꿀 수 없어요. 요청을 취소하거나 제안이 준비된 뒤 정리해 주세요.'

const lockedByOther = (nickname: string | null, stage: SplitLockStage) => {
  const name = nickname?.trim() ? nickname : '다른 참여자'
  return stage === 'PROPOSAL_READY'
    ? `${name}님이 쪼개기 제안을 받아 바꿀 수 없어요.`
    : `${name}님이 쪼개는 중이라 바꿀 수 없어요.`
}

const requestNotFound = () =>
  splitFailure('SPLIT_REQUEST_NOT_FOUND', MESSAGES.requestNotFound, 404)
const stateChanged = (currentStatus: SplitStatus) =>
  splitFailure('SPLIT_REQUEST_STATE_CHANGED', MESSAGES.stateChanged, 409, {
    currentStatus,
  })

// ---------------------------------------------------------------------------
// 상태와 잠금
// ---------------------------------------------------------------------------

/** 준비됨인데 만료 시각이 지났으면 만료로 보인다. */
const displayStatusOf = (request: MockSplitRequest): SplitStatus =>
  request.status === 'READY' &&
  request.expiresAt !== null &&
  Date.parse(request.expiresAt) <= Date.now()
    ? 'EXPIRED'
    : request.status

const lockStageOf = (request: MockSplitRequest): SplitLockStage | null => {
  if (request.status === 'QUEUED' || request.status === 'RUNNING') return 'PROCESSING'
  return displayStatusOf(request) === 'READY' ? 'PROPOSAL_READY' : null
}

const activeRequestFor = (taskId: number) =>
  mockSplitRequests.find(
    (request) => request.taskId === taskId && lockStageOf(request) !== null,
  )

export const lockOf = (actor: number, taskId: number): SplitLock | null => {
  const request = activeRequestFor(taskId)
  if (!request) return null
  const stage = lockStageOf(request)!
  const mine = request.memberId === actor
  return {
    stage,
    mine,
    requestId: mine ? request.requestId : null,
    requestStatus: mine
      ? (request.status as 'QUEUED' | 'RUNNING' | 'READY')
      : null,
    requesterNickname: mine ? null : nicknameOf(request.memberId),
  }
}

export const splitLockFailure = (actor: number, taskId: number): Response | null => {
  const lock = lockOf(actor, taskId)
  if (!lock) return null
  return lock.mine
    ? splitFailure('TASK_LOCKED_BY_SPLIT', lockedMine(lock.stage), 409, {
        requestId: lock.requestId,
        lockStage: lock.stage,
      })
    : splitFailure(
        'TASK_LOCKED_BY_SPLIT',
        lockedByOther(lock.requesterNickname, lock.stage),
        409,
        { requesterNickname: lock.requesterNickname, lockStage: lock.stage },
      )
}

const canDeleteIn = (actor: number, spaceId: number) => {
  const space = findSpace(spaceId)
  return Boolean(space && spacePermissions(actor, space, false).allowedActions.delete)
}

/** 잠금을 뺀 대상 이유. 서버 `SplitEligibility`의 순서를 따른다. */
const targetReasonsOf = (actor: number, task: Task) => {
  const reasons: string[] = []
  if (isDone(task)) reasons.push('TASK_COMPLETED')
  if (task.recurrence) reasons.push('RECURRING_TASK')
  // 서버는 요청하는 회원 본인의 일정만 본다(`findAllByOwnerIdAndTaskIdIn(actor, …)`).
  if (mockSchedules.some((schedule) => schedule.taskId === task.id && schedule.ownerId === actor))
    reasons.push('HAS_LINKED_SCHEDULE')
  if (!canDeleteIn(actor, placementOf('task', task.id).spaceId)) reasons.push('ADMIN_ONLY')
  return reasons
}

export const splitViewOf = (actor: number, task: Task): TaskSplitInfo => {
  const lock = lockOf(actor, task.id)
  const cannotRequestReasons = targetReasonsOf(actor, task)
  if (lock) cannotRequestReasons.push('SPLIT_IN_PROGRESS')
  return {
    recommended: effectiveExpectedMinutes(task) >= 240,
    canRequest: cannotRequestReasons.length === 0,
    cannotRequestReasons,
    lock,
  }
}

/** 본인 요청이고 원본 스페이스에 접근할 수 있을 때만. */
export const requestOf = (actor: number, requestId: number): MockSplitRequest | null => {
  const request = mockSplitRequests.find((item) => item.requestId === requestId)
  if (!request || request.memberId !== actor) return null
  const space = findSpace(request.spaceId)
  return space && memberOf(space, actor) ? request : null
}

/**
 * 제안 모크(`taskSplitProposal.ts`)가 불릴 때 채우는 연결. 이 모듈은 그 모듈을 import하지 않는다(그쪽이 이 모듈을 부른다).
 * `countsOf`: 저장된 제안이 있으면 만들 조각·뺀 조각 수. `onReady`: `finishMockSplit`이 준비됨으로 만든 요청.
 */
type ProposalHooks = {
  countsOf: (requestId: number) => { pieceCount: number; excludedCount: number } | null
  onReady: (request: MockSplitRequest) => void
}
let proposalHooks: ProposalHooks | null = null
export const registerMockSplitProposals = (hooks: ProposalHooks) => {
  proposalHooks = hooks
}

export const itemOf = (request: MockSplitRequest): SplitRequestItem => {
  const status = displayStatusOf(request)
  const canApply = status === 'READY' ? canDeleteIn(request.memberId, request.spaceId) : null
  const counts = proposalHooks?.countsOf(request.requestId) ?? null
  return {
    requestId: request.requestId,
    taskId: request.taskId,
    spaceId: request.spaceId,
    originalTitle: request.originalTitle,
    status,
    failureReason: request.failureReason,
    requestedAt: request.requestedAt,
    readyAt: request.readyAt,
    expiresAt: request.expiresAt,
    pieceCount: counts ? counts.pieceCount : request.pieceCount,
    excludedCount: counts ? counts.excludedCount : request.excludedCount,
    violationRemaining: request.violationRemaining,
    canApply,
    cannotApplyReason: canApply === false ? 'ADMIN_ONLY' : null,
  }
}

const quotaOf = (): SplitQuota => ({
  limit: mockSplitSettings.limit,
  used: mockSplitSettings.used,
  remaining: Math.max(0, mockSplitSettings.limit - mockSplitSettings.used),
  resetsAt: dayjs().tz(ZONE_ID).add(1, 'day').startOf('day').toISOString(),
})

const INBOX_STATUSES: SplitStatus[] = ['QUEUED', 'RUNNING', 'READY', 'FAILED']

const inboxOf = (actor: number) =>
  mockSplitRequests
    .filter(
      (request) =>
        requestOf(actor, request.requestId) !== null &&
        INBOX_STATUSES.includes(displayStatusOf(request)),
    )
    .sort((a, b) => Date.parse(b.requestedAt) - Date.parse(a.requestedAt))
    .map(itemOf)

/** 다른 화면의 잠금 표시를 갱신하는 변경 기록. 서버처럼 요청 회원이 actor다. */
const recordSplitChange = (request: MockSplitRequest) => {
  const task = mockTasks.find((item) => item.id === request.taskId)
  recordChange({
    spaceId: request.spaceId,
    actorId: request.memberId,
    resourceType: 'TASK',
    resourceId: request.taskId,
    version: task ? placementOf('task', task.id).version : 1,
    action: 'SPLIT_CHANGED',
  })
}

const submitted = new Set<(requestId: number) => void>()

/** 새 접수를 알린다. 브라우저의 `mockServer.ts`가 자동 완료 타이머를 건다. 이 모듈은 타이머를 만들지 않는다. */
export const onMockSplitSubmitted = (listener: (requestId: number) => void) => {
  submitted.add(listener)
}

const finished = new Set<(request: MockSplitRequest) => void>()

/** 처리가 끝난 요청(준비됨·실패)을 알린다. 알림함 mock이 알림을 넣는 데 쓴다. 이 모듈은 알림함을 import하지 않는다. */
export const onMockSplitFinished = (listener: (request: MockSplitRequest) => void): void => {
  finished.add(listener)
}

/** 처리 중인 요청을 끝낸다. 준비됨이면 제안도 함께 만든다. 실패와 위반 남음은 서버처럼 쓴 횟수를 돌려준다. */
export const finishMockSplit = (
  requestId: number,
  outcome: 'READY' | 'READY_WITH_VIOLATION' | 'FAILED',
) => {
  const request = mockSplitRequests.find((item) => item.requestId === requestId)
  if (!request || (request.status !== 'QUEUED' && request.status !== 'RUNNING')) return
  if (outcome === 'FAILED') {
    request.status = 'FAILED'
    request.failureReason = 'PROVIDER_UNAVAILABLE'
  } else {
    request.status = 'READY'
    request.readyAt = nowIso()
    request.expiresAt = dayjs().add(7, 'day').toISOString()
    request.pieceCount = 4
    request.excludedCount = 0
    request.violationRemaining = outcome === 'READY_WITH_VIOLATION'
    proposalHooks?.onReady(request)
  }
  if (outcome !== 'READY') mockSplitSettings.used = Math.max(0, mockSplitSettings.used - 1)
  recordSplitChange(request)
  finished.forEach((listener) => listener(request))
}

// ---------------------------------------------------------------------------
// 경로
// ---------------------------------------------------------------------------

const summary = (actor: number) =>
  json({
    available: mockSplitSettings.available,
    consent: {
      currentVersion: DISCLOSURE_VERSION,
      consented: mockSplitSettings.consented,
      provider: PROVIDER,
    },
    quota: quotaOf(),
    archiveCount: inboxOf(actor).length,
  })

const consent = async (request: Request) => {
  const body = await readJson<{ disclosureVersion?: string }>(request)
  if (body?.disclosureVersion !== DISCLOSURE_VERSION)
    return splitFailure('SPLIT_CONSENT_OUTDATED', MESSAGES.consentOutdated, 409, {
      currentDisclosureVersion: DISCLOSURE_VERSION,
    })
  if (!mockSplitSettings.consented || !consentedAt) consentedAt = nowIso()
  mockSplitSettings.consented = true
  return json({ disclosureVersion: DISCLOSURE_VERSION, consentedAt })
}

const submit = async (actor: number, request: Request) => {
  const body = await readJson<{ taskId?: number }>(request)
  if (!mockSplitSettings.available)
    return splitFailure('SPLIT_UNAVAILABLE', MESSAGES.unavailable, 503)
  if (!mockSplitSettings.consented)
    return splitFailure('SPLIT_CONSENT_REQUIRED', MESSAGES.consentRequired, 409, {
      currentDisclosureVersion: DISCLOSURE_VERSION,
    })
  const taskId = Number(body?.taskId)
  const task = mockTasks.find((item) => item.id === taskId)
  if (!task || !canSee(actor, placementOf('task', task.id)))
    return splitFailure('SPLIT_TARGET_NOT_FOUND', MESSAGES.targetNotFound, 404)
  const reasons = targetReasonsOf(actor, task)
  if (reasons.length)
    return splitFailure('SPLIT_NOT_ELIGIBLE', MESSAGES.notEligible, 422, { reasons })
  const active = activeRequestFor(task.id)
  if (active) {
    const stage = lockStageOf(active)!
    return active.memberId === actor
      ? splitFailure('SPLIT_ALREADY_IN_PROGRESS', MESSAGES.alreadyInProgressMine, 409, {
          requestId: active.requestId,
        })
      : splitFailure(
          'SPLIT_ALREADY_IN_PROGRESS',
          lockedByOther(nicknameOf(active.memberId), stage),
          409,
          { requesterNickname: nicknameOf(active.memberId), lockStage: stage },
        )
  }
  if (mockSplitSettings.used >= mockSplitSettings.limit) {
    const quota = quotaOf()
    return splitFailure('SPLIT_QUOTA_EXCEEDED', MESSAGES.quotaExceeded, 429, {
      quotaLimit: quota.limit,
      quotaResetsAt: quota.resetsAt,
    })
  }
  // 만료 시각이 지난 준비됨은 새 요청 전에 만료로 바꾼다(서버 `releaseExpiredOrReject`). 서버는 이것과 한도 차감이
  // 한 트랜잭션이라 한도로 거부되면 함께 되돌아간다. mock은 한도를 먼저 본다.
  for (const stale of mockSplitRequests)
    if (stale.taskId === task.id && stale.status === 'READY' && displayStatusOf(stale) === 'EXPIRED') {
      stale.status = 'EXPIRED'
      recordSplitChange(stale)
    }
  const created: MockSplitRequest = {
    requestId: nextRequestId(),
    memberId: actor,
    taskId: task.id,
    spaceId: placementOf('task', task.id).spaceId,
    originalTitle: task.title,
    status: 'QUEUED',
    failureReason: null,
    requestedAt: nowIso(),
    readyAt: null,
    expiresAt: null,
    pieceCount: null,
    excludedCount: null,
    violationRemaining: null,
  }
  mockSplitRequests.push(created)
  mockSplitSettings.used += 1
  recordSplitChange(created)
  submitted.forEach((listener) => listener(created.requestId))
  return json({ request: itemOf(created), quota: quotaOf() }, 201)
}

const cancel = (request: MockSplitRequest) => {
  if (request.status === 'QUEUED' || request.status === 'RUNNING') {
    request.status = 'CANCELLED'
    recordSplitChange(request)
  } else {
    const shown = displayStatusOf(request)
    if (shown === 'READY' || shown === 'FAILED') return stateChanged(shown)
  }
  return json({ request: itemOf(request) })
}

const discard = (request: MockSplitRequest) => {
  if (request.status === 'QUEUED' || request.status === 'RUNNING')
    return stateChanged(request.status)
  let undoable = false
  if (request.status === 'READY') {
    if (displayStatusOf(request) === 'EXPIRED') request.status = 'EXPIRED'
    else {
      request.status = 'DISCARDED'
      undoable = true
    }
    recordSplitChange(request)
  } else if (request.status === 'FAILED') {
    request.status = 'DISCARDED'
    recordSplitChange(request)
  }
  return json({ request: itemOf(request), undoable })
}

const SPLIT_PATH = /^\/v2\/task-splits(?:\/|$)/

export const handleTaskSplits = async (
  path: string,
  method: string,
  request: Request,
): Promise<Response | null> => {
  if (!SPLIT_PATH.test(path)) return null
  const actor = mockCategoryOwnerId(request)
  if (!actor) return json({ message: '로그인이 필요합니다.' }, 401)

  if (path === '/v2/task-splits/summary' && method === 'GET') return summary(actor)
  if (path === '/v2/task-splits/consent' && method === 'PUT') return consent(request)
  if (path === '/v2/task-splits') {
    if (method === 'GET') return json({ quota: quotaOf(), items: inboxOf(actor) })
    if (method === 'POST') return submit(actor, request)
    return null
  }
  const command = path.match(/^\/v2\/task-splits\/(\d+)\/(cancel|discard)$/)
  if (command && method === 'POST') {
    const found = requestOf(actor, Number(command[1]))
    if (!found) return requestNotFound()
    return command[2] === 'cancel' ? cancel(found) : discard(found)
  }
  return null
}

// ---------------------------------------------------------------------------
// fixture. 불러올 때 한 번 만들고, 시각은 지금을 기준으로 잡는다.
// ---------------------------------------------------------------------------

type FixtureRequest = Partial<Omit<MockSplitRequest, 'requestId' | 'taskId' | 'spaceId' | 'originalTitle'>> & {
  status: SplitStatus
  requestedAgoMinutes: number
}
type Fixture = {
  key: SplitFixtureKey
  title: string
  expectedDuration: string | null
  spaceId: number
  projectId: number | null
  due: number
  /** 원본이 이미 사라진 요청(적용됨) */
  removed?: boolean
  linkedScheduleInDays?: number
  request?: FixtureRequest
}

const ago = (minutes: number) => dayjs().subtract(minutes, 'minute').toISOString()
const later = (minutes: number) => dayjs().add(minutes, 'minute').toISOString()
const HOUR = 60
const DAY = 24 * HOUR

const fixtures: Fixture[] = [
  // 준비됨 예시의 조각 마감(내일~6일 뒤)이 원본 마감 안에 들도록 원본 마감을 6일 뒤로 둔다.
  { key: 'ready', title: '온보딩 개편 설계', expectedDuration: 'PT8H', spaceId: -1, projectId: null, due: 6,
    request: { status: 'READY', requestedAgoMinutes: 38, readyAt: ago(35), expiresAt: later(6 * DAY), pieceCount: 5, excludedCount: 2, violationRemaining: false } },
  { key: 'queued', title: '결제 모듈 이관', expectedDuration: 'PT5H', spaceId: -1, projectId: null, due: 8,
    request: { status: 'QUEUED', requestedAgoMinutes: 3 } },
  { key: 'running', title: '검색 색인 다시 만들기', expectedDuration: 'PT6H', spaceId: -1, projectId: null, due: 10,
    request: { status: 'RUNNING', requestedAgoMinutes: 10 } },
  { key: 'violation', title: '데이터 이전 리허설', expectedDuration: 'PT12H', spaceId: -1, projectId: null, due: 12,
    request: { status: 'READY', requestedAgoMinutes: 2 * HOUR + 5, readyAt: ago(2 * HOUR), expiresAt: later(7 * DAY - 2 * HOUR), pieceCount: 3, excludedCount: 0, violationRemaining: true } },
  { key: 'failed', title: '연말 회고 자료', expectedDuration: 'PT4H30M', spaceId: -1, projectId: null, due: 14,
    request: { status: 'FAILED', requestedAgoMinutes: 23 * HOUR, failureReason: 'PROVIDER_UNAVAILABLE' } },
  { key: 'expired', title: '분기 목표 초안', expectedDuration: 'PT5H', spaceId: -1, projectId: null, due: 11,
    request: { status: 'READY', requestedAgoMinutes: 7 * DAY + HOUR + 5, readyAt: ago(7 * DAY + HOUR), expiresAt: ago(HOUR), pieceCount: 3, excludedCount: 0, violationRemaining: false } },
  { key: 'applied', title: '블로그 이전', expectedDuration: null, spaceId: -1, projectId: null, due: 6, removed: true,
    request: { status: 'APPLIED', requestedAgoMinutes: 3 * DAY, readyAt: ago(3 * DAY - 5), expiresAt: later(4 * DAY), pieceCount: 4, excludedCount: 0, violationRemaining: false } },
  { key: 'discarded', title: '사진 정리', expectedDuration: 'PT4H', spaceId: -1, projectId: null, due: 13,
    request: { status: 'DISCARDED', requestedAgoMinutes: 2 * DAY, readyAt: ago(2 * DAY - 5), expiresAt: later(5 * DAY), pieceCount: 3, excludedCount: 1, violationRemaining: false } },
  { key: 'cancelled', title: '세금 서류 모으기', expectedDuration: 'PT4H', spaceId: -1, projectId: null, due: 15,
    request: { status: 'CANCELLED', requestedAgoMinutes: DAY + 2 * HOUR } },
  { key: 'adminOnly', title: '12월 발제문 쓰기', expectedDuration: 'PT5H', spaceId: 3, projectId: 31, due: 16,
    request: { status: 'READY', requestedAgoMinutes: 5 * HOUR, readyAt: ago(5 * HOUR - 4), expiresAt: later(7 * DAY - 5 * HOUR), pieceCount: 3, excludedCount: 0, violationRemaining: false } },
  { key: 'allExcluded', title: '릴리즈 회고 준비', expectedDuration: 'PT4H', spaceId: -1, projectId: null, due: 9,
    request: { status: 'READY', requestedAgoMinutes: 7 * HOUR, readyAt: ago(7 * HOUR - 4), expiresAt: later(7 * DAY - 7 * HOUR), pieceCount: 0, excludedCount: 3, violationRemaining: false } },
  { key: 'otherProcessing', title: '결제 화면 리팩터링', expectedDuration: 'PT6H', spaceId: 2, projectId: 21, due: 10,
    request: { status: 'RUNNING', requestedAgoMinutes: 6, memberId: TEAMMATE } },
  { key: 'otherReady', title: '12월 로드맵 초안', expectedDuration: 'PT5H', spaceId: 2, projectId: 21, due: 12,
    request: { status: 'READY', requestedAgoMinutes: 3 * HOUR, readyAt: ago(3 * HOUR - 4), expiresAt: later(7 * DAY - 3 * HOUR), pieceCount: 3, excludedCount: 0, violationRemaining: false, memberId: TEAMMATE } },
  { key: 'free', title: '사내 위키 이전 계획', expectedDuration: 'PT6H', spaceId: -1, projectId: null, due: 10 },
  { key: 'free2', title: '여행 계획 세우기', expectedDuration: 'PT5H', spaceId: -1, projectId: null, due: 13 },
  { key: 'linked', title: '이사 준비', expectedDuration: 'PT5H', spaceId: -1, projectId: null, due: 11, linkedScheduleInDays: 3 },
]

const dueIn = (days: number) => {
  const base = dayjs().tz(ZONE_ID).add(days, 'day').startOf('day')
  return { date: base.format('YYYY-MM-DD'), zoneId: ZONE_ID, offset: base.format('Z') }
}

const seedFixtures = () => {
  for (const fixture of fixtures) {
    const memberId = fixture.request?.memberId ?? DEMO
    const taskId = nextTaskId()
    if (!fixture.removed) {
      const task: Task = {
        id: taskId,
        ownerId: memberId,
        title: fixture.title,
        description: '',
        dueDate: dueIn(fixture.due),
        importance: 6,
        difficulty: 5,
        expectedDuration: fixture.expectedDuration,
        completed: false,
        isCompleted: false,
        inboundDependencyCount: 0,
        previousTaskIds: [],
        nextTaskIds: [],
        createdAt: ago(10 * DAY),
        updatedAt: ago(DAY),
      }
      mockTasks.push(task)
      setPlacement('task', taskId, {
        spaceId: fixture.spaceId,
        projectId: fixture.projectId,
        assigneeId: memberId,
        version: 1,
      })
    }
    if (fixture.linkedScheduleInDays !== undefined) {
      const scheduleId = nextScheduleId()
      mockSchedules.push({
        id: scheduleId,
        ownerId: memberId,
        title: fixture.title,
        description: '',
        date: {
          dateTime: dayjs()
            .tz(ZONE_ID)
            .add(fixture.linkedScheduleInDays, 'day')
            .hour(10)
            .minute(0)
            .second(0)
            .format('YYYY-MM-DDTHH:mm:ss'),
          zoneId: ZONE_ID,
        },
        scheduleType: 'DEEP_WORK',
        state: 'NOT_STARTED',
        taskId,
        duration: 'PT0S',
        plannedDuration: 'PT2H',
      })
      setPlacement('schedule', scheduleId, {
        spaceId: fixture.spaceId,
        projectId: fixture.projectId,
        assigneeId: memberId,
        version: 1,
      })
    }
    let requestId: number | null = null
    if (fixture.request) {
      const { requestedAgoMinutes, ...rest } = fixture.request
      requestId = nextRequestId()
      mockSplitRequests.push({
        requestId,
        memberId,
        taskId,
        spaceId: fixture.spaceId,
        originalTitle: fixture.title,
        failureReason: null,
        readyAt: null,
        expiresAt: null,
        pieceCount: null,
        excludedCount: null,
        violationRemaining: null,
        ...rest,
        requestedAt: ago(requestedAgoMinutes),
      })
    }
    mockSplitFixtures[fixture.key] = { taskId, requestId }
  }
}
seedFixtures()
