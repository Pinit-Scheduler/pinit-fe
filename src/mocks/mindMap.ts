import { mockCategoryOwnerId } from './categories'
import { normalizeText, textLength } from '../features/mind-map/model/text'
import { subtreeHeight, totalNodes, type CheckState, type MindMapNode } from '../features/mind-map/model/tree'

/**
 * `/v2/mind-map…` 개발용 모크(ADR-0036 §5). 서버의 근사다. 검사 순서는 ADR §4 P1(모양 → version → 나무 규칙)을 따른다.
 * 회원 1(demo)만 예시 맵을 갖고, 다른 회원은 저장한 적 없다. 상태는 이 모듈 변수에만 둔다.
 */

export const MOCK_MIND_MAP_LIMITS = { maxBranches: 500, maxTextLength: 100, maxDepth: 32 }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const CHECKS: readonly CheckState[] = ['NONE', 'OPEN', 'DONE']
const PATH = '/v2/mind-map'
const CURSOR_PATH = '/v2/mind-map/cursor'
const CONFLICT = '다른 곳에서 마인드맵이 먼저 바뀌었어요. 최신 내용을 불러온 뒤 다시 고쳐 주세요.'
const SHAPE_MESSAGE = '마인드맵을 저장하지 못했어요. 새로 고친 뒤 다시 해 주세요.'
const SHAPE_REASON = '형식이 올바르지 않아요.'
const RULE_REASONS = {
  ROOT_ID_CHANGED: '다른 계정의 마인드맵이라 저장할 수 없어요. 새로 고친 뒤 다시 해 주세요.',
  ROOT_CHECKED: '주제에는 체크박스를 붙일 수 없어요.',
  ID_FORMAT: '가지 번호가 올바르지 않아요.',
  ID_DUPLICATE: '같은 가지가 두 번 들어 있어요.',
  TEXT_EMPTY: '가지 글을 적어 주세요.',
  TEXT_TOO_LONG: '가지 글은 100자까지 쓸 수 있어요.',
  TOO_MANY_BRANCHES: '가지는 500개까지 만들 수 있어요.',
  TOO_DEEP: '가지는 주제 아래 32단계까지 만들 수 있어요.',
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

const readBody = async (request: Request): Promise<Record<string, unknown>> => {
  const body: unknown = await request.json().catch(() => null)
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {}
}

/** 가지 모양(필드 다섯과 그 형식)을 보고 틀린 곳을 JSON 경로로 모은다. */
const shapeErrors = (value: unknown, path: string, errors: FieldError[]) => {
  const fail = (field: string, rejectedValue: unknown) =>
    errors.push({ field, rejectedValue: rejectedValue ?? null, reason: SHAPE_REASON })
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail(path, value)
  const { id, text, collapsed, check, children } = value as Record<string, unknown>
  if (typeof id !== 'string') fail(`${path}.id`, id)
  if (typeof text !== 'string') fail(`${path}.text`, text)
  if (typeof collapsed !== 'boolean') fail(`${path}.collapsed`, collapsed)
  if (!CHECKS.includes(check as CheckState)) fail(`${path}.check`, check)
  if (!Array.isArray(children)) return fail(`${path}.children`, children)
  children.forEach((child, i) => shapeErrors(child, `${path}.children[${i}]`, errors))
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
    return errorBody(500, 'Internal Server Error', '마인드맵을 불러오지 못했어요.', PATH)
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
  const { expectedVersion, saveId, root } = await readBody(request)
  const shape: FieldError[] = []
  if (typeof expectedVersion !== 'number' || !Number.isInteger(expectedVersion) || expectedVersion < 0)
    shape.push({ field: 'expectedVersion', rejectedValue: expectedVersion ?? null, reason: SHAPE_REASON })
  if (typeof saveId !== 'string' || !UUID.test(saveId))
    shape.push({ field: 'saveId', rejectedValue: saveId ?? null, reason: SHAPE_REASON })
  shapeErrors(root, 'root', shape)
  if (shape.length) return errorBody(400, 'Bad Request', SHAPE_MESSAGE, PATH, shape)

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

  const failure = nextSaveFailure
  nextSaveFailure = null
  if (failure === 'server') return errorBody(500, 'Internal Server Error', '마인드맵을 저장하지 못했어요.', PATH)
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
  const { nodeId } = await readBody(request)
  if (typeof nodeId !== 'string' || !UUID.test(nodeId))
    return errorBody(400, 'Bad Request', SHAPE_REASON, CURSOR_PATH, [
      { field: 'nodeId', rejectedValue: nodeId ?? null, reason: SHAPE_REASON },
    ])
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
  /** 다음 GET 한 번을 500으로 답한다. */
  failNextLoad(on: boolean) {
    nextLoadFails = on
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
