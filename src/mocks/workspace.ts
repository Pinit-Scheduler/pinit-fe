import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
import type { Task, TaskDependency } from '../features/tasks/types/task'
import type { ScheduleResponse } from '../features/schedules/types/schedule'
import type {
  AllowedActions,
  SpaceMember,
  UnavailableReason,
} from '../features/spaces/types'
import {
  activeScheduleId,
  mockSchedules,
  mockTasks,
  nextScheduleId,
  nextTaskId,
  setActiveScheduleId,
} from './db'
import { mockCategoryOwnerId } from './categories'
import { effectiveExpectedMinutes } from './planner'
import { handleRecurrences } from './recurrences'
import { handleTrash, moveScheduleToTrash, moveTaskToTrash, restoreTrashedTask } from './trash'
import {
  applyMockTaskDependencies,
  recomputeMockTaskReadiness,
} from './taskDependencies'
import { formatIsoMinutes, toTaskResponse } from './taskResponse'
import { splitLockFailure, splitViewOf } from './taskSplit'
import {
  bumpVersion,
  canSee,
  changesAfter,
  createReasons,
  findProject,
  findSpace,
  inapplicable,
  latestChangeId,
  memberOf,
  mockProjects,
  mockSpaces,
  nextProjectId,
  nextSpaceId,
  nicknameOf,
  personalPlacement,
  personalSpaceId,
  placementOf,
  recordChange,
  setPlacement,
  spacePermissions,
  spacesOf,
  subscribeChanges,
  when,
  type ChangeEvent,
  type MockProject,
  type MockSpace,
  type Permissions,
  type Placement,
  type ResourceKind,
} from './workspaceState'

dayjs.extend(utc)
dayjs.extend(timezone)

/**
 * `/v2/spaces…`, `/v2/projects…`, `/v2/space-invitations…`, `/v2/workspace/…` 개발용 모크.
 * 응답 모양은 서버 `WorkspaceResourceController`, `SpaceController`, `ProjectController`를 따른다.
 * 저장하는 쪽은 모두 expectedVersion을 확인하고, 바뀌면 실시간 스트림으로 `changed`를 보낸다.
 * 일정은 개인 것이다(ADR-0037). 주인만 읽고 다루며, 응답의 자리는 연결 작업으로 계산하고 저장하지 않는다.
 * 살아 있는 연결이 있으면 작업의 담당자 = 일정의 주인이다. 담당이 풀리면 연결을 끊는다.
 */

const ZONE_ID = 'Asia/Seoul'

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
const noContent = () => new Response(null, { status: 204 })
const failure = (code: string, message: string, status: number) =>
  json({ code, message, resourceType: null, resourceId: null, latestVersion: null }, status)
const notFound = () => failure('NOT_FOUND', '찾을 수 없습니다.', 404)
const forbidden = () => failure('FORBIDDEN', '권한이 없습니다.', 403)
const badRequest = (message: string) => failure('BAD_REQUEST', message, 400)
/** 서버 `WorkspaceConflictException`과 같은 본문. */
const conflict = (resourceType: string, resourceId: number, latestVersion: number) =>
  json(
    {
      code: 'VERSION_CONFLICT',
      message: '다른 참여자가 먼저 수정했어요.',
      resourceType,
      resourceId,
      latestVersion,
    },
    409,
  )
const versionRequired = () =>
  failure('VERSION_REQUIRED', 'expectedVersion이 필요합니다.', 409)
/** 서버 `WorkspaceDomainControllerAdvice`의 도메인 규칙 위반(400 INVALID_REQUEST). */
const invalid = (message: string) => failure('INVALID_REQUEST', message, 400)

/** 서버 `ScheduleErrorMessages`와 같은 문구(ADR-0031, ADR-0037 §8). */
export const PERSONAL_LOCATION_ONLY =
  '일정은 내 일정으로만 둘 수 있어요. 스페이스나 프로젝트에 두려면 작업으로 만들어 주세요.'
export const PERSONAL_ASSIGNEE_ONLY =
  '일정은 만든 사람만 맡을 수 있어요. 다른 사람에게 맡기려면 작업으로 만들어 담당자를 정해 주세요.'
const LINKED_SCHEDULE_CREATE =
  "작업에 연결된 일정은 작업 화면의 '일정으로 배정'에서 만들어 주세요."

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

/** 'PT1H30M', 'PT40M', 'PT0S'와 예전 '01:00:00'을 분으로. */
const minutesOf = (value?: string | null) => {
  if (!value) return 0
  const iso = value.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/)
  if (iso) return Number(iso[1] ?? 0) * 60 + Number(iso[2] ?? 0) + Math.floor(Number(iso[3] ?? 0) / 60)
  const [h, m] = value.split(':')
  return h !== undefined && m !== undefined ? Number(h) * 60 + Number(m) : 0
}
const isoMinutes = (minutes: number) =>
  minutes <= 0 ? 'PT0S' : formatIsoMinutes(minutes).replace(/H0M$/, 'H').replace(/^PT0H/, 'PT')

const instantOf = (date: { dateTime: string; zoneId?: string }) =>
  dayjs.tz(date.dateTime, date.zoneId || ZONE_ID).valueOf()

// ---------------------------------------------------------------------------
// 응답 모양
// ---------------------------------------------------------------------------

const carry = (base: Permissions, name: keyof AllowedActions) =>
  base.allowedActions[name]
    ? null
    : (base.unavailableReasons[name] ?? ('INAPPLICABLE' as const))

const spaceOf = (placement: Placement) => findSpace(placement.spaceId)!

const metadata = (kind: ResourceKind, id: number) => {
  const placement = placementOf(kind, id)
  return {
    spaceId: placement.spaceId,
    projectId: placement.projectId,
    assigneeId: placement.assigneeId,
    assigneeNickname:
      placement.assigneeId === null ? null : nicknameOf(placement.assigneeId),
    version: placement.version,
  }
}

const seriesVersion = (seriesId?: number | null) =>
  seriesId == null ? null : placementOf('series', seriesId).version

export const taskView = (actor: number, task: Task, extra: object = {}) => {
  const placement = placementOf('task', task.id)
  const base = spacePermissions(actor, spaceOf(placement), false)
  const completed = isDone(task)
  const ready = (task.inboundDependencyCount ?? 0) === 0
  // ALREADY_SCHEDULED는 내 일정이 연결돼 있을 때만이다. 남의 일정이면 올려서 가져갈 수 있다(ADR-0037 §2, §3).
  const scheduled =
    !completed &&
    ready &&
    mockSchedules.some((schedule) => schedule.taskId === task.id && schedule.ownerId === actor)
  const split = splitViewOf(actor, task)
  // 쪼개기에 잠긴 원본은 바꿀 수 없다. 이유의 순서는 서버 `WorkspaceResourceService`와 같다.
  const locked = when(split.lock !== null, 'SPLIT_IN_PROGRESS')
  const { allow, reasons } = createReasons()
  const allowedActions: AllowedActions = {
    edit: allow('edit', carry(base, 'edit'), locked),
    assign: allow('assign', carry(base, 'assign'), locked),
    move: allow('move', carry(base, 'move'), locked),
    delete: allow('delete', carry(base, 'delete'), locked),
    restore: false,
    invite: false,
    manageMembers: false,
    leave: false,
    start: false,
    suspend: false,
    complete: allow('complete', inapplicable(completed), locked),
    cancel: false,
    reopen: allow('reopen', inapplicable(!completed), locked),
    schedule: allow(
      'schedule',
      locked,
      when(completed, 'TASK_COMPLETED'),
      when(!ready, 'PREDECESSOR_INCOMPLETE'),
      when(scheduled, 'ALREADY_SCHEDULED'),
    ),
    editDependencies: allow(
      'editDependencies',
      locked,
      when(Boolean(task.recurrence), 'RECURRING_TASK'),
    ),
  }
  return {
    task: toTaskResponse(task),
    ...metadata('task', task.id),
    allowedActions,
    unavailableReasons: reasons,
    recurrenceVersion: seriesVersion(task.recurrence?.seriesId),
    split,
    ...extra,
  }
}

const scheduleBody = (schedule: ScheduleResponse) => {
  const task =
    schedule.taskId == null
      ? undefined
      : mockTasks.find((item) => item.id === schedule.taskId)
  return {
    id: schedule.id,
    ownerId: schedule.ownerId,
    taskId: schedule.taskId ?? null,
    taskCompleted: task ? isDone(task) : null,
    title: schedule.title,
    description: schedule.description,
    date: schedule.date,
    scheduleType: schedule.scheduleType,
    duration: isoMinutes(minutesOf(schedule.duration)),
    plannedDuration: schedule.plannedDuration ?? 'PT30M',
    state: schedule.state,
    createdAt: (schedule as { createdAt?: string }).createdAt ?? null,
    updatedAt: (schedule as { updatedAt?: string }).updatedAt ?? null,
    recurrence: schedule.recurrence ?? null,
  }
}

/**
 * 일정의 자리(ADR-0037 §7). 읽는 사람이 연결 작업을 지금 읽을 수 있으면 그 작업의 스페이스·프로젝트이고,
 * 아니면 읽는 사람의 개인 스페이스다. 읽을 때 계산하고 저장하지 않는다(서버 `SchedulePlaceResolver`).
 */
const schedulePlace = (reader: number, schedule: ScheduleResponse) => {
  const task = schedule.taskId == null ? undefined : findTask(schedule.taskId)
  const placement = task ? placementOf('task', task.id) : undefined
  return placement && visibleSpace(reader, placement)
    ? { spaceId: placement.spaceId, projectId: placement.projectId }
    : { spaceId: personalSpaceId(reader), projectId: null }
}

export const scheduleView = (
  actor: number,
  schedule: ScheduleResponse,
  extra: object = {},
) => {
  const state = schedule.state
  const { allow, reasons } = createReasons()
  // 일정은 주인만 읽으므로 스페이스 역할을 보지 않는다. assign·move는 늘 꺼지고 delete는 상태로만 정한다(ADR-0037 §2).
  const allowedActions: AllowedActions = {
    edit: true,
    assign: false,
    move: false,
    delete: allow(
      'delete',
      when(!(state === 'NOT_STARTED' || state === 'COMPLETED'), 'SCHEDULE_RUNNING'),
    ),
    restore: false,
    invite: false,
    manageMembers: false,
    leave: false,
    start: state === 'NOT_STARTED' || state === 'SUSPENDED',
    suspend: state === 'IN_PROGRESS',
    complete: state === 'NOT_STARTED' || state === 'IN_PROGRESS',
    cancel: state !== 'NOT_STARTED',
    reopen: false,
    schedule: false,
    editDependencies: false,
  }
  return {
    schedule: scheduleBody(schedule),
    // 자리는 연결 작업으로 계산하고, 담당자는 언제나 주인이다(ADR-0037 §8).
    ...schedulePlace(actor, schedule),
    assigneeId: schedule.ownerId,
    assigneeNickname: nicknameOf(schedule.ownerId),
    version: placementOf('schedule', schedule.id).version,
    allowedActions,
    unavailableReasons: reasons,
    recurrenceVersion: seriesVersion(schedule.recurrence?.seriesId),
    ...extra,
  }
}

const rawSpace = (actor: number, space: MockSpace) => {
  const permissions = spacePermissions(actor, space, true)
  return {
    id: space.id,
    name: space.name,
    purpose: space.purpose,
    personal: space.personal,
    version: space.version,
    deletedAt: space.deletedAt,
    ...permissions,
  }
}

const projectView = (actor: number, project: MockProject) => {
  const space = findSpace(project.spaceId)!
  const base = spacePermissions(actor, space, false)
  const deleted = project.deletedAt !== null
  const admin = memberOf(space, actor)?.role === 'ADMIN'
  const { allow, reasons } = createReasons()
  const gone = when(deleted, 'PROJECT_DELETED')
  return {
    id: project.id,
    spaceId: project.spaceId,
    name: project.name,
    outcome: project.outcome,
    completed: project.completed,
    version: project.version,
    deletedAt: project.deletedAt,
    allowedActions: {
      edit: allow('edit', carry(base, 'edit'), gone),
      assign: allow('assign', carry(base, 'assign'), gone),
      move: allow('move', carry(base, 'move'), gone),
      delete: allow('delete', carry(base, 'delete'), gone),
      restore: allow(
        'restore',
        when(space.deletedAt !== null, 'SPACE_DELETED'),
        deleted ? null : 'INAPPLICABLE',
        when(!admin, 'ADMIN_ONLY'),
      ),
    } satisfies AllowedActions,
    unavailableReasons: reasons,
  }
}

// ---------------------------------------------------------------------------
// 공통 검사
// ---------------------------------------------------------------------------

type Location = { spaceId?: number | null; projectId?: number | null }
type Assignee = { memberId?: number | null }

/** 위치를 확인한다. 문제가 있으면 응답을, 아니면 확정한 위치를 돌려준다. */
const resolveLocation = (
  actor: number,
  location: Location | null | undefined,
): Response | { spaceId: number; projectId: number | null } => {
  const spaceId = location?.spaceId ?? personalSpaceId(actor)
  const space = findSpace(spaceId)
  if (!space || !memberOf(space, actor)) return forbidden()
  if (space.deletedAt)
    return failure('SPACE_UNAVAILABLE', '삭제된 스페이스입니다.', 404)
  const projectId = location?.projectId ?? null
  if (projectId !== null) {
    const project = findProject(projectId)
    if (!project || project.spaceId !== spaceId || project.deletedAt)
      return badRequest('프로젝트가 이 스페이스에 없습니다.')
  }
  return { spaceId, projectId }
}

const resolveAssignee = (
  spaceId: number,
  assignee: Assignee | null | undefined,
  fallback: number | null,
): Response | number | null => {
  if (assignee === undefined || assignee === null) return fallback
  const memberId = assignee.memberId ?? null
  if (memberId === null) return null
  const space = findSpace(spaceId)
  if (!space || !memberOf(space, memberId))
    return badRequest('담당자는 이 스페이스 참여자여야 합니다.')
  return memberId
}

const emit = (
  actor: number,
  kind: ResourceKind,
  id: number,
  action: string,
) => {
  const placement = placementOf(kind, id)
  recordChange({
    spaceId: placement.spaceId,
    actorId: actor,
    resourceType: kind === 'task' ? 'TASK' : kind === 'schedule' ? 'SCHEDULE' : 'RECURRENCE',
    resourceId: id,
    version: placement.version,
    action,
  })
}

const visibleSpace = (actor: number, placement: Placement) => {
  const space = findSpace(placement.spaceId)
  return Boolean(space && !space.deletedAt && memberOf(space, actor))
}

/**
 * 일정과 FIXED 반복의 위치·담당자 검사(서버 `PersonalSchedulePlacement`). location은 생략 또는
 * {spaceId: -주인, projectId: null}만, assignee는 생략 또는 {memberId: 주인}만 받는다. 위치를 먼저 본다.
 * 받아들인 값은 아무것도 바꾸지 않는다. 어기면 400 응답을, 아니면 null을 돌려준다.
 */
const requirePersonal = (
  owner: number,
  location: Location | null | undefined,
  assignee: Assignee | null | undefined,
): Response | null => {
  if (location != null && (location.spaceId !== personalSpaceId(owner) || location.projectId != null))
    return invalid(PERSONAL_LOCATION_ONLY)
  if (assignee != null && assignee.memberId !== owner) return invalid(PERSONAL_ASSIGNEE_ONLY)
  return null
}

/**
 * 일정과 작업의 연결을 끊는다. 일정의 상태·시간·내용과 작업의 완료 여부는 그대로이고 일정의 version만 오른다.
 * 기록은 주인의 스트림에 `SCHEDULE UPDATED`로 남긴다(ADR-0037 §3, §13). 이미 끊겼으면 아무것도 하지 않는다.
 */
const cutLink = (actor: number, schedule: ScheduleResponse) => {
  if (schedule.taskId == null) return false
  schedule.taskId = undefined
  bumpVersion('schedule', schedule.id)
  emit(actor, 'schedule', schedule.id, 'UPDATED')
  return true
}

/** 작업의 담당자가 연결 일정의 주인이 아니게 되면 연결을 끊는다(서버 `ScheduleLinkService.cutIfOwnerNotAssignee`). */
const cutIfOwnerNotAssignee = (actor: number, task: Task) => {
  const linked = mockSchedules.find((schedule) => schedule.taskId === task.id)
  if (linked && linked.ownerId !== placementOf('task', task.id).assigneeId) cutLink(actor, linked)
}

// ---------------------------------------------------------------------------
// 작업
// ---------------------------------------------------------------------------

type TaskBody = Partial<{
  title: string
  description: string
  dueDate: Task['dueDate']
  importance: number
  difficulty: number
  expectedDuration: string | null
  addDependencies: TaskDependency[]
  removeDependencies: TaskDependency[]
  tagIds: number[]
}>

const sorters: Record<string, (a: Task, b: Task) => number> = {
  DEADLINE_ASC: (a, b) =>
    (a.dueDate?.date ?? '9999').localeCompare(b.dueDate?.date ?? '9999') || a.id - b.id,
  DEADLINE_DESC: (a, b) =>
    (b.dueDate?.date ?? '0000').localeCompare(a.dueDate?.date ?? '0000') || b.id - a.id,
  IMPORTANCE_DESC: (a, b) => b.importance - a.importance || a.id - b.id,
  DIFFICULTY_ASC: (a, b) => a.difficulty - b.difficulty || a.id - b.id,
  DIFFICULTY_DESC: (a, b) => b.difficulty - a.difficulty || a.id - b.id,
  CREATED_DESC: (a, b) =>
    (b.createdAt ?? '').localeCompare(a.createdAt ?? '') || b.id - a.id,
  TITLE_ASC: (a, b) => a.title.localeCompare(b.title, 'ko') || a.id - b.id,
}

const page = <T>(items: T[], searchParams: URLSearchParams) => {
  const number = Math.max(0, Number(searchParams.get('page') ?? 0) || 0)
  const size = Math.max(1, Number(searchParams.get('size') ?? 20) || 20)
  const content = items.slice(number * size, number * size + size)
  const totalPages = Math.max(1, Math.ceil(items.length / size))
  return {
    content,
    number,
    size,
    totalElements: items.length,
    totalPages,
    numberOfElements: content.length,
    first: number === 0,
    last: number >= totalPages - 1,
    empty: content.length === 0,
  }
}

const listTasks = (actor: number, searchParams: URLSearchParams) => {
  const today = dayjs().tz(ZONE_ID).format('YYYY-MM-DD')
  const param = (name: string) => searchParams.get(name)
  const spaceId = param('spaceId') === null ? null : Number(param('spaceId'))
  const projectId = param('projectId') === null ? null : Number(param('projectId'))
  const mine = param('mine') === null ? spaceId === null : param('mine') === 'true'
  const status = param('readyOnly') === 'true' ? 'READY' : (param('status') ?? 'CURRENT')
  const exact = param('date') ?? param('dueDate')
  const from = exact ?? param('deadlineFrom')
  const to = exact ?? param('deadlineTo')
  const query = (param('q') ?? '').trim().toLowerCase()
  const importanceMin = Number(param('importanceMin') ?? 0)
  const difficultyMax = Number(param('difficultyMax') ?? Infinity)
  const unassigned = param('unassigned') === 'true'
  const items = mockTasks
    .filter((task) => {
      const placement = placementOf('task', task.id)
      if (!visibleSpace(actor, placement)) return false
      if (spaceId !== null && placement.spaceId !== spaceId) return false
      if (projectId !== null && placement.projectId !== projectId) return false
      if (mine && placement.assigneeId !== actor) return false
      if (unassigned && placement.assigneeId !== null) return false
      const done = isDone(task)
      const blocked = (task.inboundDependencyCount ?? 0) > 0
      const dueDate = task.dueDate?.date ?? ''
      if (status === 'CURRENT' && done && dueDate < today) return false
      if (status === 'OPEN' && done) return false
      if (status === 'READY' && (done || blocked)) return false
      if (status === 'BLOCKED' && (done || !blocked)) return false
      if (status === 'COMPLETED' && !done) return false
      if (from && dueDate < from) return false
      if (to && dueDate > to) return false
      if (task.importance < importanceMin) return false
      if (task.difficulty > difficultyMax) return false
      if (query && !`${task.title} ${task.description}`.toLowerCase().includes(query))
        return false
      return true
    })
    .sort(sorters[param('sort') ?? 'DEADLINE_ASC'] ?? sorters.DEADLINE_ASC)
  const result = page(items, searchParams)
  return json({ ...result, content: result.content.map((task) => taskView(actor, task)) })
}

const findTask = (id: number) => mockTasks.find((task) => task.id === id)
const findSchedule = (id: number) =>
  mockSchedules.find((schedule) => schedule.id === id)

/** 실제 서버처럼 접근할 수 없는 작업은 없는 것과 같다. */
const visibleTask = (actor: number, id: number) => {
  const task = findTask(id)
  return task && canSee(actor, placementOf('task', id)) ? task : undefined
}
/** 일정은 주인만 읽는다. 스페이스 관리자도 남의 일정은 없는 것과 같다(ADR-0037 §2). */
const visibleSchedule = (actor: number, id: number) => {
  const schedule = findSchedule(id)
  return schedule && schedule.ownerId === actor ? schedule : undefined
}

const allowedFor = (view: { allowedActions: AllowedActions }, action: keyof AllowedActions) =>
  view.allowedActions[action] === true

const createTask = async (actor: number, request: Request) => {
  const body = await readJson<{ task?: TaskBody; location?: Location; assignee?: Assignee }>(request)
  const input = body?.task
  if (!input?.title?.trim()) return badRequest('제목을 입력해 주세요.')
  if (!input.dueDate?.date) return badRequest('마감일을 골라 주세요.')
  const location = resolveLocation(actor, body?.location)
  if (location instanceof Response) return location
  const assignee = resolveAssignee(location.spaceId, body?.assignee, actor)
  if (assignee instanceof Response) return assignee
  const task: Task = {
    id: nextTaskId(),
    ownerId: actor,
    title: input.title.trim(),
    description: input.description ?? '',
    dueDate: input.dueDate,
    importance: input.importance ?? 5,
    difficulty: input.difficulty ?? 1,
    expectedDuration:
      input.expectedDuration && input.expectedDuration !== 'PT0S'
        ? input.expectedDuration
        : null,
    isCompleted: false,
    completed: false,
    inboundDependencyCount: 0,
    previousTaskIds: [],
    nextTaskIds: [],
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }
  const dependencies = applyMockTaskDependencies([...mockTasks, task], task.id, {
    addDependencies: input.addDependencies,
  })
  if (!dependencies.ok) return badRequest(dependencies.message)
  mockTasks.push(task)
  recomputeMockTaskReadiness(mockTasks)
  setPlacement('task', task.id, { ...location, assigneeId: assignee, version: 1 })
  emit(actor, 'task', task.id, 'CREATED')
  return json(taskView(actor, task), 201)
}

type MoveResult = {
  movedTaskIds: number[]
  movedScheduleIds: number[]
  removedDependencyCount: number
}

/**
 * 작업만 옮긴다. 일정은 어느 스페이스에도 속하지 않으므로 함께 옮기지 않고 movedScheduleIds는 늘 비었다.
 * 이동으로 담당이 풀리면 updateTask가 연결을 끊는다(ADR-0037 §3).
 */
const moveTask = (task: Task, to: { spaceId: number; projectId: number | null }): MoveResult | null => {
  const placement = placementOf('task', task.id)
  if (placement.spaceId === to.spaceId && placement.projectId === to.projectId) return null
  placement.spaceId = to.spaceId
  placement.projectId = to.projectId
  return { movedTaskIds: [], movedScheduleIds: [], removedDependencyCount: 0 }
}

const updateTask = async (actor: number, task: Task, request: Request) => {
  const body = await readJson<{
    expectedVersion?: number
    task?: TaskBody | null
    location?: Location | null
    assignee?: Assignee | null
  }>(request)
  const placement = placementOf('task', task.id)
  if (body?.expectedVersion == null) return versionRequired()
  if (body.expectedVersion !== placement.version)
    return conflict('TASK', task.id, placement.version)
  const before = taskView(actor, task)
  if (body.task && !allowedFor(before, 'edit')) return forbidden()
  let move: MoveResult | null = null
  let destination: { spaceId: number; projectId: number | null } | null = null
  if (body.location) {
    if (!allowedFor(before, 'move')) return forbidden()
    const resolved = resolveLocation(actor, body.location)
    if (resolved instanceof Response) return resolved
    destination = resolved
  }
  let assignee: number | null | undefined
  if (body.assignee !== undefined && body.assignee !== null) {
    if (!allowedFor(before, 'assign')) return forbidden()
    const resolved = resolveAssignee(destination?.spaceId ?? placement.spaceId, body.assignee, placement.assigneeId)
    if (resolved instanceof Response) return resolved
    assignee = resolved
  }
  if (body.task) {
    const { addDependencies, removeDependencies, tagIds: _tags, ...fields } = body.task
    void _tags
    if (addDependencies?.length || removeDependencies?.length) {
      const result = applyMockTaskDependencies(mockTasks, task.id, {
        addDependencies,
        removeDependencies,
      })
      if (!result.ok) return json({ message: result.message }, result.status)
    }
    if (fields.title !== undefined) task.title = fields.title
    if (fields.description !== undefined) task.description = fields.description
    if (fields.dueDate !== undefined) task.dueDate = fields.dueDate
    if (fields.importance !== undefined) task.importance = fields.importance
    if (fields.difficulty !== undefined) task.difficulty = fields.difficulty
    if (fields.expectedDuration !== undefined)
      task.expectedDuration =
        fields.expectedDuration === 'PT0S' ? null : fields.expectedDuration
    recomputeMockTaskReadiness(mockTasks)
  }
  if (destination) move = moveTask(task, destination)
  // 다른 스페이스로 옮기면서 담당자를 고르지 않았는데 지금 담당자가 그곳에 없으면 비운다.
  if (assignee !== undefined) placement.assigneeId = assignee
  else if (destination) {
    const space = findSpace(destination.spaceId)
    if (placement.assigneeId !== null && space && !memberOf(space, placement.assigneeId))
      placement.assigneeId = null
  }
  // 재배정, 담당 비우기, 이동으로 담당이 풀리면 연결을 끊는다. 일정 쪽 기록은 주인의 스트림으로 간다.
  cutIfOwnerNotAssignee(actor, task)
  task.updatedAt = nowIso()
  placement.version += 1
  emit(actor, 'task', task.id, 'UPDATED')
  return json(taskView(actor, task, move ? { moveResult: move } : {}))
}

const changeTaskState = async (actor: number, task: Task, request: Request) => {
  const body = await readJson<{ expectedVersion?: number; action?: string }>(request)
  const placement = placementOf('task', task.id)
  if (body?.expectedVersion == null) return versionRequired()
  if (body.expectedVersion !== placement.version)
    return conflict('TASK', task.id, placement.version)
  const action = body.action?.toUpperCase()
  if (action !== 'COMPLETE' && action !== 'REOPEN')
    return badRequest('action은 COMPLETE 또는 REOPEN이어야 합니다.')
  setTaskCompleted(task, action === 'COMPLETE')
  placement.version += 1
  emit(actor, 'task', task.id, 'STATE_CHANGED')
  return json(taskView(actor, task))
}

const setTaskCompleted = (task: Task, completed: boolean) => {
  task.completed = completed
  task.isCompleted = completed
  task.updatedAt = nowIso()
  placementOf('task', task.id).completedAt = completed
    ? dayjs().tz(ZONE_ID).format('YYYY-MM-DDTHH:mm:ss')
    : null
  recomputeMockTaskReadiness(mockTasks)
}

const deleteTask = (actor: number, task: Task, searchParams: URLSearchParams) => {
  const placement = placementOf('task', task.id)
  const expected = searchParams.get('expectedVersion')
  if (expected === null) return versionRequired()
  if (Number(expected) !== placement.version)
    return conflict('TASK', task.id, placement.version)
  if (!allowedFor(taskView(actor, task), 'delete')) return forbidden()
  // deleteSchedules는 지우는 사람 자신의 일정에만 적용한다. 남의 연결 일정은 연결만 끊긴다(ADR-0037 §5).
  const moved = moveTaskToTrash(task.id, searchParams.get('deleteSchedules') === 'true', actor)
  recomputeMockTaskReadiness(mockTasks)
  placement.version += 1
  // 연결 일정은 끊기거나 함께 휴지통으로 가며 버전이 오른다. 끊긴 일정은 주인의 스트림에 UPDATED를 남긴다.
  if (moved) {
    for (const id of moved.trashedScheduleIds) bumpVersion('schedule', id)
    for (const id of moved.cutScheduleIds) {
      bumpVersion('schedule', id)
      emit(actor, 'schedule', id, 'UPDATED')
    }
  }
  emit(actor, 'task', task.id, 'DELETED')
  return noContent()
}

const SCHEDULE_REASON_MESSAGES: Partial<Record<UnavailableReason, string>> = {
  TASK_COMPLETED: '완료한 작업은 일정으로 옮길 수 없습니다.',
  PREDECESSOR_INCOMPLETE: '이전 작업을 먼저 완료해 주세요.',
  ALREADY_SCHEDULED: '이미 일정이 있는 작업입니다.',
}

const scheduleTask = async (actor: number, task: Task, request: Request) => {
  const body = await readJson<{
    expectedVersion?: number
    schedule?: {
      date?: ScheduleResponse['date']
      scheduleType?: ScheduleResponse['scheduleType']
      title?: string
      description?: string
      plannedDuration?: string
    }
  }>(request)
  const placement = placementOf('task', task.id)
  if (body?.expectedVersion == null) return versionRequired()
  if (body.expectedVersion !== placement.version)
    return conflict('TASK', task.id, placement.version)
  const view = taskView(actor, task)
  const reason = view.unavailableReasons.schedule
  if (reason) return failure(reason, SCHEDULE_REASON_MESSAGES[reason] ?? '일정으로 옮길 수 없습니다.', 409)
  if (!body.schedule?.date) return badRequest('일정 시작 시각을 골라 주세요.')
  // 가져가기: 남의 일정이 이 작업에 연결돼 있으면 그 연결을 끊는다. 그 일정은 주인의 독립 일정으로 남는다(ADR-0037 §3).
  const taken = mockSchedules.find((item) => item.taskId === task.id)
  if (taken) cutLink(actor, taken)
  const schedule: ScheduleResponse = {
    id: nextScheduleId(),
    ownerId: actor,
    title: body.schedule.title?.trim() || task.title,
    description: body.schedule.description ?? task.description,
    date: body.schedule.date,
    scheduleType: body.schedule.scheduleType ?? 'DEEP_WORK',
    state: 'NOT_STARTED',
    taskId: task.id,
    duration: 'PT0S',
    plannedDuration:
      body.schedule.plannedDuration ?? formatIsoMinutes(effectiveExpectedMinutes(task)),
  }
  mockSchedules.push(schedule)
  // 일정은 올린 사람의 것이고, 올리는 순간 작업의 담당자가 올린 사람이 된다. 작업 버전도 오른다(`claimTask`).
  setPlacement('schedule', schedule.id, personalPlacement(actor))
  placement.assigneeId = actor
  task.updatedAt = nowIso()
  placement.version += 1
  emit(actor, 'task', task.id, 'UPDATED')
  emit(actor, 'schedule', schedule.id, 'CREATED')
  return json(scheduleView(actor, schedule), 201)
}

const restoreResource = async (
  actor: number,
  kind: 'task' | 'schedule',
  id: number,
  request: Request,
) => {
  const body = await readJson<{ expectedVersion?: number }>(request)
  const placement = placementOf(kind, id)
  if (body?.expectedVersion == null) return versionRequired()
  if (!canSee(actor, placement)) return notFound()
  if (body.expectedVersion !== placement.version)
    return conflict(kind === 'task' ? 'TASK' : 'SCHEDULE', id, placement.version)
  if (kind === 'task') {
    const restored = restoreTrashedTask(id, actor)
    if (!restored) return notFound()
    placement.version += 1
    recomputeMockTaskReadiness(mockTasks)
    emit(actor, kind, id, 'RESTORED')
    // 함께 지운 일정은 누가 복원하든 주인의 독립 일정으로 돌아오고, 기록은 주인의 스트림에 남는다.
    // 응답의 restoredScheduleIds에는 부른 사람의 일정만 든다(ADR-0037 §5, §13).
    for (const scheduleId of restored.scheduleIds) {
      bumpVersion('schedule', scheduleId)
      emit(actor, 'schedule', scheduleId, 'RESTORED')
    }
    return json(taskView(actor, findTask(id)!, { restoreResult: restored.result }))
  }
  // 일정 복원은 주인의 명령이다. 작업과 함께 지운 일정도 혼자 복원하고, 작업에 다시 잇지 않는다.
  const restored = handleTrash(`/v2/trash/${kind}s/${id}/restore`, 'POST', actor)
  if (!restored) return notFound()
  if (!restored.ok) return restored
  const restoreResult = await restored.json()
  placement.version += 1
  emit(actor, kind, id, 'RESTORED')
  return json(scheduleView(actor, findSchedule(id)!, { restoreResult }))
}

const purgeResource = (
  actor: number,
  kind: 'task' | 'schedule',
  id: number,
  searchParams: URLSearchParams,
) => {
  const placement = placementOf(kind, id)
  const expected = searchParams.get('expectedVersion')
  if (expected === null) return versionRequired()
  if (!canSee(actor, placement)) return notFound()
  if (Number(expected) !== placement.version)
    return conflict(kind === 'task' ? 'TASK' : 'SCHEDULE', id, placement.version)
  const purged = handleTrash(`/v2/trash/${kind}s/${id}`, 'DELETE', actor)
  if (!purged) return notFound()
  if (purged.ok) {
    placement.version += 1
    emit(actor, kind, id, 'PURGED')
  }
  return purged
}

// ---------------------------------------------------------------------------
// 일정
// ---------------------------------------------------------------------------

type ScheduleBody = Partial<{
  title: string
  description: string
  date: ScheduleResponse['date']
  scheduleType: ScheduleResponse['scheduleType']
  plannedDuration: string
  taskId: number
}>

const listSchedules = (actor: number, searchParams: URLSearchParams) => {
  const param = (name: string) => searchParams.get(name)
  const start = param('start') ? Date.parse(param('start')!) : -Infinity
  const end = param('end') ? Date.parse(param('end')!) : Infinity
  const spaceId = param('spaceId') === null ? null : Number(param('spaceId'))
  const projectId = param('projectId') === null ? null : Number(param('projectId'))
  // 모두 내 일정이다. spaceId·projectId는 계산한 자리로 거르고, mine은 받되 결과를 바꾸지 않는다(ADR-0037 §8).
  const items = mockSchedules
    .filter((schedule) => {
      if (schedule.ownerId !== actor) return false
      const place = schedulePlace(actor, schedule)
      if (spaceId !== null && place.spaceId !== spaceId) return false
      if (projectId !== null && place.projectId !== projectId) return false
      const instant = instantOf(schedule.date)
      return instant >= start && instant < end
    })
    .sort((a, b) => instantOf(a.date) - instantOf(b.date) || a.id - b.id)
  return json(items.map((schedule) => scheduleView(actor, schedule)))
}

const createSchedule = async (actor: number, request: Request) => {
  const body = await readJson<{ schedule?: ScheduleBody; location?: Location; assignee?: Assignee }>(request)
  const input = body?.schedule
  if (!input?.title?.trim()) return badRequest('제목을 입력해 주세요.')
  if (!input.date?.dateTime) return badRequest('일정 시작 시각을 골라 주세요.')
  if (!input.scheduleType) return badRequest('일정 종류를 골라 주세요.')
  // 일정은 개인 것이다. 팀 스페이스·프로젝트·남의 개인 스페이스나 다른 담당자를 고르면 조용히 무시하지 않고 거절한다.
  const personal = requirePersonal(actor, body?.location, body?.assignee)
  if (personal) return personal
  if (input.taskId != null) return invalid(LINKED_SCHEDULE_CREATE)
  const schedule: ScheduleResponse = {
    id: nextScheduleId(),
    ownerId: actor,
    title: input.title.trim(),
    description: input.description ?? '',
    date: input.date,
    scheduleType: input.scheduleType,
    state: 'NOT_STARTED',
    taskId: undefined,
    duration: 'PT0S',
    plannedDuration: input.plannedDuration ?? 'PT30M',
  }
  mockSchedules.push(schedule)
  setPlacement('schedule', schedule.id, personalPlacement(actor))
  emit(actor, 'schedule', schedule.id, 'CREATED')
  return json(scheduleView(actor, schedule), 201)
}

const updateSchedule = async (actor: number, schedule: ScheduleResponse, request: Request) => {
  const body = await readJson<{
    expectedVersion?: number
    schedule?: ScheduleBody | null
    location?: Location | null
    assignee?: Assignee | null
  }>(request)
  const placement = placementOf('schedule', schedule.id)
  // 서버 순서: 위치·담당자 검사가 버전 검사보다 먼저다. 받아들인 location·assignee는 아무것도 바꾸지 않고,
  // 연결 작업도 옮기지 않는다(ADR-0037 §8).
  const personal = requirePersonal(actor, body?.location, body?.assignee)
  if (personal) return personal
  if (body?.expectedVersion == null) return versionRequired()
  if (body.expectedVersion !== placement.version)
    return conflict('SCHEDULE', schedule.id, placement.version)
  if (body.schedule) {
    const fields = body.schedule
    if (fields.title !== undefined) schedule.title = fields.title
    if (fields.description !== undefined) schedule.description = fields.description
    if (fields.date !== undefined) schedule.date = fields.date
    if (fields.scheduleType !== undefined) schedule.scheduleType = fields.scheduleType
    if (fields.plannedDuration !== undefined) schedule.plannedDuration = fields.plannedDuration
  }
  ;(schedule as { updatedAt?: string }).updatedAt = nowIso()
  placement.version += 1
  emit(actor, 'schedule', schedule.id, 'UPDATED')
  return json(scheduleView(actor, schedule))
}

const changeScheduleState = async (actor: number, schedule: ScheduleResponse, request: Request) => {
  const body = await readJson<{ expectedVersion?: number; action?: string }>(request)
  const placement = placementOf('schedule', schedule.id)
  if (body?.expectedVersion == null) return versionRequired()
  if (body.expectedVersion !== placement.version)
    return conflict('SCHEDULE', schedule.id, placement.version)
  const action = body.action?.toUpperCase()
  const task = schedule.taskId == null ? undefined : findTask(schedule.taskId)
  const state = schedule.state
  // 오류 문구는 기존 `/v2/schedules/{id}/...` 모크와 같다.
  if (action === 'START') {
    if (state !== 'NOT_STARTED' && state !== 'SUSPENDED')
      return json({ message: '이 상태에서는 시작할 수 없습니다.' }, 409)
    // 상태 변경은 주인만 하므로 진행자는 늘 주인이다(ADR-0037 §4).
    if (mockSchedules.some((item) => item.id !== schedule.id && item.state === 'IN_PROGRESS' && item.ownerId === actor))
      return json({ message: '이미 실행 중인 일정이 존재합니다.' }, 409)
    if (task && (task.inboundDependencyCount ?? 0) > 0)
      return json({ message: '이전 작업을 먼저 완료해 주세요.' }, 409)
    setActiveScheduleId(schedule.id, 'IN_PROGRESS')
    schedule.state = 'IN_PROGRESS'
  } else if (action === 'SUSPEND') {
    if (state !== 'IN_PROGRESS')
      return json({ message: '진행 중인 일정만 일시정지할 수 있습니다.' }, 409)
    schedule.state = 'SUSPENDED'
  } else if (action === 'COMPLETE') {
    if (state !== 'NOT_STARTED' && state !== 'IN_PROGRESS')
      return json({ message: '이 상태에서는 완료할 수 없습니다.' }, 409)
    schedule.state = 'COMPLETED'
    if (minutesOf(schedule.duration) === 0) schedule.duration = schedule.plannedDuration ?? 'PT30M'
    if (activeScheduleId === schedule.id) setActiveScheduleId(null)
    if (task && !isDone(task)) {
      setTaskCompleted(task, true)
      bumpVersion('task', task.id)
    }
  } else if (action === 'CANCEL') {
    if (state === 'NOT_STARTED')
      return json({ message: '시작하지 않은 일정은 취소할 수 없습니다.' }, 409)
    schedule.state = 'NOT_STARTED'
    schedule.duration = 'PT0S'
    if (activeScheduleId === schedule.id) setActiveScheduleId(null)
    if (task && isDone(task)) {
      setTaskCompleted(task, false)
      bumpVersion('task', task.id)
    }
  } else return badRequest('action은 START, SUSPEND, COMPLETE, CANCEL 중 하나여야 합니다.')
  ;(schedule as { updatedAt?: string }).updatedAt = nowIso()
  placement.version += 1
  // 서버 순서: 일정 기록 다음에 연결 작업 기록(바뀌지 않았어도 남긴다).
  emit(actor, 'schedule', schedule.id, 'STATE_CHANGED')
  if (task) emit(actor, 'task', task.id, 'STATE_CHANGED')
  return json(scheduleView(actor, schedule))
}

const deleteSchedule = (actor: number, schedule: ScheduleResponse, searchParams: URLSearchParams) => {
  const placement = placementOf('schedule', schedule.id)
  const expected = searchParams.get('expectedVersion')
  if (expected === null) return versionRequired()
  if (Number(expected) !== placement.version)
    return conflict('SCHEDULE', schedule.id, placement.version)
  // 삭제는 주인의 명령이고 상태 규칙만 본다(ADR-0037 §5).
  const view = scheduleView(actor, schedule)
  if (view.unavailableReasons.delete === 'SCHEDULE_RUNNING')
    return failure('SCHEDULE_RUNNING', '진행 중이거나 일시정지한 일정은 삭제할 수 없습니다.', 409)
  moveScheduleToTrash(schedule.id)
  placement.version += 1
  emit(actor, 'schedule', schedule.id, 'DELETED')
  return noContent()
}

// ---------------------------------------------------------------------------
// 반복. 회차 생성 규칙은 기존 `/v2/recurrences` 모크를 그대로 쓰고 배치만 붙인다.
// ---------------------------------------------------------------------------

type SeriesLike = { id: number | null; [key: string]: unknown }

const isFixed = (series: unknown) =>
  (series as { mode?: unknown } | null | undefined)?.mode === 'FIXED'

const seriesView = (series: SeriesLike, extra: object = {}) => ({
  recurrence: series,
  ...(series.id === null
    ? { spaceId: 0, projectId: null, assigneeId: null, assigneeNickname: null, version: 0 }
    : metadata('series', series.id)),
  // FIXED는 주인만 보고 고치고 지운다. 담당·이동은 끈다(ADR-0037 §9).
  allowedActions: { edit: true, assign: !isFixed(series), move: !isFixed(series), delete: true },
  unavailableReasons: {},
  ...extra,
})

/**
 * FLEXIBLE 반복의 위치를 그 회차 작업에도 맞추고, 담당이 풀린 회차의 연결을 끊는다.
 * FIXED 회차 일정은 개인 것이라 시리즈의 위치·담당자를 복사하지 않는다(ADR-0037 §9).
 */
const placeOccurrences = (actor: number, seriesId: number) => {
  const series = placementOf('series', seriesId)
  for (const task of mockTasks.filter((item) => item.recurrence?.seriesId === seriesId)) {
    const placement = placementOf('task', task.id)
    placement.spaceId = series.spaceId
    placement.projectId = series.projectId
    placement.assigneeId = series.assigneeId
    cutIfOwnerNotAssignee(actor, task)
  }
}

const handleWorkspaceRecurrences = async (
  actor: number,
  rest: string,
  method: string,
  searchParams: URLSearchParams,
  request: Request,
) => {
  const legacyPath = `/v2/recurrences${rest}`
  const legacy = (body?: unknown, legacyMethod = method) =>
    handleRecurrences(
      legacyPath,
      legacyMethod,
      searchParams,
      new Request(request.url, {
        method: legacyMethod,
        headers: request.headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    )
  if (rest === '' && method === 'GET') {
    const response = await legacy()
    if (!response?.ok) return response
    const { recurrences } = (await response.json()) as { recurrences: SeriesLike[] }
    const spaceId = searchParams.get('spaceId')
    const projectId = searchParams.get('projectId')
    return json(
      recurrences
        .filter((series) => {
          if (series.id === null) return true
          const placement = placementOf('series', series.id)
          if (!visibleSpace(actor, placement)) return false
          if (spaceId !== null && placement.spaceId !== Number(spaceId)) return false
          return projectId === null || placement.projectId === Number(projectId)
        })
        .map((series) => seriesView(series)),
    )
  }
  if (rest === '' && method === 'POST') {
    const body = await readJson<{ recurrence?: { mode?: unknown }; location?: Location; assignee?: Assignee }>(request)
    let placement: Placement
    if (isFixed(body?.recurrence)) {
      // FIXED 시리즈는 전체가 개인 것이다. 일정과 같은 위치·담당자 규칙으로 거절한다(ADR-0037 §8, §9).
      const personal = requirePersonal(actor, body?.location, body?.assignee)
      if (personal) return personal
      placement = personalPlacement(actor)
    } else {
      const location = resolveLocation(actor, body?.location)
      if (location instanceof Response) return location
      const assignee = resolveAssignee(location.spaceId, body?.assignee, actor)
      if (assignee instanceof Response) return assignee
      placement = { ...location, assigneeId: assignee, version: 1 }
    }
    const response = await legacy(body?.recurrence ?? {})
    if (!response?.ok) return response
    const series = (await response.json()) as SeriesLike
    if (series.id !== null) {
      setPlacement('series', series.id, placement)
      placeOccurrences(actor, series.id)
      emit(actor, 'series', series.id, 'CREATED')
    }
    return json(seriesView(series), 201)
  }
  const id = Number(rest.slice(1))
  if (!Number.isInteger(id)) return null
  const placement = placementOf('series', id)
  if (!canSee(actor, placement)) return notFound()
  if (method === 'GET') {
    const response = await legacy()
    if (!response?.ok) return response
    return json(seriesView((await response.json()) as SeriesLike))
  }
  if (method === 'PATCH') {
    const body = await readJson<{
      expectedVersion?: number
      recurrence?: unknown
      location?: Location | null
      assignee?: Assignee | null
    }>(request)
    if (body?.expectedVersion == null) return versionRequired()
    if (body.expectedVersion !== placement.version)
      return conflict('RECURRENCE', id, placement.version)
    const current = await legacy(undefined, 'GET')
    if (!current?.ok) return current
    if (isFixed((await current.json()) as SeriesLike)) {
      // FIXED는 받아들인 위치·담당자로 아무것도 바꾸지 않는다(서버 `WorkspaceRecurrenceService.edit`).
      const personal = requirePersonal(actor, body.location, body.assignee)
      if (personal) return personal
      body.location = null
      body.assignee = null
    }
    const dryRun = searchParams.get('dryRun') === 'true'
    let result: { series: SeriesLike; previous?: unknown; impact?: unknown }
    if (body.recurrence) {
      const response = await legacy(body.recurrence)
      if (!response?.ok) return response
      result = await response.json()
    } else {
      const response = await legacy(undefined, 'GET')
      if (!response?.ok) return response
      result = { series: await response.json(), previous: null, impact: { patched: 0, deleted: 0, created: 0, overwrittenIndividualEdits: 0 } }
    }
    if (!dryRun) {
      if (body.location) {
        const resolved = resolveLocation(actor, body.location)
        if (resolved instanceof Response) return resolved
        placement.spaceId = resolved.spaceId
        placement.projectId = resolved.projectId
      }
      if (body.assignee) {
        const resolved = resolveAssignee(placement.spaceId, body.assignee, placement.assigneeId)
        if (resolved instanceof Response) return resolved
        placement.assigneeId = resolved
      }
      placement.version += 1
      placeOccurrences(actor, id)
      emit(actor, 'series', id, 'UPDATED')
    }
    return json(seriesView(result.series, { previous: result.previous ?? null, impact: result.impact }))
  }
  if (method === 'DELETE') {
    const expected = searchParams.get('expectedVersion')
    if (expected === null) return versionRequired()
    if (Number(expected) !== placement.version)
      return conflict('RECURRENCE', id, placement.version)
    const response = await legacy()
    if (response?.ok && searchParams.get('dryRun') !== 'true') {
      placement.version += 1
      emit(actor, 'series', id, 'UPDATED')
    }
    return response
  }
  return null
}

// ---------------------------------------------------------------------------
// 스페이스와 프로젝트
// ---------------------------------------------------------------------------

const visibleProjects = (actor: number, includeDeleted: boolean) => {
  const spaceIds = new Set(spacesOf(actor).map((space) => space.id))
  return mockProjects.filter(
    (project) => spaceIds.has(project.spaceId) && (includeDeleted || !project.deletedAt),
  )
}

const counts = (tasks: Task[]) => {
  const result = { total: tasks.length, completed: 0, running: 0, unassigned: 0, open: 0 }
  for (const task of tasks) {
    if (isDone(task)) result.completed += 1
    else if (
      mockSchedules.some(
        (schedule) =>
          schedule.taskId === task.id &&
          (schedule.state === 'IN_PROGRESS' || schedule.state === 'SUSPENDED'),
      )
    )
      result.running += 1
    else if (placementOf('task', task.id).assigneeId === null) result.unassigned += 1
    else result.open += 1
  }
  return result
}
const nearestDue = (tasks: Task[]) =>
  tasks
    .filter((task) => !isDone(task))
    .map((task) => task.dueDate?.date)
    .filter((date): date is string => Boolean(date))
    .sort()[0] ?? null

const tasksIn = (spaceId: number) =>
  mockTasks.filter((task) => placementOf('task', task.id).spaceId === spaceId)

const spaceSummary = (space: MockSpace) => {
  const tasks = tasksIn(space.id)
  const open = tasks.filter((task) => !isDone(task))
  const projects = mockProjects.filter((project) => project.spaceId === space.id && !project.deletedAt)
  const inProject = (projectId: number | null) =>
    tasks.filter((task) => placementOf('task', task.id).projectId === projectId)
  const unassigned = open.filter((task) => placementOf('task', task.id).assigneeId === null)
  return {
    spaceId: space.id,
    asOf: nowIso(),
    projects: projects.map((project) => ({
      projectId: project.id,
      counts: counts(inProject(project.id)),
      nearestDueDate: nearestDue(inProject(project.id)),
    })),
    withoutProject: {
      counts: counts(inProject(null)),
      nearestDueDate: nearestDue(inProject(null)),
    },
    members: space.members.map((member) => {
      const assigned = open.filter((task) => placementOf('task', task.id).assigneeId === member.memberId)
      return {
        memberId: member.memberId,
        openAssignedCount: assigned.length,
        nearestDueDate: nearestDue(assigned),
      }
    }),
    unassigned: { openCount: unassigned.length, nearestDueDate: nearestDue(unassigned) },
  }
}

const weeklyRecord = (space: MockSpace, start: string) => {
  const first = dayjs.tz(`${start}T00:00:00`, ZONE_ID)
  const end = first.add(7, 'day')
  const today = dayjs().tz(ZONE_ID)
  const inWeek = (dateTime: string) => {
    const value = dayjs.tz(dateTime, ZONE_ID)
    return !value.isBefore(first) && value.isBefore(end)
  }
  // 팀 숫자는 일정의 스페이스가 아니라 작업을 거쳐 센다. 이 스페이스의 휴지통에 없는 작업에 연결된 일정만이다(ADR-0037 §7).
  // 모크에는 완료 일정의 credited_task_id가 없어 연결이 끊긴 완료 일정은 세지 않는다.
  const linkedTask = (schedule: ScheduleResponse) =>
    schedule.taskId == null ? undefined : findTask(schedule.taskId)
  const schedules = mockSchedules.filter(
    (schedule) =>
      linkedTask(schedule) !== undefined &&
      placementOf('task', schedule.taskId!).spaceId === space.id &&
      schedule.state !== 'NOT_STARTED' &&
      inWeek(dayjs.tz(schedule.date.dateTime, schedule.date.zoneId || ZONE_ID).tz(ZONE_ID).format('YYYY-MM-DDTHH:mm:ss')),
  )
  const minutes = (schedule: ScheduleResponse) => minutesOf(schedule.duration)
  const sum = (items: ScheduleResponse[]) => items.reduce((total, item) => total + minutes(item), 0)
  const group = (key: (schedule: ScheduleResponse) => number | null) => {
    const map = new Map<number | null, number>()
    for (const schedule of schedules) map.set(key(schedule), (map.get(key(schedule)) ?? 0) + minutes(schedule))
    return [...map.entries()].filter(([, value]) => value > 0)
  }
  const dayKey = (schedule: ScheduleResponse) =>
    dayjs.tz(schedule.date.dateTime, schedule.date.zoneId || ZONE_ID).tz(ZONE_ID).format('YYYY-MM-DD')
  return {
    spaceId: space.id,
    start,
    end: end.format('YYYY-MM-DD'),
    zoneId: ZONE_ID,
    current: !today.isBefore(first) && today.isBefore(end),
    completedCount: tasksIn(space.id).filter((task) => {
      const completedAt = placementOf('task', task.id).completedAt
      return isDone(task) && completedAt != null && inWeek(completedAt)
    }).length,
    elapsed: isoMinutes(sum(schedules)),
    days: Array.from({ length: 7 }, (_, index) => {
      const date = first.add(index, 'day').format('YYYY-MM-DD')
      return { date, elapsed: isoMinutes(sum(schedules.filter((schedule) => dayKey(schedule) === date))) }
    }),
    byProject: group((schedule) => placementOf('task', schedule.taskId!).projectId).map(
      ([projectId, value]) => ({ projectId, elapsed: isoMinutes(value) }),
    ),
    // 실행자는 언제나 주인이다(ADR-0037 §7).
    byRunner: group((schedule) => schedule.ownerId)
      .filter(([memberId]) => memberId !== null)
      .map(([memberId, value]) => ({ memberId: memberId as number, elapsed: isoMinutes(value) })),
  }
}

type Invitation = { token: string; spaceId: number; expiresAt: string; revoked: boolean }
const invitations: Invitation[] = []
let invitationSeq = 0

const spaceChanged = (actor: number, space: MockSpace, action: string) =>
  recordChange({
    spaceId: space.id,
    actorId: actor,
    resourceType: 'SPACE',
    resourceId: space.id,
    version: space.version,
    action,
  })

const handleSpaces = async (
  actor: number,
  path: string,
  method: string,
  searchParams: URLSearchParams,
  request: Request,
) => {
  const includeDeleted = searchParams.get('includeDeleted') === 'true'
  if (path === '/v2/spaces' && method === 'GET')
    return json({
      defaultSpaceId: personalSpaceId(actor),
      currentMember: { memberId: actor, nickname: nicknameOf(actor) },
      spaces: spacesOf(actor, includeDeleted).map((space) => rawSpace(actor, space)),
    })
  if (path === '/v2/spaces' && method === 'POST') {
    const body = await readJson<{ name?: string; purpose?: string | null }>(request)
    if (!body?.name?.trim()) return badRequest('스페이스 이름을 입력해 주세요.')
    const space: MockSpace = {
      id: nextSpaceId(),
      name: body.name.trim(),
      purpose: body.purpose?.trim() || null,
      personal: false,
      version: 1,
      deletedAt: null,
      members: [{ memberId: actor, nickname: nicknameOf(actor), role: 'ADMIN' }],
    }
    mockSpaces.push(space)
    spaceChanged(actor, space, 'CREATED')
    return json(rawSpace(actor, space), 201)
  }
  if (path === '/v2/spaces/summaries' && method === 'GET')
    return json({
      asOf: nowIso(),
      spaces: spacesOf(actor).map((space) => {
        const open = tasksIn(space.id).filter((task) => !isDone(task))
        return {
          spaceId: space.id,
          memberCount: space.members.length,
          openTaskCount: open.length,
          unassignedOpenCount: open.filter((task) => placementOf('task', task.id).assigneeId === null).length,
        }
      }),
    })

  const match = path.match(/^\/v2\/spaces\/(-?\d+)(\/.*)?$/)
  if (!match) return null
  const space = findSpace(Number(match[1]))
  const rest = match[2] ?? ''
  if (!space || !memberOf(space, actor)) return failure('SPACE_UNAVAILABLE', '스페이스를 찾을 수 없습니다.', 404)
  const permissions = spacePermissions(actor, space, true)
  const can = (action: keyof AllowedActions) => permissions.allowedActions[action] === true
  const checkVersion = (expected: unknown) =>
    expected == null
      ? versionRequired()
      : Number(expected) !== space.version
        ? conflict('SPACE', space.id, space.version)
        : null

  if (rest === '/snapshot' && method === 'GET')
    return json({
      space: rawSpace(actor, space),
      projects: mockProjects
        .filter((project) => project.spaceId === space.id && (includeDeleted || !project.deletedAt))
        .map((project) => projectView(actor, project)),
      members: space.members,
    })
  if (rest === '/summary' && method === 'GET') return json(spaceSummary(space))
  if (rest === '/weekly-record' && method === 'GET') {
    const start =
      searchParams.get('start') ??
      dayjs().tz(ZONE_ID).startOf('day').subtract((dayjs().tz(ZONE_ID).day() + 6) % 7, 'day').format('YYYY-MM-DD')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || dayjs(start).day() !== 1)
      return badRequest('시작일은 월요일이어야 합니다.')
    return json(weeklyRecord(space, start))
  }
  if ((rest === '/task-draft' || rest === '/schedule-draft') && method === 'GET')
    return json({
      spaceId: space.id,
      defaultAssignee: { memberId: actor, nickname: nicknameOf(actor) },
      members: space.members,
      ...spacePermissions(actor, space, false),
    })
  if (rest === '' && method === 'PATCH') {
    const body = await readJson<{ name?: string; purpose?: string | null; expectedVersion?: number }>(request)
    const stale = checkVersion(body?.expectedVersion)
    if (stale) return stale
    if (space.personal)
      return failure('PERSONAL_SPACE_IMMUTABLE', '개인 스페이스는 바꿀 수 없습니다.', 409)
    if (!can('edit')) return forbidden()
    if (body?.name !== undefined) {
      if (!body.name.trim()) return badRequest('스페이스 이름을 입력해 주세요.')
      space.name = body.name.trim()
    }
    if (body?.purpose !== undefined) space.purpose = body.purpose?.trim() || null
    space.version += 1
    spaceChanged(actor, space, 'UPDATED')
    return json(rawSpace(actor, space))
  }
  if (rest === '/purpose' && (method === 'PUT' || method === 'DELETE')) {
    const body = method === 'PUT' ? await readJson<{ purpose?: string; expectedVersion?: number }>(request) : null
    const stale = checkVersion(method === 'PUT' ? body?.expectedVersion : searchParams.get('expectedVersion'))
    if (stale) return stale
    if (space.personal)
      return failure('PERSONAL_SPACE_IMMUTABLE', '개인 스페이스는 바꿀 수 없습니다.', 409)
    if (!can('edit')) return forbidden()
    space.purpose = method === 'PUT' ? body?.purpose?.trim() || null : null
    space.version += 1
    spaceChanged(actor, space, 'UPDATED')
    return json(rawSpace(actor, space))
  }
  if (rest === '' && method === 'DELETE') {
    const stale = checkVersion(searchParams.get('expectedVersion'))
    if (stale) return stale
    if (!can('delete')) return forbidden()
    space.deletedAt = nowIso()
    space.version += 1
    spaceChanged(actor, space, 'DELETED')
    return noContent()
  }
  if (rest === '/restore' && method === 'POST') {
    const body = await readJson<{ expectedVersion?: number }>(request)
    const stale = checkVersion(body?.expectedVersion)
    if (stale) return stale
    if (!can('restore')) return forbidden()
    space.deletedAt = null
    space.version += 1
    spaceChanged(actor, space, 'RESTORED')
    return json({ ...rawSpace(actor, space), members: space.members })
  }
  if (rest === '/leave' && method === 'POST') {
    if (!can('leave'))
      return permissions.unavailableReasons.leave === 'LAST_ADMIN'
        ? failure('LAST_ADMINISTRATOR', '마지막 관리자는 나갈 수 없습니다.', 409)
        : forbidden()
    removeMember(actor, space, actor)
    return noContent()
  }
  const memberMatch = rest.match(/^\/members\/(\d+)(\/role)?$/)
  if (memberMatch) {
    const memberId = Number(memberMatch[1])
    const target = memberOf(space, memberId)
    if (!target) return notFound()
    if (!can('manageMembers')) return forbidden()
    const admins = space.members.filter((member) => member.role === 'ADMIN').length
    if (memberMatch[2] && method === 'PATCH') {
      const body = await readJson<{ role?: SpaceMember['role'] }>(request)
      if (body?.role !== 'ADMIN' && body?.role !== 'MEMBER') return badRequest('역할을 골라 주세요.')
      if (target.role === 'ADMIN' && body.role === 'MEMBER' && admins <= 1)
        return failure('LAST_ADMINISTRATOR', '마지막 관리자의 역할은 바꿀 수 없습니다.', 409)
      target.role = body.role
      space.version += 1
      spaceChanged(actor, space, 'UPDATED')
      return json(target)
    }
    if (!memberMatch[2] && method === 'DELETE') {
      if (target.role === 'ADMIN' && admins <= 1)
        return failure('LAST_ADMINISTRATOR', '마지막 관리자는 내보낼 수 없습니다.', 409)
      removeMember(actor, space, memberId)
      return noContent()
    }
    return null
  }
  if (rest === '/invitations' && method === 'POST') {
    if (!can('invite'))
      return space.personal
        ? failure('PERSONAL_SPACE_INVITE_FORBIDDEN', '개인 스페이스에는 초대할 수 없습니다.', 403)
        : forbidden()
    const token = `mock-invite-${++invitationSeq}-${Math.random().toString(36).slice(2, 10)}`
    const invitation: Invitation = {
      token,
      spaceId: space.id,
      expiresAt: dayjs().add(1, 'hour').toISOString(),
      revoked: false,
    }
    invitations.push(invitation)
    return json(
      {
        token,
        url: `/spaces/join/${token}`,
        spaceId: space.id,
        spaceName: space.name,
        expiresAt: invitation.expiresAt,
      },
      201,
    )
  }
  const invitationMatch = rest.match(/^\/invitations\/(.+)$/)
  if (invitationMatch && method === 'DELETE') {
    const invitation = invitations.find(
      (item) => item.token === decodeURIComponent(invitationMatch[1]) && item.spaceId === space.id,
    )
    if (!invitation) return notFound()
    if (!can('invite')) return forbidden()
    invitation.revoked = true
    return noContent()
  }
  return null
}

const removeMember = (actor: number, space: MockSpace, memberId: number) => {
  space.members = space.members.filter((member) => member.memberId !== memberId)
  // 나간 사람이 맡던 작업은 담당자 없음으로 남긴다.
  for (const task of mockTasks) {
    const placement = placementOf('task', task.id)
    if (placement.spaceId === space.id && placement.assigneeId === memberId) {
      placement.assigneeId = null
      placement.version += 1
    }
  }
  // 그 사람의 일정 중 이 스페이스의 작업에 연결된 것만 끊는다. 일정은 그 사람 것으로 이어진다(ADR-0037 §3).
  for (const schedule of mockSchedules)
    if (schedule.ownerId === memberId && schedule.taskId != null && placementOf('task', schedule.taskId).spaceId === space.id)
      cutLink(actor, schedule)
  space.version += 1
  spaceChanged(actor, space, 'UPDATED')
}

const activeInvitation = (token: string) => {
  const invitation = invitations.find((item) => item.token === token)
  if (!invitation || invitation.revoked || Date.parse(invitation.expiresAt) < Date.now()) return null
  return invitation
}

const handleInvitations = async (actor: number, path: string, method: string) => {
  const match = path.match(/^\/v2\/space-invitations\/([^/]+)(\/accept)?$/)
  if (!match) return null
  const invitation = activeInvitation(decodeURIComponent(match[1]))
  const space = invitation ? findSpace(invitation.spaceId) : undefined
  if (!invitation || !space || space.deletedAt)
    return failure('INVITATION_UNAVAILABLE', '초대 링크가 만료됐거나 취소됐습니다.', 410)
  const already = Boolean(memberOf(space, actor))
  if (!match[2] && method === 'GET')
    return json({
      spaceId: space.id,
      spaceName: space.name,
      purpose: space.purpose,
      expiresAt: invitation.expiresAt,
      status: already ? 'ALREADY_MEMBER' : 'VALID',
      nickname: nicknameOf(actor),
    })
  if (match[2] && method === 'POST') {
    if (!already) {
      space.members.push({ memberId: actor, nickname: nicknameOf(actor), role: 'MEMBER' })
      space.version += 1
      spaceChanged(actor, space, 'UPDATED')
    }
    return json({ spaceId: space.id, status: already ? 'ALREADY_MEMBER' : 'JOINED' })
  }
  return null
}

const handleProjects = async (
  actor: number,
  path: string,
  method: string,
  searchParams: URLSearchParams,
  request: Request,
) => {
  if (path === '/v2/projects/snapshot' && method === 'GET') {
    const projects = visibleProjects(actor, false)
    const assignments = (kind: ResourceKind, ids: number[]) =>
      Object.fromEntries(
        ids
          .map((id) => [id, placementOf(kind, id)] as const)
          .filter(([, placement]) => placement.projectId !== null && canSee(actor, placement))
          .map(([id, placement]) => [id, placement.projectId]),
      )
    return json({
      projects: projects.map((project) => projectView(actor, project)),
      taskAssignments: assignments('task', mockTasks.map((task) => task.id)),
      // 일정은 프로젝트에 속하지 않는다. 서버도 빈 맵으로 답한다(ADR-0037 §8).
      scheduleAssignments: {},
      seriesAssignments: {},
    })
  }
  if (path === '/v2/projects' && method === 'GET') {
    const spaceId = searchParams.get('spaceId')
    return json(
      visibleProjects(actor, searchParams.get('includeDeleted') === 'true')
        .filter((project) => spaceId === null || project.spaceId === Number(spaceId))
        .map((project) => projectView(actor, project)),
    )
  }
  if (path === '/v2/projects' && method === 'POST') {
    const body = await readJson<{ spaceId?: number; name?: string; outcome?: string | null }>(request)
    const space = body?.spaceId == null ? undefined : findSpace(body.spaceId)
    if (!space || !memberOf(space, actor)) return forbidden()
    if (!spacePermissions(actor, space, false).allowedActions.edit) return forbidden()
    const name = body?.name?.trim()
    if (!name) return badRequest('프로젝트 이름을 입력해 주세요.')
    if (mockProjects.some((project) => project.spaceId === space.id && !project.deletedAt && project.name === name))
      return failure('PROJECT_NAME_CONFLICT', '같은 이름의 프로젝트가 이미 있습니다.', 409)
    const project: MockProject = {
      id: nextProjectId(),
      spaceId: space.id,
      name,
      outcome: body?.outcome?.trim() || null,
      completed: false,
      version: 1,
      deletedAt: null,
    }
    mockProjects.push(project)
    projectChanged(actor, project, 'CREATED')
    return json(projectView(actor, project), 201)
  }
  const match = path.match(/^\/v2\/projects\/(\d+)(\/move|\/restore)?$/)
  if (!match) return null
  const project = findProject(Number(match[1]))
  const space = project ? findSpace(project.spaceId) : undefined
  if (!project || !space || !memberOf(space, actor)) return notFound()
  const view = projectView(actor, project)
  const stale = (expected: unknown) =>
    expected == null
      ? versionRequired()
      : Number(expected) !== project.version
        ? conflict('PROJECT', project.id, project.version)
        : null
  if (!match[2] && method === 'PATCH') {
    const body = await readJson<{ expectedVersion?: number; name?: string; outcome?: string | null; completed?: boolean }>(request)
    const error = stale(body?.expectedVersion)
    if (error) return error
    if (!view.allowedActions.edit) return forbidden()
    if (body?.name !== undefined) {
      if (!body.name.trim()) return badRequest('프로젝트 이름을 입력해 주세요.')
      project.name = body.name.trim()
    }
    if (body?.outcome !== undefined) project.outcome = body.outcome?.trim() || null
    if (body?.completed !== undefined) project.completed = body.completed
    project.version += 1
    projectChanged(actor, project, 'UPDATED')
    return json(projectView(actor, project))
  }
  if (match[2] === '/move' && method === 'POST') {
    const body = await readJson<{ spaceId?: number; expectedVersion?: number }>(request)
    const error = stale(body?.expectedVersion)
    if (error) return error
    if (!view.allowedActions.move) return forbidden()
    const target = body?.spaceId == null ? undefined : findSpace(body.spaceId)
    if (!target || !memberOf(target, actor) || target.deletedAt) return forbidden()
    // 작업만 옮긴다. 일정은 옮기지 않고, 담당이 풀린 작업의 연결은 끊는다(ADR-0037 §3).
    const movedTaskIds: number[] = []
    for (const task of mockTasks) {
      const placement = placementOf('task', task.id)
      if (placement.projectId !== project.id) continue
      placement.spaceId = target.id
      if (placement.assigneeId !== null && !memberOf(target, placement.assigneeId))
        placement.assigneeId = null
      placement.version += 1
      movedTaskIds.push(task.id)
      emit(actor, 'task', task.id, 'UPDATED')
      cutIfOwnerNotAssignee(actor, task)
    }
    project.spaceId = target.id
    project.version += 1
    projectChanged(actor, project, 'UPDATED')
    return json({
      ...projectView(actor, project),
      moveResult: { movedTaskIds, movedScheduleIds: [], removedDependencyCount: 0 },
    })
  }
  if (!match[2] && method === 'DELETE') {
    const error = stale(searchParams.get('expectedVersion'))
    if (error) return error
    if (!view.allowedActions.delete) return forbidden()
    project.deletedAt = nowIso()
    project.version += 1
    projectChanged(actor, project, 'DELETED')
    return noContent()
  }
  if (match[2] === '/restore' && method === 'POST') {
    const body = await readJson<{ expectedVersion?: number }>(request)
    const error = stale(body?.expectedVersion)
    if (error) return error
    if (!view.allowedActions.restore) return forbidden()
    project.deletedAt = null
    project.version += 1
    projectChanged(actor, project, 'RESTORED')
    return json(projectView(actor, project))
  }
  return null
}

const projectChanged = (actor: number, project: MockProject, action: string) =>
  recordChange({
    spaceId: project.spaceId,
    actorId: actor,
    resourceType: 'PROJECT',
    resourceId: project.id,
    version: project.version,
    action,
  })

// ---------------------------------------------------------------------------
// 실시간 스트림. 처음 연결은 지금부터, Last-Event-ID가 있으면 그 뒤 기록부터 보낸다.
// ---------------------------------------------------------------------------

const frame = (event: ChangeEvent) =>
  `id: ${event.id}\nevent: changed\ndata: ${JSON.stringify({
    spaceId: event.spaceId,
    resourceType: event.resourceType,
    resourceId: event.resourceId,
    version: event.version,
    action: event.action,
  })}\n\n`

const eventStream = (actor: number, spaceId: number | null, request: Request) => {
  const lastEventId = Number(request.headers.get('Last-Event-ID') ?? NaN)
  const encoder = new TextEncoder()
  let stop = () => {}
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true
      const write = (text: string) => {
        if (!open) return
        try {
          controller.enqueue(encoder.encode(text))
        } catch {
          open = false
        }
      }
      // 서버처럼 ready에 이 연결의 시작 위치를 싣는다. 새 연결은 마지막 기록 id, 다시 연결하면 받은
      // Last-Event-ID다. 다시 보낼 기록을 받기 전에 끊겨도 다음 연결이 그 기록부터 이어 받는다.
      const cursor = Number.isFinite(lastEventId) ? lastEventId : latestChangeId()
      write(
        `id: ${cursor}\nevent: ready\ndata: ${JSON.stringify({ spaceId, resourceType: 'SPACE', resourceId: spaceId, version: 0, action: 'READY' })}\n\n`,
      )
      if (Number.isFinite(lastEventId))
        changesAfter(actor, spaceId, lastEventId).forEach((event) => write(frame(event)))
      const unsubscribe = subscribeChanges({ actor, spaceId, send: (event) => write(frame(event)) })
      stop = () => {
        unsubscribe()
        if (!open) return
        open = false
        try {
          controller.close()
        } catch {
          /* already closed */
        }
      }
      if (request.signal?.aborted) stop()
      else request.signal?.addEventListener('abort', () => stop(), { once: true })
    },
    cancel() {
      stop()
    },
  })
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
  })
}

// ---------------------------------------------------------------------------
// 진입점
// ---------------------------------------------------------------------------

const WORKSPACE_PATH = /^\/v2\/(?:workspace\/|spaces(?:\/|$)|projects(?:\/|$)|space-invitations\/)/

export const handleWorkspace = async (
  path: string,
  method: string,
  searchParams: URLSearchParams,
  request: Request,
): Promise<Response | null> => {
  if (!WORKSPACE_PATH.test(path)) return null
  const actor = mockCategoryOwnerId(request)
  if (!actor) return json({ message: '로그인이 필요합니다.' }, 401)

  if (path === '/v2/workspace/events' && method === 'GET') return eventStream(actor, null, request)
  const spaceEvents = path.match(/^\/v2\/spaces\/(-?\d+)\/events$/)
  if (spaceEvents && method === 'GET') {
    const space = findSpace(Number(spaceEvents[1]))
    if (!space || !memberOf(space, actor)) return failure('SPACE_UNAVAILABLE', '스페이스를 찾을 수 없습니다.', 404)
    return eventStream(actor, space.id, request)
  }

  if (path.startsWith('/v2/spaces')) return handleSpaces(actor, path, method, searchParams, request)
  if (path.startsWith('/v2/projects')) return handleProjects(actor, path, method, searchParams, request)
  if (path.startsWith('/v2/space-invitations/')) return handleInvitations(actor, path, method)

  const recurrences = path.match(/^\/v2\/workspace\/recurrences(\/\d+)?$/)
  if (recurrences)
    return handleWorkspaceRecurrences(actor, recurrences[1] ?? '', method, searchParams, request)

  if (path === '/v2/workspace/tasks') {
    if (method === 'GET') return listTasks(actor, searchParams)
    if (method === 'POST') return createTask(actor, request)
    return null
  }
  if (path === '/v2/workspace/schedules') {
    if (method === 'GET') return listSchedules(actor, searchParams)
    if (method === 'POST') return createSchedule(actor, request)
    return null
  }

  const taskMatch = path.match(/^\/v2\/workspace\/tasks\/(\d+)(\/state|\/schedule|\/restore|\/purge)?$/)
  if (taskMatch) {
    const id = Number(taskMatch[1])
    const action = taskMatch[2]
    if (action === '/restore' && method === 'POST') return restoreResource(actor, 'task', id, request)
    if (action === '/purge' && method === 'DELETE') return purgeResource(actor, 'task', id, searchParams)
    const task = visibleTask(actor, id)
    if (!task) return failure('NOT_FOUND', '작업을 찾을 수 없습니다.', 404)
    if (!action && method === 'GET') return json(taskView(actor, task))
    // 쪼개기에 잠긴 원본을 바꾸는 명령은 버전·권한보다 먼저 거부한다(서버 `SplitLockGuard`).
    const lockFailure = splitLockFailure(actor, task.id)
    if (lockFailure && (method === 'PATCH' || method === 'DELETE' || method === 'POST')) return lockFailure
    if (!action && method === 'PATCH') return updateTask(actor, task, request)
    if (!action && method === 'DELETE') return deleteTask(actor, task, searchParams)
    if (action === '/state' && method === 'POST') return changeTaskState(actor, task, request)
    if (action === '/schedule' && method === 'POST') return scheduleTask(actor, task, request)
    return null
  }

  const scheduleMatch = path.match(/^\/v2\/workspace\/schedules\/(\d+)(\/state|\/restore|\/purge)?$/)
  if (scheduleMatch) {
    const id = Number(scheduleMatch[1])
    const action = scheduleMatch[2]
    if (action === '/restore' && method === 'POST') return restoreResource(actor, 'schedule', id, request)
    if (action === '/purge' && method === 'DELETE') return purgeResource(actor, 'schedule', id, searchParams)
    const schedule = visibleSchedule(actor, id)
    if (!schedule) return failure('NOT_FOUND', '일정을 찾을 수 없습니다.', 404)
    if (!action && method === 'GET') return json(scheduleView(actor, schedule))
    if (!action && method === 'PATCH') return updateSchedule(actor, schedule, request)
    if (!action && method === 'DELETE') return deleteSchedule(actor, schedule, searchParams)
    if (action === '/state' && method === 'POST') return changeScheduleState(actor, schedule, request)
    return null
  }

  return null
}

// ---------------------------------------------------------------------------
// 다른 참여자의 변경을 흉내 낸다. 개발자 도구에서 `__pinitMock.remote.*`로 부른다.
// 실시간 스트림으로 `changed`가 가므로 화면이 깜빡이지 않고 바뀌는지 확인할 수 있다.
// ---------------------------------------------------------------------------

const TEAMMATE = 3

const remoteTask = (taskId: number) => {
  const task = findTask(taskId)
  if (!task) throw new Error(`작업 ${taskId}이 없습니다.`)
  return task
}

export const mockWorkspaceRemote = {
  completeTask(taskId: number, by = TEAMMATE) {
    const task = remoteTask(taskId)
    setTaskCompleted(task, true)
    bumpVersion('task', taskId)
    emit(by, 'task', taskId, 'UPDATED')
    return taskView(by, task)
  },
  reopenTask(taskId: number, by = TEAMMATE) {
    const task = remoteTask(taskId)
    setTaskCompleted(task, false)
    bumpVersion('task', taskId)
    emit(by, 'task', taskId, 'UPDATED')
    return taskView(by, task)
  },
  renameTask(taskId: number, title: string, by = TEAMMATE) {
    const task = remoteTask(taskId)
    task.title = title
    task.updatedAt = nowIso()
    bumpVersion('task', taskId)
    emit(by, 'task', taskId, 'UPDATED')
    return taskView(by, task)
  },
  createTask(
    title = '고객 문의 답변 템플릿 정리',
    { spaceId = 2, projectId = 21, assigneeId = 1, dueInDays = 2 } = {},
    by = TEAMMATE,
  ) {
    const date = dayjs().tz(ZONE_ID).add(dueInDays, 'day').startOf('day')
    const task: Task = {
      id: nextTaskId(),
      ownerId: 1,
      title,
      description: '',
      dueDate: { date: date.format('YYYY-MM-DD'), zoneId: ZONE_ID, offset: date.format('Z') },
      importance: 5,
      difficulty: 2,
      expectedDuration: null,
      completed: false,
      isCompleted: false,
      inboundDependencyCount: 0,
      previousTaskIds: [],
      nextTaskIds: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    }
    mockTasks.push(task)
    setPlacement('task', task.id, { spaceId, projectId, assigneeId, version: 1 })
    emit(by, 'task', task.id, 'CREATED')
    return taskView(by, task)
  },
  deleteTask(taskId: number, by = TEAMMATE) {
    remoteTask(taskId)
    const moved = moveTaskToTrash(taskId, false, by)
    recomputeMockTaskReadiness(mockTasks)
    bumpVersion('task', taskId)
    // 남이 작업을 지우면 내 연결 일정은 연결만 끊기고, 내 스트림에 UPDATED가 온다(ADR-0037 §5, §13).
    for (const id of moved ? moved.cutScheduleIds : []) {
      bumpVersion('schedule', id)
      emit(by, 'schedule', id, 'UPDATED')
    }
    emit(by, 'task', taskId, 'DELETED')
  },
}
