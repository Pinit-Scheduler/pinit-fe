import { mockCategoryOwnerId } from './categories'
import { normalizeText, textLength } from '../features/mind-map/model/text'
import { subtreeHeight, totalNodes, type CheckState, type MindMapNode } from '../features/mind-map/model/tree'

/**
 * `/v2/mind-map…` 개발용 모크(ADR-0036 §5). 서버의 근사다. 검사 순서는 BE와 같다: 본문 읽기 → 값의 종류 → 모양 →
 * version → 나무 규칙 → 탈퇴한 회원의 처음 저장. 응답 모양과 문구는 BE(pinit-monolith `MindMapControllerAdvice`)
 * 그대로다. 대조표는 FE `docs/mind-map.md`의 "계약 대조"에 있다.
 * 회원 1(demo)만 예시 맵을 갖고, 다른 회원은 저장한 적 없다. 상태는 이 모듈 변수에만 둔다.
 */

export const MOCK_MIND_MAP_LIMITS = { maxBranches: 500, maxTextLength: 100, maxDepth: 32 }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const CHECKS: readonly CheckState[] = ['NONE', 'OPEN', 'DONE']
const PATH = '/v2/mind-map'
const CURSOR_PATH = '/v2/mind-map/cursor'
const NUMERIC = /^-?\d+$/
// 문구는 BE `MindMapErrorMessages`와 `RequestErrorMessages` 그대로다. 바꿀 때는 BE를 먼저 바꾼다.
const CONFLICT = '다른 곳에서 마인드맵이 먼저 바뀌었어요. 최신 내용을 불러온 뒤 다시 고쳐 주세요.'
const REQUEST_SHAPE = '마인드맵의 내용을 읽지 못했어요. 화면을 새로고침한 뒤 다시 시도해 주세요.'
const WITHDRAWN = '탈퇴한 회원의 마인드맵은 쓸 수 없어요.'
const UNREADABLE = '저장된 마인드맵을 읽지 못했어요. 잠시 후 다시 시도해 주세요.'
const UNREADABLE_BODY = '요청을 처리하지 못했어요. 화면을 새로고침한 뒤 다시 시도해 주세요.'
const UNEXPECTED = '일시적인 문제로 처리하지 못했어요. 잠시 후 다시 시도해 주세요.'
const RULE_REASONS = {
  ROOT_ID_CHANGED: '가장 위의 주제는 바꿀 수 없어요. 화면을 새로고침한 뒤 다시 시도해 주세요.',
  ROOT_CHECKED: '가장 위의 주제에는 체크박스를 달 수 없어요. 체크박스를 없애고 다시 시도해 주세요.',
  ID_FORMAT: '가지를 구별하는 값이 올바르지 않아요. 화면을 새로고침한 뒤 다시 시도해 주세요.',
  ID_DUPLICATE: '같은 가지가 두 번 들어 있어요. 화면을 새로고침한 뒤 다시 시도해 주세요.',
  TEXT_EMPTY: '가지의 글이 비어 있어요. 글을 적거나 가지를 지워 주세요.',
  TEXT_TOO_LONG: '가지의 글은 100자까지 적을 수 있어요. 글을 줄여 주세요.',
  TOO_MANY_BRANCHES: '가지는 주제를 포함해 500개까지 만들 수 있어요. 안 쓰는 가지를 지운 뒤 다시 시도해 주세요.',
  TOO_DEEP: '가지는 주제 아래로 32단계까지 이어 만들 수 있어요. 단계를 줄여 주세요.',
} as const
type Rule = keyof typeof RULE_REASONS

const hex12 = (value: number) => value.toString(16).padStart(12, '0')

/** 회원마다 늘 같은 주제 id. 서버는 회원 id에서 이름 기반 UUID를 만든다(ADR §4). */
export const mockMindMapRootId = (memberId: number) => `6d6d0000-0000-4000-8000-${hex12(memberId)}`

type FixtureKey = 'moving' | 'house' | 'packing' | 'toss' | 'boxes' | 'rooms' | 'workshop' | 'place' | 'health' | 'checkup'
type Spec = { text: string; key?: FixtureKey; check?: CheckState; collapsed?: boolean; children?: Spec[] }

const spec = (text: string, children: Spec[] = [], extra: Omit<Spec, 'text' | 'children'> = {}): Spec => ({
  text,
  children,
  ...extra,
})

/** 시안의 예시 나무(가지 27개, 맨 끝 17개). 할 일 2/4, `장소`는 접혀 있다. */
const FIXTURE: Spec[] = [
  spec('이사 준비', [
    spec('새 집 구하기', [
      spec('예산과 지역 정하기'),
      spec('부동산 세 곳에 연락하기'),
      spec('주말에 집 보러 가기', [spec('확인할 것 적어 가기'), spec('수압과 채광 확인하기')]),
    ], { key: 'house' }),
    spec('짐 정리', [
      spec('버릴 것 고르기', [], { key: 'toss', check: 'DONE' }),
      spec('박스와 테이프 사기', [], { key: 'boxes', check: 'OPEN' }),
      spec('방마다 포장하기', [], { key: 'rooms', check: 'OPEN' }),
    ], { key: 'packing' }),
    spec('이사 당일', [spec('이사 업체 예약하기'), spec('엘리베이터 사용 예약하기')]),
  ], { key: 'moving' }),
  spec('팀 워크숍', [
    spec('장소', [spec('후보 세 곳 견적 받기'), spec('답사 날짜 잡기')], { key: 'place', collapsed: true }),
    spec('프로그램', [spec('오전 세션 주제 정하기'), spec('저녁 식당 예약하기')]),
    spec('참석 여부 설문 돌리기'),
  ], { key: 'workshop' }),
  spec('건강', [
    spec('주 3회 달리기', [spec('러닝화 새로 사기'), spec('한강 코스 정하기')]),
    spec('건강검진 예약하기', [], { key: 'checkup', check: 'DONE' }),
  ], { key: 'health' }),
]

const buildFixture = () => {
  const ids = {} as Record<FixtureKey, string>
  let order = 0
  const build = (item: Spec): MindMapNode => {
    const id = `6d6d0001-0000-4000-8000-${hex12(++order)}`
    if (item.key) ids[item.key] = id
    return {
      id,
      text: item.text,
      collapsed: item.collapsed ?? false,
      check: item.check ?? 'NONE',
      children: (item.children ?? []).map(build),
    }
  }
  const children = FIXTURE.map(build)
  const root: MindMapNode = { id: mockMindMapRootId(1), text: '내 계획', collapsed: false, check: 'NONE', children }
  return { ids, root }
}

const fixture = buildFixture()
export const mockMindMapFixture: { ids: Record<FixtureKey, string> } = { ids: fixture.ids }

type StoredMap = { version: number; root: MindMapNode; cursorNodeId: string | null; lastSaveId: string | null }

const maps = new Map<number, StoredMap>([
  [1, { version: 3, root: fixture.root, cursorNodeId: fixture.ids.packing, lastSaveId: null }],
])
/** 탈퇴한 회원. BE는 탈퇴할 때 맵을 지우고, 그 뒤의 처음 저장을 409 `MEMBER_WITHDRAWN`으로 거절한다. */
const withdrawn = new Set<number>()
let nextSaveFailure: 'lost' | 'server' | null = null
let nextLoadFails = false

const firstMap = (memberId: number): MindMapNode => ({
  id: mockMindMapRootId(memberId),
  text: '내 계획',
  collapsed: false,
  check: 'NONE',
  children: [],
})

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

const noContent = () => new Response(null, { status: 204 })

type FieldError = { field: string; rejectedValue: unknown; reason: string }

/** 서버의 `ErrorResponse`(`planner.ts`의 `errorBody`와 같은 모양). */
const errorBody = (status: number, error: string, message: string, path: string, errors: FieldError[] = []) =>
  json({ timestamp: new Date().toISOString(), status, error, message, path: `uri=${path}`, errors }, status)

const contains = (node: MindMapNode, id: string): boolean =>
  node.id === id || node.children.some((child) => contains(child, id))

type Body = Record<string, unknown>
const isObject = (value: unknown): value is Body => !!value && typeof value === 'object' && !Array.isArray(value)

/** 본문의 JSON 객체. 깨진 JSON, 빈 본문, 객체가 아닌 본문이면 null(BE는 일반 400으로 답한다). */
const readBody = async (request: Request): Promise<Body | null> => {
  const body: unknown = await request.text().then(JSON.parse).catch(() => null)
  return isObject(body) ? body : null
}

const unreadableBody = (path: string) => errorBody(400, 'Bad Request', UNREADABLE_BODY, path)
const shapeError = (field: string, rejectedValue: unknown): FieldError => ({
  field,
  rejectedValue: rejectedValue ?? null,
  reason: REQUEST_SHAPE,
})
const shapeFailure = (path: string, errors: FieldError[]) => errorBody(400, 'Bad Request', REQUEST_SHAPE, path, errors)

/**
 * 값의 종류가 틀린 첫 곳(BE에서는 Jackson이 읽다 멈춘 곳)의 JSON 경로. null은 종류 오류가 아니다(모양 검사가 본다).
 * 문서에 적힌 차례대로 본다. Jackson의 기본 변환 가운데 숫자 글자의 version만 흉내 낸다.
 */
const nodeMismatch = (node: Body, path: string): string | null => {
  for (const [key, value] of Object.entries(node)) {
    if (value === null) continue
    const at = `${path}.${key}`
    if ((key === 'id' || key === 'text' || key === 'check') && typeof value !== 'string') return at
    if (key === 'collapsed' && typeof value !== 'boolean') return at
    if (key !== 'children') continue
    if (!Array.isArray(value)) return at
    for (const [i, child] of value.entries()) {
      if (child === null) continue
      if (!isObject(child)) return `${at}[${i}]`
      const inner = nodeMismatch(child, `${at}[${i}]`)
      if (inner) return inner
    }
  }
  return null
}

const saveMismatch = (body: Body): string | null => {
  for (const [key, value] of Object.entries(body)) {
    if (value === null) continue
    if (key === 'expectedVersion' && !Number.isInteger(value) && !(typeof value === 'string' && NUMERIC.test(value)))
      return key
    if (key === 'saveId' && typeof value !== 'string') return key
    if (key === 'root') {
      if (!isObject(value)) return key
      const inner = nodeMismatch(value, 'root')
      if (inner) return inner
    }
  }
  return null
}

/** 빠지거나 null이거나 모르는 체크 상태인 곳을 모두 모은다. 차례는 BE `MindMapNodeDto.toNode`와 같다. */
const shapeErrors = (node: Body, path: string, errors: FieldError[]) => {
  const { id, text, collapsed, check, children } = node
  if (check == null || !CHECKS.includes(check as CheckState)) errors.push(shapeError(`${path}.check`, check))
  if (id == null) errors.push(shapeError(`${path}.id`, null))
  if (text == null) errors.push(shapeError(`${path}.text`, null))
  if (collapsed == null) errors.push(shapeError(`${path}.collapsed`, null))
  if (children == null) {
    errors.push(shapeError(`${path}.children`, null))
    return
  }
  for (const [i, child] of (children as unknown[]).entries()) {
    const at = `${path}.children[${i}]`
    if (child == null) errors.push(shapeError(at, null))
    else shapeErrors(child as Body, at, errors)
  }
}

/** 나무 규칙(ADR §4). 가지 수·깊이가 넘으면 그 위반 하나만, 아니면 앞에서 깊이 우선으로 모두 모은다. */
const ruleErrors = (root: MindMapNode, memberId: number): FieldError[] => {
  const violation = (field: string, rule: Rule): FieldError => ({ field, rejectedValue: rule, reason: RULE_REASONS[rule] })
  if (totalNodes(root) > MOCK_MIND_MAP_LIMITS.maxBranches) return [violation(root.id, 'TOO_MANY_BRANCHES')]
  if (subtreeHeight(root) > MOCK_MIND_MAP_LIMITS.maxDepth) return [violation(root.id, 'TOO_DEEP')]
  const errors: FieldError[] = []
  if (root.id !== mockMindMapRootId(memberId)) errors.push(violation(root.id, 'ROOT_ID_CHANGED'))
  if (root.check !== 'NONE') errors.push(violation(root.id, 'ROOT_CHECKED'))
  const seen = new Set<string>()
  const visit = (node: MindMapNode) => {
    if (!UUID.test(node.id)) errors.push(violation(node.id, 'ID_FORMAT'))
    if (seen.has(node.id)) errors.push(violation(node.id, 'ID_DUPLICATE'))
    seen.add(node.id)
    const text = normalizeText(node.text)
    if (text === '') errors.push(violation(node.id, 'TEXT_EMPTY'))
    if (textLength(text) > MOCK_MIND_MAP_LIMITS.maxTextLength) errors.push(violation(node.id, 'TEXT_TOO_LONG'))
    node.children.forEach(visit)
  }
  visit(root)
  return errors
}

/** 저장할 나무. 글을 정리하고 다섯 필드만 남긴다. */
const tidy = (node: MindMapNode): MindMapNode => ({
  id: node.id,
  text: normalizeText(node.text),
  collapsed: node.collapsed,
  check: node.check,
  children: node.children.map(tidy),
})

const readMap = (memberId: number) => {
  if (nextLoadFails) {
    nextLoadFails = false
    return errorBody(500, 'Internal Server Error', UNREADABLE, PATH)
  }
  const stored = maps.get(memberId)
  if (!stored) {
    const root = firstMap(memberId)
    return json({ version: 0, root, cursorNodeId: root.id, limits: MOCK_MIND_MAP_LIMITS })
  }
  const { version, root, cursorNodeId } = stored
  const cursor = cursorNodeId && contains(root, cursorNodeId) ? cursorNodeId : root.id
  return json({ version, root, cursorNodeId: cursor, limits: MOCK_MIND_MAP_LIMITS })
}

const saveMap = async (memberId: number, request: Request) => {
  const body = await readBody(request)
  if (!body) return unreadableBody(PATH)
  const mismatch = saveMismatch(body)
  if (mismatch) return shapeFailure(PATH, [shapeError(mismatch, null)])
  const { saveId, root } = body
  const expectedVersion = typeof body.expectedVersion === 'string' ? Number(body.expectedVersion) : body.expectedVersion
  const shape: FieldError[] = []
  if (expectedVersion == null || (expectedVersion as number) < 0) shape.push(shapeError('expectedVersion', expectedVersion))
  if (saveId == null || !UUID.test(saveId as string)) shape.push(shapeError('saveId', saveId))
  if (root == null) shape.push(shapeError('root', null))
  else shapeErrors(root as Body, 'root', shape)
  if (shape.length) return shapeFailure(PATH, shape)

  const stored = maps.get(memberId)
  const latestVersion = stored?.version ?? 0
  if (expectedVersion !== latestVersion)
    return json(
      { code: 'VERSION_CONFLICT', message: CONFLICT, latestVersion, lastSaveId: stored?.lastSaveId ?? null },
      409,
    )

  const tree = root as MindMapNode
  const violations = ruleErrors(tree, memberId)
  if (violations.length) return errorBody(400, 'Bad Request', violations[0].reason, PATH, violations)
  if (!stored && withdrawn.has(memberId))
    return json({ code: 'MEMBER_WITHDRAWN', message: WITHDRAWN, latestVersion: null, lastSaveId: null }, 409)

  const failure = nextSaveFailure
  nextSaveFailure = null
  if (failure === 'server') return errorBody(500, 'Internal Server Error', UNEXPECTED, PATH)
  const version = latestVersion + 1
  maps.set(memberId, {
    version,
    root: tidy(tree),
    cursorNodeId: stored?.cursorNodeId ?? null,
    lastSaveId: saveId as string,
  })
  if (failure === 'lost') return errorBody(503, 'Service Unavailable', '마인드맵을 저장하지 못했어요.', PATH)
  return json({ version })
}

/** 기억한 가지는 형식만 본다. 저장한 적 없으면 아무것도 남기지 않고, version·저장 번호는 그대로다. */
const saveCursor = async (memberId: number, request: Request) => {
  const body = await readBody(request)
  if (!body) return unreadableBody(CURSOR_PATH)
  const { nodeId } = body
  if (typeof nodeId !== 'string' || !UUID.test(nodeId))
    return shapeFailure(CURSOR_PATH, [shapeError('nodeId', typeof nodeId === 'string' ? nodeId : null)])
  const stored = maps.get(memberId)
  if (stored) stored.cursorNodeId = nodeId
  return noContent()
}

export const handleMindMap = async (path: string, method: string, request: Request): Promise<Response | null> => {
  const route =
    path === PATH && method === 'GET' ? 'read'
    : path === PATH && method === 'PUT' ? 'save'
    : path === CURSOR_PATH && method === 'PUT' ? 'cursor'
    : null
  if (!route) return null
  const memberId = mockCategoryOwnerId(request)
  if (!memberId) return json({ message: '로그인이 필요해요.' }, 401)
  if (route === 'read') return readMap(memberId)
  if (route === 'save') return saveMap(memberId, request)
  return saveCursor(memberId, request)
}

/** 개발자 도구의 `__pinitMock.mindMap`. */
export const mockMindMapControls = {
  /** 다음 저장 한 번을 실패시킨다. lost: 반영한 뒤 503, server: 반영하지 않고 500. null이면 지운다. */
  failNextSave(kind: 'lost' | 'server' | null) {
    nextSaveFailure = kind
  },
  /** 다음 GET 한 번을 500으로 답한다. 본문은 BE가 저장된 맵을 읽지 못했을 때와 같다. */
  failNextLoad(on: boolean) {
    nextLoadFails = on
  },
  /** 회원을 탈퇴시킨다: 맵을 지우고, 그 뒤의 처음 저장을 409 `MEMBER_WITHDRAWN`으로 거절한다. */
  withdraw(memberId = 1) {
    maps.delete(memberId)
    withdrawn.add(memberId)
  },
  /** 다른 기기나 MCP가 고친 것처럼 주제 바로 아래 첫 가지 글을 바꾼다. 새 version을 돌려준다. */
  remoteEdit(memberId = 1) {
    const stored = maps.get(memberId) ?? { version: 0, root: firstMap(memberId), cursorNodeId: null, lastSaveId: null }
    const [first, ...rest] = stored.root.children
    const root = first ? { ...stored.root, children: [{ ...first, text: `${first.text} (다른 기기)` }, ...rest] } : stored.root
    const version = stored.version + 1
    maps.set(memberId, { ...stored, version, root, lastSaveId: null })
    return version
  },
}
