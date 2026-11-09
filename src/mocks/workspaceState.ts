import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
import type { Task } from '../features/tasks/types/task'
import type { ScheduleResponse } from '../features/schedules/types/schedule'
import type {
  AllowedActions,
  SpaceMember,
  UnavailableReason,
  UnavailableReasons,
} from '../features/spaces/types'
import { mockSchedules, mockTasks, mockUsers, nextScheduleId, nextTaskId } from './db'
import { recomputeMockTaskReadiness } from './taskDependencies'

dayjs.extend(utc)
dayjs.extend(timezone)

/**
 * 개발용 모크의 스페이스·프로젝트·배치(위치, 담당자, 버전). 권한 규칙은 서버(pinit-monolith
 * `SpaceAccess`, `WorkspaceResourceService`)에 있고, 여기서는 화면 확인에 필요한 만큼 따라 한다.
 * 작업·일정 본문은 기존 `mockTasks`, `mockSchedules`에 그대로 두고 배치만 곁에 붙인다.
 */

const ZONE_ID = 'Asia/Seoul'

export type MockSpace = {
  id: number
  name: string
  purpose: string | null
  personal: boolean
  version: number
  deletedAt: string | null
  members: SpaceMember[]
}
export type MockProject = {
  id: number
  spaceId: number
  name: string
  outcome: string | null
  completed: boolean
  version: number
  deletedAt: string | null
}
export type Placement = {
  spaceId: number
  projectId: number | null
  assigneeId: number | null
  version: number
  /** 주간 기록의 완료 수를 세려고 남긴다. */
  completedAt?: string | null
}
export type ResourceKind = 'task' | 'schedule' | 'series'

/** 팀 스페이스에만 있는 참여자. 로그인 계정(`mockUsers`)과 겹치지 않는 번호를 쓴다. */
const teammates: { memberId: number; nickname: string }[] = [
  { memberId: 3, nickname: '김서연' },
  { memberId: 4, nickname: '박지훈' },
  { memberId: 5, nickname: '이하늘' },
]

export const nicknameOf = (memberId: number) =>
  mockUsers.find((user) => user.id === memberId)?.nickname ??
  teammates.find((member) => member.memberId === memberId)?.nickname ??
  `참여자 ${memberId}`

/** 서버처럼 개인 스페이스 번호는 회원 번호의 음수다(`actualSpace`). */
export const personalSpaceId = (memberId: number) => -memberId

export const mockSpaces: MockSpace[] = [
  {
    id: 2,
    name: '제품팀',
    purpose: '11월 웹 앱 릴리즈까지 핵심 흐름을 다듬는다',
    personal: false,
    version: 3,
    deletedAt: null,
    members: [
      { memberId: 1, nickname: nicknameOf(1), role: 'ADMIN' },
      { memberId: 3, nickname: nicknameOf(3), role: 'ADMIN' },
      { memberId: 4, nickname: nicknameOf(4), role: 'MEMBER' },
      { memberId: 5, nickname: nicknameOf(5), role: 'MEMBER' },
    ],
  },
  {
    id: 3,
    name: '독서 모임',
    purpose: '한 달에 한 권 읽고 이야기하기',
    personal: false,
    version: 1,
    deletedAt: null,
    members: [
      { memberId: 5, nickname: nicknameOf(5), role: 'ADMIN' },
      { memberId: 1, nickname: nicknameOf(1), role: 'MEMBER' },
      { memberId: 4, nickname: nicknameOf(4), role: 'MEMBER' },
    ],
  },
]

export const mockProjects: MockProject[] = [
  { id: 11, spaceId: -1, name: '이직 준비', outcome: '12월 중 지원서 세 곳 제출', completed: false, version: 1, deletedAt: null },
  { id: 12, spaceId: -1, name: '건강 루틴', outcome: '주 4회 이상 걷기', completed: false, version: 1, deletedAt: null },
  { id: 21, spaceId: 2, name: '11월 릴리즈', outcome: '11월 28일 배포', completed: false, version: 2, deletedAt: null },
  { id: 22, spaceId: 2, name: '온보딩 개선', outcome: '가입 첫 주 이탈 줄이기', completed: false, version: 1, deletedAt: null },
  { id: 31, spaceId: 3, name: '11월 발제 준비', outcome: '발제문과 질문 다섯 개', completed: false, version: 1, deletedAt: null },
]

let spaceSeq = 3
let projectSeq = 31
export const nextSpaceId = () => ++spaceSeq
export const nextProjectId = () => ++projectSeq

const personalSpaces = new Map<number, MockSpace>()

const personalSpace = (memberId: number): MockSpace => {
  let space = personalSpaces.get(memberId)
  if (!space) {
    space = {
      id: personalSpaceId(memberId),
      name: '개인',
      purpose: null,
      personal: true,
      version: 1,
      deletedAt: null,
      members: [{ memberId, nickname: nicknameOf(memberId), role: 'ADMIN' }],
    }
    personalSpaces.set(memberId, space)
  }
  return space
}

export const findSpace = (id: number): MockSpace | undefined =>
  id < 0 ? personalSpace(-id) : mockSpaces.find((space) => space.id === id)

export const findProject = (id: number) =>
  mockProjects.find((project) => project.id === id)

export const memberOf = (space: MockSpace, memberId: number) =>
  space.members.find((member) => member.memberId === memberId)

/** 회원이 참여한 스페이스. 개인 스페이스가 먼저 온다. */
export const spacesOf = (memberId: number, includeDeleted = false) => [
  personalSpace(memberId),
  ...mockSpaces.filter(
    (space) =>
      memberOf(space, memberId) && (includeDeleted || !space.deletedAt),
  ),
]

// ---------------------------------------------------------------------------
// 권한. `SpaceAccess.evaluate`와 같은 순서로 첫 이유를 남긴다.
// ---------------------------------------------------------------------------

type Block = UnavailableReason | 'INAPPLICABLE' | null
export type Permissions = {
  allowedActions: AllowedActions
  unavailableReasons: UnavailableReasons
}
export const createReasons = () => {
  const reasons: UnavailableReasons = {}
  const allow = (name: keyof AllowedActions, ...blocks: Block[]) => {
    const block = blocks.find((value) => value !== null)
    if (block === undefined) return true
    if (block !== 'INAPPLICABLE') reasons[name] = block
    return false
  }
  return { allow, reasons }
}
export const when = (condition: boolean, reason: UnavailableReason): Block =>
  condition ? reason : null
export const inapplicable = (condition: boolean): Block =>
  condition ? 'INAPPLICABLE' : null

export const spacePermissions = (
  actor: number,
  space: MockSpace,
  spaceItself: boolean,
): Permissions => {
  const member = memberOf(space, actor)
  if (!member)
    return { allowedActions: {}, unavailableReasons: {} }
  const admin = member.role === 'ADMIN'
  const deleted = space.deletedAt !== null
  const administrators = space.members.filter((item) => item.role === 'ADMIN').length
  const inTrash = when(deleted, 'SPACE_DELETED')
  const personal = when(space.personal, 'PERSONAL_SPACE')
  const adminOnly = when(!admin, 'ADMIN_ONLY')
  const { allow, reasons } = createReasons()
  const allowedActions: AllowedActions = {
    edit: allow('edit', inTrash),
    assign: allow('assign', inTrash),
    move: allow('move', inTrash),
    delete: allow('delete', inTrash, when(spaceItself && space.personal, 'PERSONAL_SPACE'), adminOnly),
    restore: allow('restore', inapplicable(!deleted), adminOnly),
    invite: allow('invite', inTrash, personal, adminOnly),
    manageMembers: allow('manageMembers', inTrash, personal, adminOnly),
    leave: allow(
      'leave',
      inTrash,
      personal,
      when(admin && administrators <= 1, 'LAST_ADMIN'),
    ),
  }
  return { allowedActions, unavailableReasons: reasons }
}

// ---------------------------------------------------------------------------
// 배치와 버전
// ---------------------------------------------------------------------------

const placements: Record<ResourceKind, Map<number, Placement>> = {
  task: new Map(),
  schedule: new Map(),
  series: new Map(),
}

const ownerOf = (kind: ResourceKind, id: number) => {
  if (kind === 'task') return mockTasks.find((task) => task.id === id)?.ownerId ?? 1
  if (kind === 'schedule')
    return mockSchedules.find((schedule) => schedule.id === id)?.ownerId ?? 1
  return 1
}

/** 배치가 없으면(예전 경로로 만든 작업, 반복 회차) 만든 사람의 개인 스페이스에 둔다. */
export const placementOf = (kind: ResourceKind, id: number): Placement => {
  let placement = placements[kind].get(id)
  if (!placement) {
    const owner = ownerOf(kind, id)
    placement = {
      spaceId: personalSpaceId(owner),
      projectId: null,
      assigneeId: owner,
      version: 1,
    }
    placements[kind].set(id, placement)
  }
  return placement
}

export const setPlacement = (kind: ResourceKind, id: number, placement: Placement) =>
  placements[kind].set(id, placement)

export const bumpVersion = (kind: ResourceKind, id: number) => {
  const placement = placementOf(kind, id)
  placement.version += 1
  return placement.version
}

export const canSee = (actor: number, placement: Placement) => {
  const space = findSpace(placement.spaceId)
  return Boolean(space && memberOf(space, actor))
}

// ---------------------------------------------------------------------------
// 변경 기록과 실시간 스트림. 서버 `WorkspaceEventsController`처럼 `changed` 이벤트를 보낸다.
// ---------------------------------------------------------------------------

export type ChangeEvent = {
  id: number
  spaceId: number
  actorId: number
  resourceType: 'TASK' | 'SCHEDULE' | 'RECURRENCE' | 'SPACE' | 'PROJECT' | 'MEMBER'
  resourceId: number
  version: number
  action: string
}
type Subscriber = { actor: number; spaceId: number | null; send: (event: ChangeEvent) => void }

const changeLog: ChangeEvent[] = []
const subscribers = new Set<Subscriber>()
let eventSeq = 0

export const recordChange = (event: Omit<ChangeEvent, 'id'>) => {
  const entry = { ...event, id: ++eventSeq }
  changeLog.push(entry)
  if (changeLog.length > 500) changeLog.shift()
  subscribers.forEach((subscriber) => {
    if (subscriber.spaceId !== null && subscriber.spaceId !== entry.spaceId) return
    const space = findSpace(entry.spaceId)
    if (!space || !memberOf(space, subscriber.actor)) return
    subscriber.send(entry)
  })
  return entry
}

export const changesAfter = (actor: number, spaceId: number | null, after: number) =>
  changeLog.filter((event) => {
    if (event.id <= after) return false
    if (spaceId !== null && event.spaceId !== spaceId) return false
    const space = findSpace(event.spaceId)
    return Boolean(space && memberOf(space, actor))
  })

export const subscribeChanges = (subscriber: Subscriber) => {
  subscribers.add(subscriber)
  return () => {
    subscribers.delete(subscriber)
  }
}

// ---------------------------------------------------------------------------
// 데모 데이터. 날짜는 오늘을 기준으로 잡아 언제 열어도 오늘 화면이 비지 않는다.
// ---------------------------------------------------------------------------

const due = (offsetDays: number) => {
  const base = dayjs().tz(ZONE_ID).add(offsetDays, 'day').startOf('day')
  return { date: base.format('YYYY-MM-DD'), zoneId: ZONE_ID, offset: base.format('Z') }
}
const at = (offsetDays: number, hour: number, minute = 0) => ({
  dateTime: dayjs()
    .tz(ZONE_ID)
    .add(offsetDays, 'day')
    .hour(hour)
    .minute(minute)
    .second(0)
    .format('YYYY-MM-DDTHH:mm:ss'),
  zoneId: ZONE_ID,
})
const createdAgo = (days: number) => dayjs().subtract(days, 'day').toISOString()

type SeedTask = {
  key: string
  title: string
  description: string
  due: number
  importance: number
  difficulty: number
  expectedDuration?: string
  completed?: boolean
  after?: string
  spaceId: number
  projectId: number | null
  assigneeId: number | null
}
type SeedSchedule = {
  title: string
  description: string
  date: { dateTime: string; zoneId: string }
  scheduleType: ScheduleResponse['scheduleType']
  state: ScheduleResponse['state']
  plannedDuration: string
  duration: string
  task?: string
  spaceId: number
  projectId: number | null
  assigneeId: number | null
}

const seedTasks: SeedTask[] = [
  { key: 'notes', title: '릴리즈 노트 초안 쓰기', description: '이번 배포에서 바뀌는 화면과 고친 오류를 정리한다', due: 1, importance: 6, difficulty: 3, expectedDuration: 'PT1H', spaceId: 2, projectId: 21, assigneeId: 1 },
  { key: 'a11y', title: '결제 화면 접근성 점검', description: '키보드 이동 순서와 오류 문구 읽기 확인', due: 2, importance: 7, difficulty: 5, spaceId: 2, projectId: 21, assigneeId: 4 },
  { key: 'qa', title: 'QA 시나리오 정리', description: '가입, 작업 만들기, 일정 완료까지 핵심 흐름 열두 개', due: 3, importance: 5, difficulty: 3, spaceId: 2, projectId: 21, assigneeId: null },
  { key: 'checklist', title: '배포 체크리스트 확정', description: '롤백 절차와 공지 시간을 함께 적는다', due: 6, importance: 8, difficulty: 2, after: 'qa', spaceId: 2, projectId: 21, assigneeId: 3 },
  { key: 'copy', title: '온보딩 첫 화면 문구 다듬기', description: '처음 쓰는 사람이 무엇부터 할지 한 문장으로', due: 0, importance: 6, difficulty: 2, expectedDuration: 'PT40M', spaceId: 2, projectId: 22, assigneeId: 1 },
  { key: 'interview', title: '가입 후 이탈 인터뷰 요약', description: '다섯 명 인터뷰에서 공통으로 나온 이유', due: -2, importance: 5, difficulty: 3, completed: true, spaceId: 2, projectId: 22, assigneeId: 5 },
  { key: 'experiment', title: '튜토리얼 단계 줄이기 실험 설계', description: '네 단계를 두 단계로 줄였을 때 비교할 지표', due: 5, importance: 4, difficulty: 5, spaceId: 2, projectId: 22, assigneeId: null },
  { key: 'review', title: '디자인 리뷰 피드백 반영', description: '목요일 리뷰에서 나온 여백과 색 대비 수정', due: 1, importance: 5, difficulty: 2, spaceId: 2, projectId: null, assigneeId: 1 },
  { key: 'chapter', title: '3장까지 읽고 메모', description: '인상 깊은 문단에 쪽수 적기', due: 4, importance: 4, difficulty: 2, expectedDuration: 'PT1H30M', spaceId: 3, projectId: 31, assigneeId: 1 },
  { key: 'questions', title: '발제 질문 다섯 개 뽑기', description: '찬반이 갈릴 만한 질문을 먼저', due: 7, importance: 5, difficulty: 3, after: 'chapter', spaceId: 3, projectId: 31, assigneeId: 1 },
  { key: 'venue', title: '모임 장소 예약', description: '토요일 오후 세 시, 여섯 명', due: 2, importance: 3, difficulty: 1, spaceId: 3, projectId: null, assigneeId: 5 },
  { key: 'resume', title: '이력서 경력 기술 업데이트', description: '최근 프로젝트 성과를 숫자로 정리', due: 3, importance: 7, difficulty: 3, spaceId: -1, projectId: 11, assigneeId: 1 },
  { key: 'portfolio', title: '포트폴리오에 사례 하나 추가', description: '문제, 결정, 결과 순서로 한 쪽', due: 8, importance: 6, difficulty: 5, after: 'resume', spaceId: -1, projectId: 11, assigneeId: 1 },
  { key: 'walk', title: '저녁 30분 걷기', description: '한강 산책로 한 바퀴', due: 0, importance: 3, difficulty: 1, expectedDuration: 'PT30M', spaceId: -1, projectId: 12, assigneeId: 1 },
  { key: 'stretch', title: '아침 스트레칭 기록', description: '어제 한 동작 적기', due: -1, importance: 2, difficulty: 1, completed: true, spaceId: -1, projectId: 12, assigneeId: 1 },
]

const seedSchedules: SeedSchedule[] = [
  { title: '릴리즈 노트 초안 쓰기', description: '변경 목록부터', date: at(0, 10, 30), scheduleType: 'DEEP_WORK', state: 'NOT_STARTED', plannedDuration: 'PT1H', duration: 'PT0S', task: 'notes', spaceId: 2, projectId: 21, assigneeId: 1 },
  { title: 'QA 싱크', description: '시나리오 담당 나누기', date: at(0, 15, 0), scheduleType: 'ADMIN_TASK', state: 'NOT_STARTED', plannedDuration: 'PT30M', duration: 'PT0S', spaceId: 2, projectId: 21, assigneeId: 1 },
  { title: '결제 화면 접근성 점검', description: '스크린 리더로 한 번 더', date: at(0, 11, 0), scheduleType: 'DEEP_WORK', state: 'SUSPENDED', plannedDuration: 'PT1H30M', duration: 'PT40M', task: 'a11y', spaceId: 2, projectId: 21, assigneeId: 4 },
  { title: '이탈 인터뷰 정리', description: '녹취 요약', date: at(-2, 14, 0), scheduleType: 'DEEP_WORK', state: 'COMPLETED', plannedDuration: 'PT1H', duration: 'PT1H10M', task: 'interview', spaceId: 2, projectId: 22, assigneeId: 5 },
  { title: '주간 계획 회의', description: '이번 주 우선순위', date: at(-1, 10, 0), scheduleType: 'ADMIN_TASK', state: 'COMPLETED', plannedDuration: 'PT30M', duration: 'PT35M', spaceId: 2, projectId: null, assigneeId: 3 },
  { title: '온보딩 문구 초안', description: '세 가지 안 쓰기', date: at(0, 13, 30), scheduleType: 'QUICK_TASK', state: 'NOT_STARTED', plannedDuration: 'PT40M', duration: 'PT0S', task: 'copy', spaceId: 2, projectId: 22, assigneeId: 1 },
  { title: '3장 읽기', description: '메모 앱 켜 두기', date: at(1, 21, 0), scheduleType: 'QUICK_TASK', state: 'NOT_STARTED', plannedDuration: 'PT1H', duration: 'PT0S', task: 'chapter', spaceId: 3, projectId: 31, assigneeId: 1 },
  { title: '저녁 걷기', description: '한강 산책로', date: at(0, 19, 30), scheduleType: 'QUICK_TASK', state: 'NOT_STARTED', plannedDuration: 'PT30M', duration: 'PT0S', task: 'walk', spaceId: -1, projectId: 12, assigneeId: 1 },
]

/** 기존 작업·일정(1~6, 1~4)은 개인 스페이스에, 발표 자료만 제품팀 릴리즈에 둔다. */
const legacyPlacements: [ResourceKind, number, Omit<Placement, 'version'>][] = [
  ['task', 4, { spaceId: 2, projectId: 21, assigneeId: 1 }],
]

const seed = () => {
  for (const [kind, id, placement] of legacyPlacements)
    if (
      (kind === 'task' ? mockTasks : mockSchedules).some((item) => item.id === id)
    )
      setPlacement(kind, id, { ...placement, version: 2 })
  const ids = new Map<string, number>()
  for (const item of seedTasks) {
    const id = nextTaskId()
    ids.set(item.key, id)
    const task: Task = {
      id,
      ownerId: 1,
      title: item.title,
      description: item.description,
      dueDate: due(item.due),
      importance: item.importance,
      difficulty: item.difficulty,
      expectedDuration: item.expectedDuration ?? null,
      completed: item.completed ?? false,
      isCompleted: item.completed ?? false,
      inboundDependencyCount: 0,
      previousTaskIds: [],
      nextTaskIds: [],
      createdAt: createdAgo(10 - item.due),
      updatedAt: createdAgo(1),
    }
    mockTasks.push(task)
    setPlacement('task', id, {
      spaceId: item.spaceId,
      projectId: item.projectId,
      assigneeId: item.assigneeId,
      version: 1,
      completedAt: item.completed ? at(item.due, 18).dateTime : null,
    })
  }
  for (const item of seedTasks) {
    if (!item.after) continue
    const from = mockTasks.find((task) => task.id === ids.get(item.after!))
    const to = mockTasks.find((task) => task.id === ids.get(item.key))
    if (!from || !to) continue
    from.nextTaskIds = [...(from.nextTaskIds ?? []), to.id]
    to.previousTaskIds = [...(to.previousTaskIds ?? []), from.id]
  }
  recomputeMockTaskReadiness(mockTasks)
  for (const item of seedSchedules) {
    const id = nextScheduleId()
    mockSchedules.push({
      id,
      ownerId: 1,
      title: item.title,
      description: item.description,
      date: item.date,
      scheduleType: item.scheduleType,
      state: item.state,
      taskId: item.task ? ids.get(item.task) : undefined,
      duration: item.duration,
      plannedDuration: item.plannedDuration,
    })
    setPlacement('schedule', id, {
      spaceId: item.spaceId,
      projectId: item.projectId,
      assigneeId: item.assigneeId,
      version: 1,
    })
  }
}
seed()
