import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
import type { Task } from '../features/tasks/types/task'
import type { ScheduleResponse } from '../features/schedules/types/schedule'
import { mockRoutines, mockSchedules } from './db'
import { effectiveExpectedMinutes, routineOccurrences } from './planner'
import { isMockCalibrationEnabled, mockCalibrationFactor } from './calibration'
import { mockCategoryOwnerId } from './categories'
import { readableTask } from './workspace'
import {
  bumpVersion,
  findProject,
  findSpace,
  memberOf,
  personalSpaceId,
  placementOf,
  recordChange,
} from './workspaceState'

dayjs.extend(utc)
dayjs.extend(timezone)

/*
 * 개발용 모크: 오늘 남은 일정 재배치(POST /v2/plans/replan, /v2/plans/replan/apply).
 * 서버 `DayReplanningService`·`DayReplanner`·`DayReplanningControllerV2`(pinit-monolith 11a5837a, ADR-0037)를
 * 읽고 옮겼다. 보호 사유와 그 순서, 장애물(완료하지 않은 내 일정 전부), 10분 간격, 5분 단위 시작, 마감·선행·후속,
 * 적용 재검증과 409 문구는 서버와 같다. 미리보기는 늘 내 하루 전체를 보고 스페이스·프로젝트는 옮길 대상만 줄인다.
 * 줄인 것은 파일 끝 주석과 docs/purpose-spaces.md에 적었다.
 */

const MINUTE = 60_000
/** `DayPlanner.BUFFER` */
const BUFFER = 10 * MINUTE
/** `DayPlanner.MIN_IN_PROGRESS_REMAINING` */
const MIN_IN_PROGRESS_REMAINING = 15 * MINUTE
/** `DayPlanner.DEFAULT_WAKE_UP_TIME`, `DEFAULT_SLEEP_TIME` */
const WAKE_HOUR = 7
const SLEEP_HOUR = 23
const PREVIEW_TTL = 15 * MINUTE
const MAX_SELECTION = 100
const MAX_CANDIDATES = 100

/** 서버 `PlanningErrorMessages`의 재배치 문구(ADR-0031). */
export const REPLAN_MESSAGES = {
  PREVIEW_EXPIRED: '미리보기가 만료됐어요. 변경 미리보기를 다시 받아 주세요.',
  SELECTION_RANGE: '옮길 일정을 1~100개 골라 주세요. 같은 일정은 한 번만 고를 수 있어요.',
  DATE_CHANGED: '날짜가 바뀌었어요. 오늘 계획을 다시 열어 변경 미리보기를 받아 주세요.',
  SNAPSHOT_CHANGED: '미리보기 뒤에 일정이나 계획 조건이 바뀌었어요. 변경 미리보기를 다시 받아 주세요.',
  NOT_IN_PREVIEW: '고른 일정 중 이번 미리보기에서 옮길 수 없는 일정이 있어요. 변경 미리보기를 다시 받아 주세요.',
  STATE_CHANGED: '고른 일정의 상태나 시작 가능 시간이 바뀌었어요. 변경 미리보기를 다시 받아 주세요.',
  OVERLAP: '고른 변경이 그대로 두는 일정이나 생활 시간과 겹쳐요. 관련 변경을 함께 고르거나 변경 미리보기를 다시 받아 주세요.',
  DEPENDENCY_ORDER: '이대로 옮기면 선행 작업이 후속 일정보다 늦게 끝나요. 관련 변경을 함께 골라 주세요.',
  ZONE_MISMATCH: '회원 설정의 시간대와 지금 시간대가 달라요. 회원 설정의 시간대로 다시 시도해 주세요.',
  TOO_MANY_CANDIDATES: '오늘 다시 짤 일정이 100개를 넘어요. 스페이스나 프로젝트를 골라 범위를 줄여 주세요.',
  TODAY_ONLY: '오늘 일정만 다시 짤 수 있어요. 오늘 날짜로 다시 시도해 주세요.',
  DELAY_RANGE: '늦어진 시간은 0~240분으로 입력해 주세요.',
} as const

/** 서버 `RequestErrorMessages`와 `WorkspaceException.unavailable()`의 문구. */
const INVALID_REQUEST = '입력한 내용을 다시 확인해 주세요.'
const UNREADABLE_BODY = '요청을 처리하지 못했어요. 화면을 새로고침한 뒤 다시 시도해 주세요.'
const SPACE_UNAVAILABLE = '이 스페이스를 이용할 수 없어요. 스페이스 목록에서 다시 선택해 주세요.'

/** 서버의 `taskClock`. 테스트가 시각을 고정할 때만 바꾼다. */
let clock = () => Date.now()
export const setMockReplanClock = (next: (() => number) | null) => {
  clock = next ?? (() => Date.now())
}

// ---------------------------------------------------------------------------
// 응답
// ---------------------------------------------------------------------------

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

type ValidationError = { field: string; rejectedValue: unknown; reason: string }

/** 서버 `ErrorResponse` 모양. 400은 `TaskFallbackControllerAdvice`, 409는 `DayReplanningControllerAdvice`가 만든다. */
const errorResponse = (status: number, error: string, message: string, path: string, errors: ValidationError[] = []) =>
  json({ timestamp: new Date().toISOString(), status, error, message, path: `uri=${path}`, errors }, status)

class ReplanFailure extends Error {
  readonly response: () => Response
  constructor(response: () => Response) {
    super('replan failure')
    this.response = response
  }
}
const badRequest = (message: string, path: string, errors: ValidationError[] = []) =>
  new ReplanFailure(() => errorResponse(400, 'Bad Request', message, path, errors))
const conflict = (message: string, path: string) =>
  new ReplanFailure(() => errorResponse(409, 'REPLAN_CONFLICT', message, path))
/** 스페이스 오류는 `WorkspaceControllerAdvice`의 `{code, message, ...}` 모양이다. */
const spaceUnavailable = () =>
  new ReplanFailure(() =>
    json(
      { code: 'SPACE_UNAVAILABLE', message: SPACE_UNAVAILABLE, resourceType: null, resourceId: null, latestVersion: null, split: null },
      404,
    ),
  )

/** Jackson의 `Instant` 직렬화처럼 밀리초가 0이면 소수점을 뺀다. */
const instant = (ms: number) => new Date(ms).toISOString().replace('.000Z', 'Z')

// ---------------------------------------------------------------------------
// 요청 읽기와 입력 검사(Bean Validation과 Jackson 역직렬화)
// ---------------------------------------------------------------------------

type ReplanRequest = {
  date: string
  zoneId: string
  delayMinutes: number
  spaceId: number | null
  projectId: number | null
}
type ApplyRequest = ReplanRequest & { plannedAt: number; plannedAtText: string; snapshotToken: string; selectedScheduleIds: number[] }

const isZone = (value: string) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value })
    return true
  } catch {
    return false
  }
}
const isDate = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) && dayjs.utc(value).format('YYYY-MM-DD') === value

/** 형이 맞지 않는 값은 Jackson이 읽지 못한 본문(400 UNREADABLE_BODY)과 같다. null은 그대로 넘겨 Bean Validation이 본다. */
const readBody = async (request: Request, path: string, apply: boolean) => {
  const unreadable = () => badRequest(UNREADABLE_BODY, path)
  let body: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(await request.text())
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error()
    body = parsed as Record<string, unknown>
  } catch {
    throw unreadable()
  }
  const optional = (value: unknown, check: (value: unknown) => boolean) => {
    if (value === undefined || value === null) return null
    if (!check(value)) throw unreadable()
    return value
  }
  const integer = (value: unknown) => typeof value === 'number' && Number.isInteger(value)
  const date = optional(body.date, (value) => typeof value === 'string' && isDate(value)) as string | null
  const zoneId = optional(body.zoneId, (value) => typeof value === 'string' && isZone(value)) as string | null
  const delayMinutes = optional(body.delayMinutes, integer) as number | null
  const spaceId = optional(body.spaceId, integer) as number | null
  const projectId = optional(body.projectId, integer) as number | null
  const plannedAtText = apply
    ? (optional(body.plannedAt, (value) => typeof value === 'string' && Number.isFinite(Date.parse(value))) as string | null)
    : null
  const snapshotToken = apply ? (optional(body.snapshotToken, (value) => typeof value === 'string') as string | null) : null
  const ids = apply ? (optional(body.selectedScheduleIds, Array.isArray) as unknown[] | null) : null
  if (ids?.some((id) => id !== null && !integer(id))) throw unreadable()

  // 필드 선언 순서로 위반을 모은다. 대표 문구는 첫 위반이다(`ValidationErrorReasons.firstReason`).
  const errors: ValidationError[] = []
  const violate = (field: string, rejectedValue: unknown, reason = INVALID_REQUEST) =>
    errors.push({ field, rejectedValue, reason })
  if (date === null) violate('date', null)
  if (zoneId === null) violate('zoneId', null)
  if (delayMinutes === null) violate('delayMinutes', null)
  else if (delayMinutes < 0 || delayMinutes > 240) violate('delayMinutes', delayMinutes, REPLAN_MESSAGES.DELAY_RANGE)
  if (apply) {
    if (plannedAtText === null) violate('plannedAt', null)
    if (snapshotToken === null || snapshotToken.trim() === '') violate('snapshotToken', snapshotToken)
    else if (snapshotToken.length > 64) violate('snapshotToken', snapshotToken)
    if (ids === null || ids.length === 0) violate('selectedScheduleIds', ids, REPLAN_MESSAGES.SELECTION_RANGE)
    else if (ids.length > MAX_SELECTION) violate('selectedScheduleIds', ids, REPLAN_MESSAGES.SELECTION_RANGE)
    ids?.forEach((id, index) => {
      if (id === null) violate(`selectedScheduleIds[${index}]`, null)
    })
  }
  if (errors.length) throw badRequest(errors[0].reason, path, errors)
  const base: ReplanRequest = { date: date!, zoneId: zoneId!, delayMinutes: delayMinutes!, spaceId, projectId }
  if (!apply) return base
  return {
    ...base,
    plannedAt: Date.parse(plannedAtText!),
    plannedAtText: plannedAtText!,
    snapshotToken: snapshotToken!,
    selectedScheduleIds: ids as number[],
  } satisfies ApplyRequest
}

// ---------------------------------------------------------------------------
// 시간 계산
// ---------------------------------------------------------------------------

type Span = { start: number; end: number }

/** `DayReplanner.Span.conflicts`: 양쪽에 10분 간격을 둔다. */
const conflicts = (a: Span, b: Span) => a.end + BUFFER > b.start && b.end + BUFFER > a.start
const sameSpan = (a: Span, b: Span) => a.start === b.start && a.end === b.end

/**
 * `DayReplanner.round`: 분으로 올린 뒤 시간대의 5분 단위로 올린다. 시간대 오프셋이 5분의 배수이면
 * UTC 기준 5분 올림과 같다(지금 쓰이는 시간대는 모두 그렇다).
 */
const round = (ms: number) => Math.ceil(ms / (5 * MINUTE)) * (5 * MINUTE)

const localDate = (ms: number, zoneId: string) => dayjs(ms).tz(zoneId).format('YYYY-MM-DD')
const startOfDay = (date: string, zoneId: string) => dayjs.tz(`${date}T00:00:00`, zoneId).valueOf()
const nextDay = (date: string) => dayjs.utc(date).add(1, 'day').format('YYYY-MM-DD')

/** 'PT1H30M', 'PT40M', 'PT0S'와 예전 '01:00:00'을 분으로. 못 읽으면 null. */
const minutesOf = (value?: string | null) => {
  if (!value) return null
  const iso = value.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/)
  if (iso) return Number(iso[1] ?? 0) * 60 + Number(iso[2] ?? 0) + Math.floor(Number(iso[3] ?? 0) / 60)
  const clock = value.match(/^(\d+):(\d{2})(?::\d{2})?$/)
  return clock ? Number(clock[1]) * 60 + Number(clock[2]) : null
}
const isoMinutes = (minutes: number) => {
  if (minutes <= 0) return 'PT0S'
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return `PT${hours ? `${hours}H` : ''}${rest ? `${rest}M` : ''}`
}

const isDone = (task: Task) => task.completed ?? task.isCompleted ?? false
const startOf = (schedule: ScheduleResponse) =>
  dayjs.tz(schedule.date.dateTime, schedule.date.zoneId || 'UTC').valueOf()

/** `Schedule.effectivePlannedDuration`: 일정의 계획 길이, 없으면 연결 작업의 유효 예상 시간. */
const durationOf = (schedule: ScheduleResponse, task: Task | undefined) => {
  const planned = minutesOf(schedule.plannedDuration)
  if (planned && planned > 0) return planned * MINUTE
  return (task ? effectiveExpectedMinutes(task) : 30) * MINUTE
}

/** `ExistingSchedule.occupancyStart/End`. 진행 중이면 지금부터 남은 계획 길이(최소 15분)다. */
const spanOf = (schedule: ScheduleResponse, task: Task | undefined, now: number): Span => {
  const start = startOf(schedule)
  const planned = durationOf(schedule, task)
  if (schedule.state !== 'IN_PROGRESS') return { start, end: start + planned }
  // 누적 실행시간은 mock 일정의 `duration`이다. 서버는 기록에서 now 시점의 누적을 다시 센다.
  const elapsed = (minutesOf(schedule.duration) ?? 0) * MINUTE
  return { start: Math.min(start, now), end: now + Math.max(planned - elapsed, MIN_IN_PROGRESS_REMAINING) }
}

/** `CalibratedDuration.scale`: 계수가 1이면 그대로, 아니면 5분 단위로 올리고 [5분, 24시간]으로 자른다. */
const scale = (base: number, factor: number) => {
  if (factor === 1) return base
  const step = 5 * MINUTE
  // 서버는 BigDecimal로 곱한다. 부동소수 오차로 정확히 5분 배수인 값(50분 × 1.1 = 55분)이 한 칸 더 올라가지 않게 소수 6자리에서 자른다.
  const steps = Math.ceil(Number(((base / step) * factor).toFixed(6)))
  return Math.min(Math.max(steps * step, step), 24 * 60 * MINUTE)
}

// ---------------------------------------------------------------------------
// DayReplanner: 기존 블록만 다시 놓는다. 못 놓은 블록은 원래 자리를 지킨다.
// ---------------------------------------------------------------------------

type Candidate = {
  scheduleId: number
  taskId: number
  original: Span
  duration: number
  deadline: number
  importance: number
  difficulty: number
  predecessors: number[]
  successors: number[]
}
type Fact = { completed: boolean; scheduledEnd: number | null; scheduledStart: number | null }
type Placement = { candidate: Candidate; span: Span }
type Rejection = { candidate: Candidate; reason: string }

const firstFit = (earliest: number, duration: number, end: number, occupied: Span[]): Span | null => {
  let start = round(earliest)
  const sorted = [...occupied].sort((a, b) => a.start - b.start)
  while (start + duration <= end) {
    const proposed = { start, end: start + duration }
    const clash = sorted.find((span) => conflicts(proposed, span))
    if (!clash) return proposed
    start = round(clash.end + BUFFER)
  }
  return null
}

const pass = (
  candidates: Candidate[],
  facts: Map<number, Fact>,
  fixed: Span[],
  earliest: number,
  windowEnd: number,
  delay: number,
  previouslyRejected: Set<number>,
) => {
  const pending = [...candidates].sort(
    (a, b) =>
      a.deadline - b.deadline || b.importance - a.importance || b.difficulty - a.difficulty || a.scheduleId - b.scheduleId,
  )
  const candidateIds = new Set(candidates.map((candidate) => candidate.taskId))
  const placedEnds = new Map<number, number>()
  const occupied = [...fixed]
  const placements: Placement[] = []
  const unplaced: Rejection[] = []
  while (pending.length) {
    const pendingIds = new Set(pending.map((candidate) => candidate.taskId))
    const next = pending.find((candidate) => candidate.predecessors.every((id) => !pendingIds.has(id)))
    if (!next) {
      pending.forEach((candidate) => unplaced.push({ candidate, reason: 'PREDECESSOR_NOT_PLACED' }))
      break
    }
    pending.splice(pending.indexOf(next), 1)
    let start = Math.max(earliest, next.original.start + delay)
    let blocked = false
    for (const predecessor of next.predecessors) {
      const fact = facts.get(predecessor)
      if (fact?.completed) continue
      const end = candidateIds.has(predecessor)
        ? placedEnds.get(predecessor)
        : previouslyRejected.has(predecessor)
          ? undefined
          : (fact?.scheduledEnd ?? undefined)
      if (end === undefined) {
        blocked = true
        break
      }
      start = Math.max(start, end + BUFFER)
    }
    if (blocked) {
      unplaced.push({ candidate: next, reason: 'PREDECESSOR_NOT_PLACED' })
      continue
    }
    if (!(next.deadline > start)) {
      unplaced.push({ candidate: next, reason: 'DEADLINE_PASSED' })
      continue
    }
    let limit = Math.min(next.deadline, windowEnd)
    for (const successor of next.successors) {
      const fact = facts.get(successor)
      if (!candidateIds.has(successor) && fact && fact.scheduledStart !== null)
        limit = Math.min(limit, fact.scheduledStart - BUFFER)
    }
    const slot = firstFit(start, next.duration, limit, occupied)
    if (!slot) {
      unplaced.push({ candidate: next, reason: 'NO_FITTING_SLOT' })
      continue
    }
    placements.push({ candidate: next, span: slot })
    occupied.push(slot)
    placedEnds.set(next.taskId, slot.end)
  }
  placements.sort((a, b) => a.span.start - b.span.start)
  return { placements, unplaced }
}

/** 실패한 이동은 원래 자리에 남기고, 그 빈자리에 기댄 제안이 없어질 때까지 다시 돌린다. */
const plan = (
  candidates: Candidate[],
  facts: Map<number, Fact>,
  fixed: Span[],
  earliest: number,
  windowEnd: number,
  delay: number,
) => {
  let active = [...candidates]
  const retained = [...fixed]
  const rejected = new Map<number, string>()
  let result: ReturnType<typeof pass>
  do {
    result = pass(active, facts, retained, earliest, windowEnd, delay, new Set(rejected.keys()))
    if (!result.unplaced.length) break
    for (const rejection of result.unplaced) {
      rejected.set(rejection.candidate.taskId, rejection.reason)
      retained.push(rejection.candidate.original)
    }
    active = active.filter((candidate) => !rejected.has(candidate.taskId))
  } while (active.length)
  return {
    placements: active.length ? result.placements : [],
    unplaced: candidates
      .filter((candidate) => rejected.has(candidate.taskId))
      .map((candidate) => ({ candidate, reason: rejected.get(candidate.taskId)! })),
  }
}

// ---------------------------------------------------------------------------
// DayReplanningService
// ---------------------------------------------------------------------------

type Place = { spaceId: number; projectId: number | null; task: Task | undefined }
type Change = {
  scheduleId: number
  taskId: number
  title: string
  expectedVersion: number
  beforeStart: number
  beforeEnd: number
  afterStart: number
  afterEnd: number
  calibrationApplied: boolean
}
type Snapshot = {
  token: string
  windowStart: number
  windowEnd: number
  changes: Change[]
  protectedSchedules: { scheduleId: number; title: string; start: number; end: number; reason: string }[]
  unplaced: { scheduleId: number; taskId: number; title: string; reason: string }[]
  scheduleById: Map<number, ScheduleResponse>
  taskById: Map<number, Task>
  predecessors: Map<number, number[]>
  routineSpans: Span[]
}

/** `SchedulePlaceResolver.placesOf`: 연결 작업을 지금 읽을 수 있으면 그 자리, 아니면 내 개인 스페이스(작업 없음). */
const placeOf = (reader: number, schedule: ScheduleResponse): Place => {
  const task = schedule.taskId == null ? undefined : readableTask(reader, schedule.taskId)
  if (!task) return { spaceId: personalSpaceId(reader), projectId: null, task: undefined }
  const placement = placementOf('task', task.id)
  return { spaceId: placement.spaceId, projectId: placement.projectId, task }
}

/** 보호 사유. 순서는 서버 `protectedReason`과 같다. 스페이스·프로젝트가 비어 있으면 거르지 않는다. */
const protectedReason = (
  schedule: ScheduleResponse,
  place: Place,
  date: string,
  zoneId: string,
  actor: number,
  spaceId: number | null,
  projectId: number | null,
) => {
  const task = place.task
  if (localDate(startOf(schedule), zoneId) !== date) return 'OUTSIDE_TODAY'
  if (schedule.taskId == null) return 'INDEPENDENT_APPOINTMENT'
  if (spaceId !== null && place.spaceId !== spaceId) return 'OUTSIDE_SPACE'
  if (projectId !== null && projectId !== place.projectId) return 'OUTSIDE_PROJECT'
  // 일정에 저장된 담당자가 아니라 연결 작업의 담당자만 본다.
  if (task && placementOf('task', task.id).assigneeId !== actor) return 'NOT_ASSIGNED_TO_YOU'
  if (schedule.recurrence || task?.recurrence) return 'RECURRING_SCHEDULE'
  if (schedule.state === 'IN_PROGRESS') return 'IN_PROGRESS'
  if (schedule.state === 'SUSPENDED') return 'SUSPENDED'
  if (schedule.state === 'COMPLETED') return 'COMPLETED'
  if (!task || isDone(task) || (task.availableFrom && task.availableFrom > date)) return 'TASK_UNAVAILABLE'
  return null
}

/** `requireScope`: 둘 다 비면 권한 확인 없이 내 하루 전체다. 응답의 spaceId는 요청 값 그대로다. */
const requireScope = (actor: number, requested: number | null, projectId: number | null, path: string) => {
  if (requested === null && projectId === null) return { spaceId: null, authority: 'mine' }
  const spaceId = requested ?? personalSpaceId(actor)
  if (spaceId === 0) throw badRequest(INVALID_REQUEST, path)
  const space = findSpace(spaceId)
  const member = space && memberOf(space, actor)
  if (!space || !member || space.deletedAt) throw spaceUnavailable()
  let authority = `${space.version}:${member.role}`
  if (projectId !== null) {
    const project = findProject(projectId)
    if (!project || project.deletedAt || project.spaceId !== spaceId) throw spaceUnavailable()
    authority += `/project:${project.version}`
  }
  return { spaceId: requested, authority }
}

/** 서버는 SHA-256 16진수 64자다. mock은 같은 길이의 결정적 해시(FNV-1a 8겹)로 충분하다. */
const fingerprint = (values: unknown[]) => {
  const text = JSON.stringify(values)
  let out = ''
  for (let seed = 0; seed < 8; seed++) {
    let hash = (0x811c9dc5 ^ (seed * 0x9e3779b1)) >>> 0
    for (let index = 0; index < text.length; index++) {
      hash ^= text.charCodeAt(index)
      hash = Math.imul(hash, 0x01000193) >>> 0
    }
    out += hash.toString(16).padStart(8, '0')
  }
  return out
}

const assemble = (
  owner: number,
  request: ReplanRequest,
  plannedAt: number,
  profileZoneId: string,
  path: string,
): Snapshot => {
  const { date, zoneId, delayMinutes, projectId } = request
  const scope = requireScope(owner, request.spaceId, projectId, path)
  if (profileZoneId !== zoneId) throw badRequest(REPLAN_MESSAGES.ZONE_MISMATCH, path)
  // 내 하루 전체(ADR-0037 §10): 내 일정만, 남의 일정은 절대 싣지 않는다. 범위는 옮길 대상만 줄인다.
  const existing = mockSchedules.filter((schedule) => schedule.ownerId === owner).sort((a, b) => a.id - b.id)
  const places = new Map(existing.map((schedule) => [schedule.id, placeOf(owner, schedule)]))
  const taskById = new Map<number, Task>()
  places.forEach((place) => place.task && taskById.set(place.task.id, place.task))
  const scheduleById = new Map(existing.map((schedule) => [schedule.id, schedule]))
  const scheduleByTask = new Map<number, ScheduleResponse>()
  existing.forEach((schedule) => {
    if (schedule.taskId != null && !scheduleByTask.has(schedule.taskId)) scheduleByTask.set(schedule.taskId, schedule)
  })

  // 연결 작업에 닿은 선후 관계. 먼 끝은 내 권한으로 읽고, 못 읽으면 그 관계는 닫힌 채로 실패한다.
  const edgeKeys = new Set<string>()
  taskById.forEach((task) => {
    task.previousTaskIds?.forEach((from) => edgeKeys.add(`${from}>${task.id}`))
    task.nextTaskIds?.forEach((to) => edgeKeys.add(`${task.id}>${to}`))
  })
  const edges = [...edgeKeys]
    .map((key) => key.split('>').map(Number) as [number, number])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
  edges.flat().forEach((id) => {
    if (taskById.has(id)) return
    const task = readableTask(owner, id)
    if (task) taskById.set(id, task)
  })
  const knownTasks = [...taskById.values()].sort((a, b) => a.id - b.id)
  const predecessors = new Map<number, number[]>()
  const successors = new Map<number, number[]>()
  const invalidDependencies = new Set<number>()
  edges.forEach(([from, to]) => {
    predecessors.set(to, [...(predecessors.get(to) ?? []), from])
    successors.set(from, [...(successors.get(from) ?? []), to])
    if (!taskById.has(from) || !taskById.has(to)) {
      if (taskById.has(from)) invalidDependencies.add(from)
      if (taskById.has(to)) invalidDependencies.add(to)
    }
  })

  // 생활 시간: 수면이 있으면 하루 전체, 없으면 07:00~23:00(ADR-0016). 요일별 바꾸기(ADR-0027)는 mock에 없다.
  const hasSleep = mockRoutines.some((routine) => routine.kind === 'SLEEP')
  const dayStart = startOfDay(date, zoneId)
  const dayEnd = startOfDay(nextDay(date), zoneId)
  const nominalStart = hasSleep ? dayStart : dayjs.tz(`${date}T00:00:00`, zoneId).hour(WAKE_HOUR).valueOf()
  const nominalEnd = hasSleep ? dayEnd : dayjs.tz(`${date}T00:00:00`, zoneId).hour(SLEEP_HOUR).valueOf()
  const end = Math.min(nominalEnd, dayEnd)
  let earliest = plannedAt + delayMinutes * MINUTE
  if (earliest < nominalStart) earliest = nominalStart
  if (earliest > end) earliest = end
  const routineSpans = routineOccurrences(date, zoneId).map(({ start, end: until }) => ({ start, end: until }))

  const fixed: Span[] = [...routineSpans]
  const candidates: Candidate[] = []
  const protectedSchedules: Snapshot['protectedSchedules'] = []
  const unavailable: Snapshot['unplaced'] = []
  // 블록 길이는 스페이스와 상관없이 내 완료 기록으로 보정한다(ADR-0037 §10). mock 계수는 고정값이다.
  const calibrationEnabled = isMockCalibrationEnabled()
  for (const schedule of existing) {
    const place = places.get(schedule.id)!
    const task = place.task
    const original = spanOf(schedule, task, plannedAt)
    const reason = protectedReason(schedule, place, date, zoneId, owner, scope.spaceId, projectId)
    if (reason) {
      // ADR-0034: 완료한 일정은 보호 목록에 남지만 계획 구간을 차지하지 않는다.
      if (schedule.state !== 'COMPLETED') fixed.push(original)
      if (original.start < dayEnd && original.end > dayStart)
        protectedSchedules.push({ scheduleId: schedule.id, title: schedule.title, start: original.start, end: original.end, reason })
      continue
    }
    if (invalidDependencies.has(task!.id)) {
      fixed.push(original)
      unavailable.push({ scheduleId: schedule.id, taskId: task!.id, title: schedule.title, reason: 'PREDECESSOR_NOT_PLACED' })
      continue
    }
    let duration = durationOf(schedule, task)
    const factor = mockCalibrationFactor(task!.difficulty)
    if (factor !== null) duration = Math.max(duration, scale(effectiveExpectedMinutes(task!) * MINUTE, factor))
    candidates.push({
      scheduleId: schedule.id,
      taskId: task!.id,
      original,
      duration,
      deadline: startOfDay(nextDay(task!.dueDate.date), task!.dueDate.zoneId || zoneId),
      importance: task!.importance,
      difficulty: task!.difficulty,
      predecessors: predecessors.get(task!.id) ?? [],
      successors: successors.get(task!.id) ?? [],
    })
  }
  if (candidates.length > MAX_CANDIDATES) throw badRequest(REPLAN_MESSAGES.TOO_MANY_CANDIDATES, path)

  // 선행·후속의 일정 사실은 내 일정에서만 읽는다(ADR-0037 §19 Q2).
  const facts = new Map<number, Fact>()
  for (const task of knownTasks) {
    const schedule = scheduleByTask.get(task.id)
    let scheduledEnd =
      !schedule || schedule.state === 'SUSPENDED' || schedule.state === 'COMPLETED' || invalidDependencies.has(task.id)
        ? null
        : spanOf(schedule, task, plannedAt).end
    if (scheduledEnd !== null && scheduledEnd <= plannedAt) scheduledEnd = null
    facts.set(task.id, {
      completed: isDone(task),
      scheduledEnd,
      scheduledStart: !schedule || schedule.state === 'COMPLETED' ? null : spanOf(schedule, task, plannedAt).start,
    })
  }

  const result = plan(candidates, facts, fixed, earliest, end, delayMinutes * MINUTE)
  const changes: Change[] = result.placements
    .filter((placement) => !sameSpan(placement.span, placement.candidate.original))
    .map(({ candidate, span }) => {
      const schedule = scheduleById.get(candidate.scheduleId)!
      return {
        scheduleId: schedule.id,
        taskId: candidate.taskId,
        title: schedule.title,
        expectedVersion: placementOf('schedule', schedule.id).version,
        beforeStart: candidate.original.start,
        beforeEnd: candidate.original.end,
        afterStart: span.start,
        afterEnd: span.end,
        calibrationApplied: calibrationEnabled,
      }
    })
  const unplaced = [
    ...unavailable,
    ...result.unplaced.map(({ candidate, reason }) => ({
      scheduleId: candidate.scheduleId,
      taskId: candidate.taskId,
      title: scheduleById.get(candidate.scheduleId)!.title,
      reason,
    })),
  ]

  // 미리보기와 적용이 같은 상태를 봤는지 가리는 지문. 서버처럼 요청, 설정, 생활 시간, 권한, 작업, 일정, 관계, 결과를 담는다.
  const token = fingerprint([
    owner, date, zoneId, delayMinutes, plannedAt, profileZoneId, calibrationEnabled, mockRoutines,
    scope.spaceId, projectId, scope.authority,
    knownTasks.map((task) => {
      const placement = placementOf('task', task.id)
      return [task.id, task.updatedAt, isDone(task), task.title, task.dueDate, task.expectedDuration, task.importance,
        task.difficulty, task.recurrence?.seriesId ?? null, task.availableFrom ?? null, placement.version,
        placement.spaceId, placement.projectId, placement.assigneeId]
    }),
    existing.map((schedule) => [schedule.id, placementOf('schedule', schedule.id).version, schedule.taskId ?? null,
      schedule.state, schedule.title, startOf(schedule), schedule.plannedDuration, schedule.recurrence?.seriesId ?? null,
      schedule.duration, places.get(schedule.id)!.spaceId, places.get(schedule.id)!.projectId]),
    edges, changes, unplaced,
  ])
  return {
    token,
    windowStart: earliest,
    windowEnd: end,
    changes,
    protectedSchedules,
    unplaced,
    scheduleById,
    taskById,
    predecessors,
    routineSpans,
  }
}

/** 적용 재검증: 고른 일정의 상태·버전·시작, 겹침, 선후 순서. 실패하면 아무것도 바꾸지 않는다. */
const validateSelection = (snapshot: Snapshot, changes: Map<number, Change>, selected: Set<number>, now: number, path: string) => {
  const finalSpans = new Map<number, Span>()
  const scheduleByTask = new Map<number, ScheduleResponse>()
  snapshot.scheduleById.forEach((schedule) => {
    const change = changes.get(schedule.id)
    finalSpans.set(
      schedule.id,
      selected.has(schedule.id) && change
        ? { start: change.afterStart, end: change.afterEnd }
        : spanOf(schedule, schedule.taskId == null ? undefined : snapshot.taskById.get(schedule.taskId), now),
    )
    if (schedule.taskId != null) scheduleByTask.set(schedule.taskId, schedule)
  })
  for (const id of selected) {
    const schedule = snapshot.scheduleById.get(id)!
    const span = finalSpans.get(id)!
    if (schedule.state !== 'NOT_STARTED' || placementOf('schedule', id).version !== changes.get(id)!.expectedVersion || span.start < now)
      throw conflict(REPLAN_MESSAGES.STATE_CHANGED, path)
    const overlaps = [...finalSpans].some(
      ([other, otherSpan]) =>
        other !== id && snapshot.scheduleById.get(other)!.state !== 'COMPLETED' && conflicts(span, otherSpan),
    )
    if (overlaps || snapshot.routineSpans.some((routine) => conflicts(span, routine)))
      throw conflict(REPLAN_MESSAGES.OVERLAP, path)
  }
  // 고르지 않은 후속도 원래 시작보다 늦게 끝나는 선행에서 지킨다.
  for (const [successorTaskId, predecessorIds] of snapshot.predecessors) {
    const successor = scheduleByTask.get(successorTaskId)
    if (!successor || successor.state === 'COMPLETED') continue
    for (const predecessorId of predecessorIds) {
      const predecessor = snapshot.taskById.get(predecessorId)
      if (predecessor && isDone(predecessor)) continue
      const predecessorSchedule = scheduleByTask.get(predecessorId)
      const affected = selected.has(successor.id) || (predecessorSchedule !== undefined && selected.has(predecessorSchedule.id))
      if (!affected) continue
      if (
        !predecessorSchedule ||
        predecessorSchedule.state === 'SUSPENDED' ||
        predecessorSchedule.state === 'COMPLETED' ||
        !(finalSpans.get(predecessorSchedule.id)!.end > now) ||
        finalSpans.get(predecessorSchedule.id)!.end + BUFFER > finalSpans.get(successor.id)!.start
      )
        throw conflict(REPLAN_MESSAGES.DEPENDENCY_ORDER, path)
    }
  }
}

/** `validateRequest`: 회원 시간대가 아니라 요청 시간대의 오늘만, 늦어진 시간은 0~240분. */
const validateRequest = (request: ReplanRequest, now: number, path: string) => {
  if (request.date !== localDate(now, request.zoneId)) throw badRequest(REPLAN_MESSAGES.TODAY_ONLY, path)
  if (request.delayMinutes < 0 || request.delayMinutes > 240) throw badRequest(REPLAN_MESSAGES.DELAY_RANGE, path)
}

const preview = async (owner: number, request: Request, profileZoneId: string, path: string) => {
  const body = await readBody(request, path, false)
  const now = clock()
  validateRequest(body, now, path)
  const snapshot = assemble(owner, body, now, profileZoneId, path)
  return json({
    date: body.date,
    zoneId: body.zoneId,
    spaceId: body.spaceId,
    projectId: body.projectId,
    delayMinutes: body.delayMinutes,
    plannedAt: instant(now),
    snapshotToken: snapshot.token,
    windowStart: instant(snapshot.windowStart),
    windowEnd: instant(snapshot.windowEnd),
    changes: snapshot.changes.map((change) => ({
      ...change,
      beforeStart: instant(change.beforeStart),
      beforeEnd: instant(change.beforeEnd),
      afterStart: instant(change.afterStart),
      afterEnd: instant(change.afterEnd),
    })),
    protectedSchedules: snapshot.protectedSchedules.map((item) => ({ ...item, start: instant(item.start), end: instant(item.end) })),
    unplaced: snapshot.unplaced,
  })
}

const apply = async (owner: number, request: Request, profileZoneId: string, path: string) => {
  const body = (await readBody(request, path, true)) as ApplyRequest
  let now = clock()
  validateRequest(body, now, path)
  const expired = (at: number) => body.plannedAt > at || !(body.plannedAt > at - PREVIEW_TTL)
  if (expired(now) || body.date !== localDate(body.plannedAt, body.zoneId))
    throw conflict(REPLAN_MESSAGES.PREVIEW_EXPIRED, path)
  if (new Set(body.selectedScheduleIds).size !== body.selectedScheduleIds.length)
    throw badRequest(REPLAN_MESSAGES.SELECTION_RANGE, path)
  const snapshot = assemble(owner, body, body.plannedAt, profileZoneId, path)
  // 서버는 잠금을 기다린 뒤 지금을 다시 읽는다. mock은 기다리지 않지만 순서를 그대로 둔다.
  now = clock()
  if (body.date !== localDate(now, body.zoneId)) throw conflict(REPLAN_MESSAGES.DATE_CHANGED, path)
  if (expired(now)) throw conflict(REPLAN_MESSAGES.PREVIEW_EXPIRED, path)
  if (body.snapshotToken !== snapshot.token) throw conflict(REPLAN_MESSAGES.SNAPSHOT_CHANGED, path)
  const changes = new Map(snapshot.changes.map((change) => [change.scheduleId, change]))
  const selected = new Set(body.selectedScheduleIds)
  if ([...selected].some((id) => !changes.has(id))) throw conflict(REPLAN_MESSAGES.NOT_IN_PREVIEW, path)
  validateSelection(snapshot, changes, selected, now, path)

  const applied = [...selected].sort((a, b) => a - b)
  for (const id of applied) {
    const schedule = snapshot.scheduleById.get(id)!
    const change = changes.get(id)!
    schedule.date = { dateTime: dayjs(change.afterStart).tz(body.zoneId).format('YYYY-MM-DDTHH:mm:ss'), zoneId: body.zoneId }
    schedule.plannedDuration = isoMinutes(Math.round((change.afterEnd - change.afterStart) / MINUTE))
    bumpVersion('schedule', id)
  }
  // 일정 변경은 요청 스페이스와 상관없이 주인의 스트림에 남는다(ADR-0037 §13).
  for (const id of applied)
    recordChange({
      spaceId: personalSpaceId(owner),
      actorId: owner,
      resourceType: 'SCHEDULE',
      resourceId: id,
      version: placementOf('schedule', id).version,
      action: 'UPDATED',
    })
  return json({ appliedScheduleIds: applied })
}

export const handleReplanning = async (path: string, method: string, request: Request, profileZoneId: string) => {
  if (method !== 'POST' || (path !== '/v2/plans/replan' && path !== '/v2/plans/replan/apply')) return null
  const owner = mockCategoryOwnerId(request) ?? 1
  try {
    return path === '/v2/plans/replan'
      ? await preview(owner, request, profileZoneId, path)
      : await apply(owner, request, profileZoneId, path)
  } catch (failure) {
    if (failure instanceof ReplanFailure) return failure.response()
    throw failure
  }
}

/*
 * 서버와 다르게 줄인 것:
 * - 요일별 생활 시간 바꾸기(ADR-0027)는 mock에 없어 매주 생활 시간만 본다. 수면 생활 시간이 있으면 하루 전체를 쓴다.
 * - 보정 계수는 `calibration.ts`의 고정값이다. 서버는 미리보기 시각까지의 완료 기록으로 다시 구한다.
 * - 진행 중 일정의 누적 실행시간은 mock 일정의 `duration`이다. 서버는 실행 기록으로 지금 시점의 누적을 센다.
 * - 스냅숏 토큰은 SHA-256이 아니라 같은 길이의 결정적 해시이고, 잠금·SERIALIZABLE 재시도는 흉내 내지 않는다.
 * - Bean Validation 위반은 필드 선언 순서로 모은다(서버의 순서는 정해져 있지 않다). 소수인 delayMinutes는 읽지 못한 본문으로 본다.
 * - 적용은 시간 바뀜 알림 이벤트(`timingChanged`)를 보내지 않는다.
 */
