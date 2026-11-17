import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
import type { Task } from '../features/tasks/types/task'
import type {
  DraftPiece,
  SplitCheck,
  SplitDraftAction,
  SplitPiece,
  SplitProposalView,
} from '../features/task-split/api/splitProposals'
import { mockSchedules, mockTasks, nextTaskId } from './db'
import { mockCategoryOwnerId } from './categories'
import { effectiveExpectedMinutes } from './planner'
import {
  itemOf,
  lockOf,
  mockSplitFixtures,
  mockSplitRequests,
  registerMockSplitProposals,
  requestOf,
  splitFailure,
  splitViewOf,
  type MockSplitRequest,
  type SplitFixtureKey,
} from './taskSplit'
import { computeSplitCheck, type StoredExclusion } from './taskSplitCheck'
import { recomputeMockTaskReadiness } from './taskDependencies'
import { moveTaskToTrash, restoreTaskFromTrash, trashedTaskOf } from './trash'
import {
  bumpVersion,
  findSpace,
  memberOf,
  placementOf,
  recordChange,
  setPlacement,
  spacePermissions,
} from './workspaceState'

dayjs.extend(utc)
dayjs.extend(timezone)

/**
 * 쪼개기 제안 상세(S5)와 초안 검사(S6)의 개발용 모크. 응답 모양과 문구는 서버 `SplitProposalService`·`SplitDraftService`·
 * `SplitErrorMessages`를 따른다. 검사는 저장하지 않는다.
 * fixture 제안은 처음 읽을 때 만든다(`taskSplit.ts`의 fixture가 다 만들어진 뒤).
 * 만들기(S7)는 서버 `SplitApplyService`·`SplitApplyWriter`·`SplitInheritance`를, 만들기·버리기 되돌리기(S10·S11)는
 * ADR-0035 §13과 백엔드 X5 계획의 계약을 따른다.
 */

const ZONE_ID = 'Asia/Seoul'
const MAX_PIECES = 50
const FACTORS: Record<string, number> = { 1: 1, 2: 1, 3: 1.1, 5: 1.2, 8: 1.3, 13: 1.4, 21: 1.5 }

const MESSAGES = {
  requestNotFound: '쪼개기 요청을 찾을 수 없어요. 이미 정리됐을 수 있어요.',
  notReady: '지금은 이 제안을 쓸 수 없어요. 보관함에서 상태를 확인해 주세요.',
  invalidPieces: '조각 구성이 제안과 달라요. 제안을 다시 열어 확인해 주세요.',
  invalidRequest: '입력한 내용을 다시 확인해 주세요.',
  unreadableBody: '요청을 처리하지 못했어요. 화면을 새로고침한 뒤 다시 시도해 주세요.',
  notEligible: '이 작업은 쪼갤 수 없어요. 안내된 이유를 확인해 주세요.',
  nothingSelected: '적용할 조각을 하나 이상 선택해 주세요.',
  invalidPiecesCheck: '고칠 곳이 있어요. 표시된 조각을 확인해 주세요.',
  undoNotAvailable: '더 이상 되돌릴 수 없어요.',
  /** 서버 `DependencyErrorMessages.CYCLE`(`STATE_CONFLICT`로 나간다). */
  cycle: '이렇게 연결하면 선행 작업 순서가 순환해요. 연결할 작업을 다시 골라 주세요.',
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
/** 서버 `WorkspaceDomainControllerAdvice`의 400 본문. */
const invalidRequest = (message = MESSAGES.invalidRequest) =>
  json({ code: 'INVALID_REQUEST', message }, 400)

const todayInSeoul = () => dayjs().tz(ZONE_ID).format('YYYY-MM-DD')
const day = (offset: number) => dayjs().tz(ZONE_ID).add(offset, 'day').format('YYYY-MM-DD')

const text = (purpose: string, reason: string, how: string[], done: string) =>
  `목적\n${purpose}\n\n이유\n${reason}\n\n진행 방법\n${how.map((line, i) => `${i + 1}. ${line}`).join('\n')}\n\n완료 기준\n${done}`

type PieceSeed = Omit<SplitPiece, 'selected' | 'dueDateAdjusted' | 'exclusion'> & {
  exclusion?: StoredExclusion
}

const pieceOf = ({ exclusion, ...seed }: PieceSeed): SplitPiece => ({
  ...seed,
  selected: !exclusion,
  dueDateAdjusted: false,
  exclusion: exclusion ?? null,
})

/** 시안 `onboardingProposal()`의 조각. */
const onboardingPieces = (): PieceSeed[] => [
  {
    key: 'a',
    title: '현재 온보딩 흐름 정리',
    description: text(
      '지금 온보딩의 화면과 단계를 한 장으로 그린다.',
      '개편안이 무엇을 바꾸는지 비교할 기준이 필요하다.',
      [
        '가입부터 첫 일정 등록까지 화면을 순서대로 캡처한다',
        '단계마다 사용자가 해야 하는 입력을 적는다',
        '한 장짜리 흐름도로 묶는다',
      ],
      '흐름도 한 장과 단계별 입력 목록이 있다.',
    ),
    minutes: 60,
    difficulty: 3,
    dueDate: day(1),
    after: [],
  },
  {
    key: 'b',
    title: '이탈 구간 데이터 뽑기',
    description: text(
      '첫 주에 어느 단계에서 사람들이 떠나는지 숫자로 확인한다.',
      '감이 아니라 가장 많이 떠나는 단계부터 고치기 위해서다.',
      ['최근 4주 가입자의 단계별 도달률을 뽑는다', '도달률이 가장 크게 떨어지는 두 구간을 표시한다'],
      '단계별 도달률 표와 이탈이 큰 두 구간이 정리돼 있다.',
    ),
    minutes: 90,
    difficulty: 5,
    dueDate: day(2),
    after: [],
  },
  {
    key: 'c',
    title: '개편안 스케치 3종',
    description: text(
      '이탈이 큰 두 구간을 줄이는 서로 다른 안 세 가지를 그린다.',
      '한 가지 안만 그리면 비교 없이 결정하게 된다.',
      [
        '구간마다 줄일 입력과 미룰 입력을 정한다',
        '안마다 화면 흐름을 손으로 그린다',
        '안마다 장단점을 세 줄로 적는다',
      ],
      '세 안의 화면 흐름과 장단점이 한 문서에 있다.',
    ),
    minutes: 150,
    difficulty: 8,
    dueDate: day(3),
    after: ['a', 'b'],
  },
  {
    key: 'd',
    title: '팀 리뷰 받기',
    description: text(
      '세 안을 팀에 보여 주고 하나를 고른다.',
      '구현 비용과 일정은 혼자 판단하기 어렵다.',
      ['30분 리뷰 자리를 잡는다', '안마다 구현 비용 의견을 받는다', '고른 안과 이유를 적는다'],
      '고른 안 하나와 고른 이유가 기록돼 있다.',
    ),
    minutes: 60,
    difficulty: 2,
    dueDate: day(4),
    after: ['c'],
  },
  {
    key: 'e',
    title: '최종안 문서화',
    description: text(
      '고른 안을 구현할 수 있는 설계 문서로 정리한다.',
      '원래 작업의 결과물이 이 문서다.',
      ['화면별 요구사항을 적는다', '측정할 지표와 목표값을 정한다', '리뷰 의견을 반영한다'],
      '화면별 요구사항과 목표 지표가 담긴 문서가 공유돼 있다.',
    ),
    minutes: 120,
    difficulty: 5,
    dueDate: day(6),
    after: ['d'],
  },
  {
    key: 'x1',
    title: '경쟁 앱 온보딩 조사',
    description: text(
      '비슷한 앱 세 곳의 온보딩을 비교한다.',
      '참고할 패턴을 찾기 위해서다.',
      ['앱 세 곳의 가입 흐름을 캡처한다', '공통 패턴을 정리한다'],
      '비교 표가 있다.',
    ),
    minutes: 90,
    difficulty: 3,
    dueDate: day(1),
    after: [],
    exclusion: { reason: 'ALREADY_DONE', evidenceTaskId: 3, evidenceTitle: '경쟁 앱 온보딩 벤치마크' },
  },
  {
    key: 'x2',
    title: '온보딩 문구 초안',
    description: text(
      '새 흐름의 안내 문구를 쓴다.',
      '화면 설계와 문구를 같이 봐야 한다.',
      ['단계별 제목과 설명을 쓴다'],
      '단계별 문구 초안이 있다.',
    ),
    minutes: 60,
    difficulty: 3,
    dueDate: day(5),
    after: ['d'],
    exclusion: { reason: 'DUPLICATES_OPEN', evidenceTaskId: 1, evidenceTitle: '온보딩 문구 다듬기' },
  },
]

/** 위반이 남은 제안: 한 줄로 이어진 세 조각 가운데 조각이 보정 후 360분이다. */
const violationPieces = (): PieceSeed[] => [
  {
    key: 'v1',
    title: '리허설 환경 준비',
    description: text(
      '운영과 같은 구성의 리허설 환경을 만든다.',
      '운영 데이터로 바로 연습하면 되돌릴 수 없다.',
      ['운영 구성표를 확인한다', '리허설용 데이터베이스를 띄운다'],
      '리허설 환경에 접속해 데이터를 넣을 수 있다.',
    ),
    minutes: 120,
    difficulty: 3,
    dueDate: day(3),
    after: [],
  },
  {
    key: 'v2',
    title: '데이터 이전 실행',
    description: text(
      '이전 스크립트로 전체 데이터를 옮긴다.',
      '실제 걸리는 시간과 막히는 곳을 미리 알아야 한다.',
      ['이전 스크립트를 실행한다', '단계별 걸린 시간을 적는다', '실패한 단계를 다시 돌린다'],
      '전체 데이터가 옮겨졌고 단계별 시간이 기록돼 있다.',
    ),
    minutes: 300,
    difficulty: 5,
    dueDate: day(7),
    after: ['v1'],
  },
  {
    key: 'v3',
    title: '이전 결과 검증',
    description: text(
      '옮긴 데이터가 원본과 같은지 확인한다.',
      '빠진 데이터가 있으면 실제 이전 전에 고쳐야 한다.',
      ['표마다 행 수를 비교한다', '표본 행의 값을 비교한다'],
      '차이가 없거나 차이의 원인이 정리돼 있다.',
    ),
    minutes: 180,
    difficulty: 3,
    dueDate: day(10),
    after: ['v2'],
  },
]

/** 모두 빠진 제안: 세 조각 모두 이미 했거나 열린 작업과 겹친다. */
const allExcludedPieces = (): PieceSeed[] => [
  {
    key: 'r1',
    title: '회고 질문 목록 만들기',
    description: text(
      '회고에서 다룰 질문을 정한다.',
      '질문이 없으면 회고가 잡담으로 끝난다.',
      ['지난 회고 질문을 모은다', '이번 릴리즈에 맞게 고친다'],
      '질문 목록이 공유돼 있다.',
    ),
    minutes: 60,
    difficulty: 2,
    dueDate: day(2),
    after: [],
    exclusion: { reason: 'ALREADY_DONE', evidenceTaskId: 2, evidenceTitle: '회고 질문 다듬기' },
  },
  {
    key: 'r2',
    title: '릴리즈 지표 모으기',
    description: text(
      '이번 릴리즈의 장애·배포 지표를 모은다.',
      '회고에서 숫자를 보고 이야기하기 위해서다.',
      ['배포 횟수와 장애 건수를 뽑는다', '표 하나로 정리한다'],
      '지표 표가 있다.',
    ),
    minutes: 90,
    difficulty: 3,
    dueDate: day(4),
    after: ['r1'],
    exclusion: { reason: 'DUPLICATES_OPEN', evidenceTaskId: 1, evidenceTitle: '릴리즈 지표 정리' },
  },
  {
    key: 'r3',
    title: '회고 자리 잡기',
    description: text(
      '참석자 일정을 맞춰 회고 시간을 잡는다.',
      '모두가 모일 수 있는 시간이 필요하다.',
      ['참석자 일정을 확인한다', '초대를 보낸다'],
      '회고 일정 초대가 나가 있다.',
    ),
    minutes: 30,
    difficulty: 1,
    dueDate: day(6),
    after: ['r2'],
    exclusion: { reason: 'ALREADY_DONE', evidenceTaskId: 3, evidenceTitle: '회고 일정 공지' },
  },
]

/** 시안 `genericProposal()`: 예상 시간을 고르게 나눈 2~4조각을 원본 마감까지 나눠 둔다. */
const GENERIC_STEPS = ['자료 모으기', '뼈대 잡기', '본문 채우기', '검토하고 다듬기']
const genericPieces = (
  title: string,
  minutes: number,
  due: string,
  count = Math.min(GENERIC_STEPS.length, Math.max(2, Math.ceil(minutes / 120))),
): PieceSeed[] => {
  const steps = GENERIC_STEPS
  const each = Math.ceil(minutes / count / 5) * 5
  const span = Math.max(0, dayjs.tz(due, ZONE_ID).diff(dayjs.tz(todayInSeoul(), ZONE_ID), 'day'))
  return steps.slice(0, count).map((step, index) => ({
    key: `g${index}`,
    title: step,
    description: text(
      `"${title}" 중 ${step} 단계를 끝낸다.`,
      '다음 단계가 이 결과를 받아서 시작한다.',
      ['필요한 것을 확인한다', '결과를 한곳에 정리한다'],
      '다음 단계를 바로 시작할 수 있다.',
    ),
    minutes: each,
    difficulty: 5,
    dueDate: day(Math.round((span * (index + 1)) / count)),
    after: index === 0 ? [] : [`g${index - 1}`],
  }))
}

// ---------------------------------------------------------------------------
// 저장소
// ---------------------------------------------------------------------------

const proposals = new Map<number, SplitProposalView>()
let seeded = false

const originalOf = (request: MockSplitRequest) =>
  mockTasks.find((task) => task.id === request.taskId) ?? null

/**
 * 원본 지문(서버 `SplitFingerprint.ofOriginal`): 제목, 설명, 마감 날짜·시간대, 유효 예상 시간, 난이도, 스페이스, 프로젝트.
 * 서버는 접수 때 한 번 저장한다. 모크는 요청을 처음 볼 때(fixture 제안을 만들 때, 처리가 끝날 때) 저장한다.
 * 원본은 그동안 잠겨 있어 접수 때와 같다.
 */
const originalDigests = new Map<number, string>()
const originalDigest = (task: Task) => {
  const { spaceId, projectId } = placementOf('task', task.id)
  return JSON.stringify([
    task.title,
    task.description ?? '',
    task.dueDate?.date ?? null,
    task.dueDate?.zoneId ?? null,
    effectiveExpectedMinutes(task),
    task.difficulty,
    spaceId,
    projectId,
  ])
}
const rememberOriginalDigest = (request: MockSplitRequest) => {
  const task = originalOf(request)
  if (task && !originalDigests.has(request.requestId))
    originalDigests.set(request.requestId, originalDigest(task))
}

const viewOf = (request: MockSplitRequest, seeds: PieceSeed[]): SplitProposalView => {
  const task = originalOf(request)
  return {
    originalTitle: request.originalTitle,
    originalMinutes: task ? effectiveExpectedMinutes(task) : 0,
    originalDueDate: task?.dueDate?.date ?? null,
    expiresAt: request.expiresAt ?? '',
    violationRemaining: request.violationRemaining === true,
    factors: { ...FACTORS },
    pieces: seeds.map(pieceOf),
  }
}

const genericFor = (request: MockSplitRequest) => {
  const task = originalOf(request)
  const minutes = task ? effectiveExpectedMinutes(task) : 240
  return viewOf(request, genericPieces(request.originalTitle, minutes, task?.dueDate?.date ?? todayInSeoul()))
}

/** 버림 fixture(버리기 되돌리기용): fixture의 조각 수와 같게 만들 조각 셋과 뺀 조각 하나. */
const discardedPieces = (request: MockSplitRequest): PieceSeed[] => {
  const task = originalOf(request)
  const minutes = task ? effectiveExpectedMinutes(task) : 240
  return [
    ...genericPieces(request.originalTitle, minutes, task?.dueDate?.date ?? todayInSeoul(), 3),
    {
      key: 'gx',
      title: '사진 백업 확인',
      description: text(
        '옮기기 전에 사진이 모두 백업됐는지 본다.',
        '정리하다 지운 사진을 되찾을 수 있어야 한다.',
        ['백업 폴더의 사진 수를 센다'],
        '백업 사진 수가 원본과 같다.',
      ),
      minutes: 30,
      difficulty: 1,
      dueDate: day(1),
      after: [],
      exclusion: { reason: 'ALREADY_DONE', evidenceTaskId: 2, evidenceTitle: '사진 백업하기' },
    },
  ]
}

const FIXTURE_PROPOSALS: Partial<Record<SplitFixtureKey, (request: MockSplitRequest) => SplitProposalView>> = {
  ready: (request) => viewOf(request, onboardingPieces()),
  discarded: (request) => viewOf(request, discardedPieces(request)),
  violation: (request) => viewOf(request, violationPieces()),
  allExcluded: (request) => viewOf(request, allExcludedPieces()),
  adminOnly: genericFor,
  expired: genericFor,
  otherReady: genericFor,
}

/** fixture 제안을 처음 읽을 때 한 번 만든다. 이미 저장된 제안(`setProposal`)은 덮지 않는다. */
const seedFixtureProposals = () => {
  if (seeded) return
  seeded = true
  for (const [key, build] of Object.entries(FIXTURE_PROPOSALS)) {
    const requestId = mockSplitFixtures[key as SplitFixtureKey]?.requestId
    const request = mockSplitRequests.find((item) => item.requestId === requestId)
    if (request && !proposals.has(request.requestId)) proposals.set(request.requestId, build!(request))
  }
  mockSplitRequests.forEach(rememberOriginalDigest)
}

/** 저장된 제안. 준비됨이 된 적 없는 요청은 null이다. */
export const proposalOf = (requestId: number): SplitProposalView | null => {
  seedFixtureProposals()
  return proposals.get(requestId) ?? null
}

export const setProposal = (requestId: number, proposal: SplitProposalView) => {
  seedFixtureProposals()
  proposals.set(requestId, proposal)
}

const storedExclusionsOf = (proposal: SplitProposalView) => {
  const stored: Record<string, StoredExclusion> = {}
  for (const piece of proposal.pieces) if (piece.exclusion) stored[piece.key] = piece.exclusion
  return stored
}

/** 저장된 제안의 근거·계수·원본 마감으로 초안을 검사한다. 요청이 보낸 `exclusion`·`dueDateAdjusted`는 읽지 않는다. */
export const checkFor = (
  request: MockSplitRequest,
  pieces: DraftPiece[],
  action?: SplitDraftAction,
): SplitCheck => {
  const proposal = proposalOf(request.requestId)
  const today = todayInSeoul()
  return computeSplitCheck({
    pieces,
    storedExclusions: proposal ? storedExclusionsOf(proposal) : {},
    factors: proposal?.factors ?? FACTORS,
    originalDueDate: proposal?.originalDueDate ?? today,
    today,
    adminOnly: itemOf(request).canApply === false,
    action,
  })
}

/** 조각 key가 모두 있고 겹치지 않으며, key 집합이 저장된 제안과 같은가(서버 `requireKeySet`). */
export const sameKeys = (request: MockSplitRequest, pieces: DraftPiece[]) => {
  const proposal = proposalOf(request.requestId)
  if (!proposal || !Array.isArray(pieces) || pieces.length > MAX_PIECES) return false
  const keys = new Set<string>()
  for (const piece of pieces) {
    const key = (piece as Partial<DraftPiece> | null)?.key
    if (typeof key !== 'string' || !key.trim() || keys.has(key)) return false
    keys.add(key)
  }
  const stored = new Set(proposal.pieces.map((piece) => piece.key))
  return keys.size === stored.size && [...keys].every((key) => stored.has(key))
}

const toDraft = (piece: SplitPiece | DraftPiece): DraftPiece => ({
  key: piece.key,
  title: piece.title,
  description: piece.description,
  minutes: piece.minutes,
  difficulty: piece.difficulty,
  dueDate: piece.dueDate,
  after: piece.after,
  selected: piece.selected,
})

registerMockSplitProposals({
  countsOf: (requestId) => {
    const proposal = proposalOf(requestId)
    if (!proposal) return null
    return {
      pieceCount: proposal.pieces.filter((piece) => piece.selected).length,
      excludedCount: proposal.pieces.filter((piece) => piece.exclusion).length,
    }
  },
  onReady: (request) => {
    setProposal(request.requestId, genericFor(request))
    rememberOriginalDigest(request)
  },
})

// ---------------------------------------------------------------------------
// 경로
// ---------------------------------------------------------------------------

const requestNotFound = () =>
  splitFailure('SPLIT_REQUEST_NOT_FOUND', MESSAGES.requestNotFound, 404)

const detail = (request: MockSplitRequest) => {
  const item = itemOf(request)
  const proposal = item.status === 'READY' ? proposalOf(request.requestId) : null
  if (!proposal) return json({ request: item, proposal: null, check: null })
  return json({ request: item, proposal, check: checkFor(request, proposal.pieces.map(toDraft)) })
}

type DraftBody = { pieces?: unknown; action?: { type?: unknown; key?: unknown } | null }

/** 서버처럼 본문을 먼저 읽는다: 비었거나 읽을 수 없는 본문은 요청을 찾기 전에 400이다. */
const readDraft = async (request: Request): Promise<DraftBody | null> => {
  const raw = await request.text()
  if (!raw) return null
  try {
    const body = JSON.parse(raw) as unknown
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null
    const draft = body as DraftBody
    if (draft.pieces != null && !Array.isArray(draft.pieces)) return null
    if (draft.action != null && typeof draft.action !== 'object') return null
    return draft
  } catch {
    return null
  }
}

const ACTION_TYPES = ['CONFIRM', 'EXCLUDE', 'INCLUDE']

const check = (request: MockSplitRequest, body: DraftBody) => {
  const status = itemOf(request).status
  if (status !== 'READY')
    return splitFailure('SPLIT_REQUEST_NOT_READY', MESSAGES.notReady, 409, { currentStatus: status })
  const pieces = (body.pieces ?? null) as DraftPiece[] | null
  if (!pieces || !sameKeys(request, pieces))
    return splitFailure('SPLIT_INVALID_PIECES', MESSAGES.invalidPieces, 422)
  // 키 집합 밖의 모양 오류는 400 INVALID_REQUEST(서버 `SplitDraftService.prepare`).
  for (const piece of pieces) {
    if (typeof piece.selected !== 'boolean') return invalidRequest()
    if (!Array.isArray(piece.after) || piece.after.some((key) => typeof key !== 'string'))
      return invalidRequest()
  }
  let action: SplitDraftAction | undefined
  if (body.action) {
    const { type, key } = body.action
    if (!ACTION_TYPES.includes(type as string)) return invalidRequest()
    if (!pieces.some((piece) => piece.key === key)) return invalidRequest()
    action = { type: type as SplitDraftAction['type'], key: key as string }
  }
  return json(checkFor(request, pieces.map(toDraft), action))
}

// ---------------------------------------------------------------------------
// 만들기(S7)와 되돌리기(S10·S11)
// ---------------------------------------------------------------------------

type ApplyFailure = 'EXPIRED' | 'ADMIN_ONLY' | 'UNEXPECTED'
let plannedApplyFailure: ApplyFailure | null = null

/** 다음 만들기(S7) 한 번을 정한 거부로 답한다. 그 응답은 아무것도 바꾸지 않는다. null이면 정한 거부를 지운다. */
export const failNextMockApply = (kind: ApplyFailure | null) => {
  plannedApplyFailure = kind
}

/** 적용이 남긴 것: 만든 조각과 그 지문(서버 `created_tasks_json`), 원본에서 끊은 간선의 상대, 원본을 휴지통에 보낸 시각. */
type AppliedRecord = {
  pieces: { taskId: number; digest: string }[]
  predecessors: number[]
  successors: number[]
  trashedAt: string
}
const appliedRecords = new Map<number, AppliedRecord>()

/** 조각 지문(서버 `SplitFingerprint.ofPiece`, 담당자 제외): 제목, 설명, 마감 날짜·시간대, 예상 시간, 난이도, 중요도, 스페이스, 프로젝트. */
const pieceDigest = (task: Task) => {
  const { spaceId, projectId } = placementOf('task', task.id)
  return JSON.stringify([
    task.title,
    task.description ?? '',
    task.dueDate?.date ?? null,
    task.dueDate?.zoneId ?? null,
    task.expectedDuration ?? null,
    task.difficulty,
    task.importance,
    spaceId,
    projectId,
  ])
}

const isDone = (task: Task) => task.completed ?? task.isCompleted ?? false
const findTask = (id: number) => mockTasks.find((task) => task.id === id)
const isoMinutes = (minutes: number) => {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return `PT${hours ? `${hours}H` : ''}${rest ? `${rest}M` : ''}`
}
const canDeleteIn = (actor: number, spaceId: number) => {
  const space = findSpace(spaceId)
  return Boolean(space && spacePermissions(actor, space, false).allowedActions.delete)
}
const currentMember = (spaceId: number, memberId: number | null) => {
  const space = findSpace(spaceId)
  return memberId !== null && space && memberOf(space, memberId) ? memberId : null
}
/** 잠금을 뺀 대상 이유(서버 `SplitEligibility`). */
const targetReasons = (actor: number, task: Task) =>
  splitViewOf(actor, task).cannotRequestReasons.filter((reason) => reason !== 'SPLIT_IN_PROGRESS')

const recordTaskChange = (actor: number, taskId: number, action: string) => {
  const { spaceId, version } = placementOf('task', taskId)
  recordChange({ spaceId, actorId: actor, resourceType: 'TASK', resourceId: taskId, version, action })
}

const link = (from: Task, to: Task) => {
  from.nextTaskIds ??= []
  to.previousTaskIds ??= []
  if (!from.nextTaskIds.includes(to.id)) from.nextTaskIds.push(to.id)
  if (!to.previousTaskIds.includes(from.id)) to.previousTaskIds.push(from.id)
}
/** 작업의 간선을 양쪽에서 모두 끊는다. */
const unlinkAll = (task: Task) => {
  for (const other of mockTasks) {
    if (other.previousTaskIds) other.previousTaskIds = other.previousTaskIds.filter((id) => id !== task.id)
    if (other.nextTaskIds) other.nextTaskIds = other.nextTaskIds.filter((id) => id !== task.id)
  }
  task.previousTaskIds = []
  task.nextTaskIds = []
}
/** `from`에서 다음 작업을 따라가 `target`에 닿는가. */
const reaches = (from: number, target: number) => {
  const visited = new Set<number>()
  const pending = [from]
  while (pending.length) {
    const current = pending.pop()!
    if (current === target) return true
    if (visited.has(current)) continue
    visited.add(current)
    pending.push(...(findTask(current)?.nextTaskIds ?? []))
  }
  return false
}
const liveNeighbors = (ids: number[] | undefined) =>
  [...new Set(ids ?? [])].map(findTask).filter((task): task is Task => Boolean(task))

const notReady = (currentStatus: string) =>
  splitFailure('SPLIT_REQUEST_NOT_READY', MESSAGES.notReady, 409, { currentStatus })
const notEligible = (reasons: string[]) =>
  splitFailure('SPLIT_NOT_ELIGIBLE', MESSAGES.notEligible, 422, { reasons })
const undoUnavailable = (undoReason: string, details?: { reasons: string[] }) =>
  splitFailure('SPLIT_UNDO_NOT_AVAILABLE', MESSAGES.undoNotAvailable, 409, { undoReason, ...details })

/** 검사(S6)와 같은 본문 판정. 키 집합 문제는 422, 그 밖의 모양 오류는 400이다. 만들기는 `action`을 쓰지 않는다. */
const applyPieces = (request: MockSplitRequest, body: DraftBody): DraftPiece[] | Response => {
  const pieces = (body.pieces ?? null) as DraftPiece[] | null
  if (!pieces || !sameKeys(request, pieces))
    return splitFailure('SPLIT_INVALID_PIECES', MESSAGES.invalidPieces, 422)
  for (const piece of pieces)
    if (
      typeof piece.selected !== 'boolean' ||
      !Array.isArray(piece.after) ||
      piece.after.some((key) => typeof key !== 'string')
    )
      return invalidRequest()
  return pieces
}

/** 서버 `SplitApplyWriter.write`: 조각, 간선(조각 사이 → 선행 → 후행), 요청 전이, 원본 휴지통, 변경 기록 순서. */
const writeApply = (actor: number, request: MockSplitRequest, original: Task, pieces: DraftPiece[], check: SplitCheck) => {
  const placement = placementOf('task', original.id)
  const assigneeId = currentMember(placement.spaceId, placement.assigneeId)
  const zoneId = original.dueDate?.zoneId ?? ZONE_ID
  const selected = pieces.filter((piece) => piece.selected)
  const byKey = new Map<string, Task>()
  const now = new Date().toISOString()
  const created = selected.map((piece) => {
    const task: Task = {
      id: nextTaskId(),
      ownerId: actor,
      title: piece.title as string,
      description: piece.description as string,
      dueDate: { date: piece.dueDate as string, zoneId, offset: dayjs.tz(piece.dueDate, zoneId).format('Z') },
      importance: original.importance,
      difficulty: piece.difficulty as number,
      expectedDuration: isoMinutes(piece.minutes as number),
      completed: false,
      isCompleted: false,
      inboundDependencyCount: 0,
      previousTaskIds: [],
      nextTaskIds: [],
      createdAt: now,
      updatedAt: now,
    }
    mockTasks.push(task)
    setPlacement('task', task.id, {
      spaceId: placement.spaceId,
      projectId: placement.projectId,
      assigneeId,
      version: 1,
    })
    byKey.set(piece.key, task)
    return { key: piece.key, taskId: task.id }
  })

  // 이어받기(서버 `SplitInheritance`): 선행 → 모든 첫 조각, 모든 마지막 조각 → 후행. 반복 회차인 이웃은 잇지 않는다.
  const before = (key: string) => check.pieces.find((piece) => piece.key === key)?.before ?? []
  const referenced = new Set(selected.flatMap((piece) => before(piece.key)))
  const firstKeys = selected.filter((piece) => before(piece.key).length === 0).map((piece) => piece.key)
  const lastKeys = selected.filter((piece) => !referenced.has(piece.key)).map((piece) => piece.key)
  const predecessors = liveNeighbors(original.previousTaskIds)
  const successors = liveNeighbors(original.nextTaskIds)
  const idOf = (key: string) => byKey.get(key)!.id
  const edges = new Map<string, { fromTaskId: number; toTaskId: number }>()
  const edge = (fromTaskId: number, toTaskId: number) => {
    const id = `${fromTaskId}:${toTaskId}`
    if (!edges.has(id)) edges.set(id, { fromTaskId, toTaskId })
  }
  const notInherited: { taskId: number; direction: 'BEFORE' | 'AFTER'; reason: 'RECURRING_TASK' }[] = []
  for (const piece of selected) for (const from of before(piece.key)) edge(idOf(from), idOf(piece.key))
  for (const task of predecessors) {
    if (task.recurrence) notInherited.push({ taskId: task.id, direction: 'BEFORE', reason: 'RECURRING_TASK' })
    else firstKeys.forEach((key) => edge(task.id, idOf(key)))
  }
  const inherited = successors.filter((task) => {
    if (task.recurrence) notInherited.push({ taskId: task.id, direction: 'AFTER', reason: 'RECURRING_TASK' })
    return !task.recurrence
  })
  for (const key of lastKeys) inherited.forEach((task) => edge(idOf(key), task.id))

  // 원본의 간선은 휴지통에 보낼 때 끊고(서버 `task_trash_link`에 남긴다) 새 간선을 건다.
  unlinkAll(original)
  for (const { fromTaskId, toTaskId } of edges.values()) link(findTask(fromTaskId)!, findTask(toTaskId)!)
  recomputeMockTaskReadiness(mockTasks)

  rememberOriginalDigest(request)
  request.status = 'APPLIED'
  moveTaskToTrash(original.id, false)
  bumpVersion('task', original.id)
  appliedRecords.set(request.requestId, {
    pieces: created.map(({ taskId }) => ({ taskId, digest: pieceDigest(findTask(taskId)!) })),
    predecessors: predecessors.map((task) => task.id),
    successors: successors.map((task) => task.id),
    trashedAt: trashedTaskOf(original.id)!.deletedAt,
  })
  created.forEach(({ taskId }) => recordTaskChange(actor, taskId, 'CREATED'))
  recordTaskChange(actor, original.id, 'DELETED')
  return {
    request: itemOf(request),
    created,
    createdEdges: [...edges.values()],
    notInherited,
    trashedTaskId: original.id,
  }
}

/** S7. 검사 순서는 서버 `SplitApplyService.apply`와 같다: 상태 → 본문 모양 → 대상 → 선택 없음 → 조각 문제. */
const apply = (actor: number, request: MockSplitRequest, body: DraftBody) => {
  const planned = plannedApplyFailure
  plannedApplyFailure = null
  if (planned === 'EXPIRED') return notReady('EXPIRED')
  if (planned === 'ADMIN_ONLY') return notEligible(['ADMIN_ONLY'])
  if (planned === 'UNEXPECTED') return json({ code: 'STATE_CONFLICT', message: MESSAGES.cycle }, 409)
  const status = itemOf(request).status
  if (status !== 'READY') return notReady(status)
  const pieces = applyPieces(request, body)
  if (pieces instanceof Response) return pieces
  // 준비됨인 원본은 잠겨 있어 사라질 수 없다. 모크의 `__pinitMock.remote`처럼 잠금을 건너뛴 경우만 여기에 온다.
  const original = originalOf(request)
  if (!original) return notEligible(['TASK_IN_TRASH'])
  const reasons = targetReasons(actor, original)
  if (reasons.length) return notEligible(reasons)
  const check = checkFor(request, pieces.map(toDraft))
  if (check.selectedCount === 0)
    return splitFailure('SPLIT_NOTHING_SELECTED', MESSAGES.nothingSelected, 422)
  if (check.problemCount > 0)
    return splitFailure('SPLIT_INVALID_PIECES', MESSAGES.invalidPiecesCheck, 422, { check })
  return json(writeApply(actor, request, original, pieces, check))
}

/**
 * 적용됨 fixture는 원본·만든 기록 없이 시작한다. 처음 되돌릴 때 원본을 적용 때처럼 휴지통에 넣고 제안을 만든다.
 * 그때까지 화면에 없던 조각은 만들지 않는다(지울 조각이 없다).
 */
const materializeAppliedFixture = (request: MockSplitRequest): AppliedRecord | null => {
  if (request.requestId !== mockSplitFixtures.applied?.requestId) return null
  if (findTask(request.taskId) || trashedTaskOf(request.taskId)) return null
  const due = dayjs().tz(ZONE_ID).add(6, 'day').startOf('day')
  const task: Task = {
    id: request.taskId,
    ownerId: request.memberId,
    title: request.originalTitle,
    description: '',
    dueDate: { date: due.format('YYYY-MM-DD'), zoneId: ZONE_ID, offset: due.format('Z') },
    importance: 6,
    difficulty: 5,
    expectedDuration: null,
    completed: false,
    isCompleted: false,
    inboundDependencyCount: 0,
    previousTaskIds: [],
    nextTaskIds: [],
    createdAt: dayjs().subtract(10, 'day').toISOString(),
    updatedAt: dayjs().subtract(3, 'day').toISOString(),
  }
  mockTasks.push(task)
  setPlacement('task', task.id, {
    spaceId: request.spaceId,
    projectId: null,
    assigneeId: request.memberId,
    version: 2,
  })
  setProposal(request.requestId, genericFor(request))
  rememberOriginalDigest(request)
  moveTaskToTrash(task.id, false)
  const record = { pieces: [], predecessors: [], successors: [], trashedAt: trashedTaskOf(task.id)!.deletedAt }
  appliedRecords.set(request.requestId, record)
  return record
}

const expiredNow = (request: MockSplitRequest) =>
  request.expiresAt === null || Date.parse(request.expiresAt) <= Date.now()

/**
 * S10. 거부 이유의 순서: STATE → EXPIRED → ORIGINAL_MISSING → ORIGINAL_CHANGED → PERMISSION → PIECES_CHANGED.
 * 조각은 휴지통에 남기지 않고 지우고, 원본을 되살려 끊었던 간선을 기존 복원 규칙(서버 `TrashRestorePolicy`)으로 다시 건다.
 */
const undoApply = (actor: number, request: MockSplitRequest) => {
  const record =
    request.status === 'APPLIED'
      ? (appliedRecords.get(request.requestId) ?? materializeAppliedFixture(request))
      : null
  if (!record || !proposalOf(request.requestId)) return undoUnavailable('STATE')
  if (expiredNow(request)) return undoUnavailable('EXPIRED')
  const trashed = trashedTaskOf(request.taskId)
  if (!trashed || trashed.deletedAt !== record.trashedAt) return undoUnavailable('ORIGINAL_MISSING')
  if (originalDigest(trashed.task) !== originalDigests.get(request.requestId))
    return undoUnavailable('ORIGINAL_CHANGED')
  if (!canDeleteIn(actor, placementOf('task', request.taskId).spaceId)) return undoUnavailable('PERMISSION')
  const pieces = record.pieces.map(({ taskId, digest }) => ({ task: findTask(taskId), digest }))
  const changed = pieces.some(
    ({ task, digest }) =>
      !task ||
      isDone(task) ||
      mockSchedules.some((schedule) => schedule.taskId === task.id) ||
      lockOf(actor, task.id) !== null ||
      pieceDigest(task) !== digest,
  )
  if (changed) return undoUnavailable('PIECES_CHANGED')

  for (const { task } of pieces) {
    unlinkAll(task!)
    mockTasks.splice(mockTasks.indexOf(task!), 1)
    bumpVersion('task', task!.id)
    recordTaskChange(actor, task!.id, 'PURGED')
  }
  restoreTaskFromTrash(request.taskId)
  const original = trashed.task
  const placement = placementOf('task', original.id)
  placement.assigneeId = currentMember(placement.spaceId, placement.assigneeId)
  const notRestored: { taskId: number; direction: 'BEFORE' | 'AFTER' }[] = []
  let restoredEdgeCount = 0
  const candidates = [
    ...record.predecessors.map((taskId) => ({ taskId, direction: 'BEFORE' as const })),
    ...record.successors.map((taskId) => ({ taskId, direction: 'AFTER' as const })),
  ]
  for (const candidate of candidates) {
    const other = findTask(candidate.taskId)
    const [from, to] = candidate.direction === 'BEFORE' ? [other, original] : [original, other]
    if (!other || other.recurrence || reaches(to!.id, from!.id)) notRestored.push(candidate)
    else {
      link(from!, to!)
      restoredEdgeCount += 1
    }
  }
  recomputeMockTaskReadiness(mockTasks)
  bumpVersion('task', original.id)
  recordTaskChange(actor, original.id, 'RESTORED')
  request.status = 'READY'
  appliedRecords.delete(request.requestId)
  recordTaskChange(request.memberId, original.id, 'SPLIT_CHANGED')
  return json({ request: itemOf(request), restoredTaskId: original.id, restoredEdgeCount, notRestored })
}

/** S11. 거부 이유의 순서: STATE → EXPIRED → ORIGINAL_NOT_ELIGIBLE → ORIGINAL_CHANGED → OTHER_REQUEST_EXISTS. */
const undoDiscard = (actor: number, request: MockSplitRequest) => {
  if (request.status !== 'DISCARDED' || request.failureReason !== null || !proposalOf(request.requestId))
    return undoUnavailable('STATE')
  if (expiredNow(request)) return undoUnavailable('EXPIRED')
  const original = originalOf(request)
  if (!original)
    return undoUnavailable('ORIGINAL_NOT_ELIGIBLE', {
      reasons: trashedTaskOf(request.taskId) ? ['TASK_IN_TRASH'] : [],
    })
  const reasons = targetReasons(actor, original)
  if (reasons.length) return undoUnavailable('ORIGINAL_NOT_ELIGIBLE', { reasons })
  rememberOriginalDigest(request)
  if (originalDigest(original) !== originalDigests.get(request.requestId))
    return undoUnavailable('ORIGINAL_CHANGED')
  if (lockOf(actor, original.id)) return undoUnavailable('OTHER_REQUEST_EXISTS')
  request.status = 'READY'
  recordTaskChange(request.memberId, original.id, 'SPLIT_CHANGED')
  return json({ request: itemOf(request) })
}

const COMMAND_PATH = /^\/v2\/task-splits\/(\d+)\/(apply|undo-apply|undo-discard)$/
const PROPOSAL_PATH = /^\/v2\/task-splits\/(\d+)(\/check)?$/

/**
 * S5 `GET /v2/task-splits/{id}`, S6 `POST …/check`, S7 `POST …/apply`, S10 `POST …/undo-apply`,
 * S11 `POST …/undo-discard`. 다른 경로는 null. 되돌리기는 본문을 읽지 않는다.
 */
export const handleSplitProposals = async (
  actor: number,
  path: string,
  method: string,
  request: Request,
): Promise<Response | null> => {
  const command = path.match(COMMAND_PATH)
  if (command) {
    if (method !== 'POST') return null
    const requestId = Number(command[1])
    if (command[2] === 'apply') {
      const body = await readDraft(request)
      if (!body) return invalidRequest(MESSAGES.unreadableBody)
      const found = requestOf(actor, requestId)
      return found ? apply(actor, found, body) : requestNotFound()
    }
    const found = requestOf(actor, requestId)
    if (!found) return requestNotFound()
    return command[2] === 'undo-apply' ? undoApply(actor, found) : undoDiscard(actor, found)
  }
  const match = path.match(PROPOSAL_PATH)
  if (!match) return null
  const requestId = Number(match[1])
  if (!match[2]) {
    if (method !== 'GET') return null
    const found = requestOf(actor, requestId)
    return found ? detail(found) : requestNotFound()
  }
  if (method !== 'POST') return null
  const body = await readDraft(request)
  if (!body) return invalidRequest(MESSAGES.unreadableBody)
  const found = requestOf(actor, requestId)
  return found ? check(found, body) : requestNotFound()
}

/** `handlers.ts`가 부른다. 로그인하지 않았으면 쪼개기 경로 처리는 `handleTaskSplits`에 맡긴다. */
export const handleSplitProposalRoutes = (path: string, method: string, request: Request) => {
  const actor = mockCategoryOwnerId(request)
  return actor ? handleSplitProposals(actor, path, method, request) : Promise.resolve(null)
}
