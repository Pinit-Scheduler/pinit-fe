import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
import type {
  DraftPiece,
  SplitCheck,
  SplitDraftAction,
  SplitPiece,
  SplitProposalView,
} from '../features/task-split/api/splitProposals'
import { mockTasks } from './db'
import { mockCategoryOwnerId } from './categories'
import { effectiveExpectedMinutes } from './planner'
import {
  itemOf,
  mockSplitFixtures,
  mockSplitRequests,
  registerMockSplitProposals,
  requestOf,
  splitFailure,
  type MockSplitRequest,
  type SplitFixtureKey,
} from './taskSplit'
import { computeSplitCheck, type StoredExclusion } from './taskSplitCheck'

dayjs.extend(utc)
dayjs.extend(timezone)

/**
 * 쪼개기 제안 상세(S5)와 초안 검사(S6)의 개발용 모크. 응답 모양과 문구는 서버 `SplitProposalService`·`SplitDraftService`·
 * `SplitErrorMessages`를 따른다. 검사는 저장하지 않는다.
 * fixture 제안은 처음 읽을 때 만든다(`taskSplit.ts`의 fixture가 다 만들어진 뒤).
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
const genericPieces = (title: string, minutes: number, due: string): PieceSeed[] => {
  const steps = ['자료 모으기', '뼈대 잡기', '본문 채우기', '검토하고 다듬기']
  const count = Math.min(steps.length, Math.max(2, Math.ceil(minutes / 120)))
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

const FIXTURE_PROPOSALS: Partial<Record<SplitFixtureKey, (request: MockSplitRequest) => SplitProposalView>> = {
  ready: (request) => viewOf(request, onboardingPieces()),
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
  onReady: (request) => setProposal(request.requestId, genericFor(request)),
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

const PROPOSAL_PATH = /^\/v2\/task-splits\/(\d+)(\/check)?$/

/** S5 `GET /v2/task-splits/{id}`, S6 `POST /v2/task-splits/{id}/check`. 다른 경로는 null. */
export const handleSplitProposals = async (
  actor: number,
  path: string,
  method: string,
  request: Request,
): Promise<Response | null> => {
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
