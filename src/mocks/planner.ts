import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
import type { Task } from '../features/tasks/types/task'
import type { ScheduleResponse, ScheduleTaskType } from '../features/schedules/types/schedule'
import type { PlanApplyRequest, PlanRejection } from '../features/planner/types/plan'
import type { DayOfWeek, Routine, RoutinesRequest } from '../features/routines/types/routine'
import { DAYS_OF_WEEK, toRoutineDraft, validateRoutineDrafts } from '../features/routines/utils/routineRules'
import { mockRoutines, mockSchedules, mockTasks, nextScheduleId, replaceMockRoutines } from './db'

dayjs.extend(utc)
dayjs.extend(timezone)

// 개발용 모크. 실제 배치 규칙은 서버(ADR-0015 domain/planning)에 있고, 여기서는 화면 확인에 필요한
// 모양과 대표 사례(빈 슬롯 없음, 목표 초과, 선행 미배치, 409 거부)만 흉내 낸다.

const DIFFICULTY_MINUTES: Record<number, number> = { 1: 15, 2: 30, 3: 45, 5: 60, 8: 90, 13: 120, 21: 180 }
const WAKE_HOUR = 7
const SLEEP_HOUR = 23
const DAILY_OBJECTIVE_MINUTES = 4 * 60
const BUFFER_MINUTES = 10

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

const errorBody = (status: number, error: string, message: string, path: string, extra: object = {}) =>
  json({ timestamp: new Date().toISOString(), status, error, message, path: `uri=${path}`, errors: [], ...extra }, status)

const isoMinutes = (minutes: number) => {
  if (minutes <= 0) return 'PT0S'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `PT${h ? `${h}H` : ''}${m ? `${m}M` : ''}`
}

const parseMinutes = (value?: string | null) => {
  const match = value?.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:\d+S)?$/)
  return match ? Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0) : null
}

export const effectiveExpectedMinutes = (task: Task) =>
  parseMinutes(task.expectedDuration) || DIFFICULTY_MINUTES[task.difficulty] || 30

const isCompleted = (task: Task) => task.completed ?? task.isCompleted ?? false

const scheduleSpan = (schedule: ScheduleResponse) => {
  const start = dayjs.tz(schedule.date.dateTime, schedule.date.zoneId || 'UTC')
  return { start: start.valueOf(), end: start.add(parseMinutes(schedule.plannedDuration) ?? 30, 'minute').valueOf() }
}

const local = (ms: number, zoneId: string) => ({ dateTime: dayjs(ms).tz(zoneId).format('YYYY-MM-DDTHH:mm:ss'), zoneId })

const suggestedType = (task: Task): ScheduleTaskType => (task.difficulty >= 5 ? 'DEEP_WORK' : 'QUICK_TASK')

const DAY_INDEX: Record<number, DayOfWeek> = { 1: 'MONDAY', 2: 'TUESDAY', 3: 'WEDNESDAY', 4: 'THURSDAY', 5: 'FRIDAY', 6: 'SATURDAY', 0: 'SUNDAY' }

/** 계획일 전날~다음 날에 시작하는 생활 시간 구간 */
const routineOccurrences = (date: string, zoneId: string) => {
  const result: { routine: Routine; start: number; end: number }[] = []
  for (const offset of [-1, 0, 1]) {
    const day = dayjs.tz(`${date}T00:00:00`, zoneId).add(offset, 'day')
    const weekday = DAY_INDEX[day.day()]
    mockRoutines.forEach((routine) => {
      if (!routine.days.includes(weekday)) return
      const start = dayjs.tz(`${day.format('YYYY-MM-DD')}T${routine.startTime}:00`, zoneId)
      result.push({ routine, start: start.valueOf(), end: start.add(parseMinutes(routine.duration) ?? 0, 'minute').valueOf() })
    })
  }
  return result.sort((a, b) => a.start - b.start)
}

const handleRoutines = async (path: string, method: string, request: Request) => {
  if (method === 'GET') return json({ routines: mockRoutines })
  if (method === 'PUT') {
    const body = (await request.json().catch(() => null)) as RoutinesRequest | null
    if (!body || !Array.isArray(body.routines)) return errorBody(400, 'Bad Request', 'routines가 필요합니다.', path)
    const validation = validateRoutineDrafts(body.routines.map((routine, index) => toRoutineDraft(routine, String(index))))
    const errors = Object.entries(validation.byIndex).flatMap(([index, issues]) =>
      issues.map((issue) => ({
        field: issue.field ? `routines[${index}].${issue.field}` : `routines[${index}]`,
        rejectedValue: null,
        reason: issue.message,
      })),
    )
    validation.general.forEach((reason) => errors.push({ field: 'routines', rejectedValue: null, reason }))
    if (errors.length > 0) {
      return errorBody(400, 'Bad Request', `Validation failed for ${errors.length} field(s)`, path, { errors })
    }
    const order = (routine: Routine) => [DAYS_OF_WEEK.indexOf(routine.days[0]), routine.startTime, routine.id] as const
    const saved = replaceMockRoutines(body.routines).sort((a, b) => {
      const [ad, at, ai] = order(a)
      const [bd, bt, bi] = order(b)
      return ad - bd || at.localeCompare(bt) || ai - bi
    })
    return json({ routines: saved })
  }
  return null
}

export const handlePlans = async (path: string, method: string, searchParams: URLSearchParams, request: Request) => {
  if (path === '/v2/routines') return handleRoutines(path, method, request)

  if (method === 'GET' && path === '/v2/plans') {
    const date = searchParams.get('date') ?? ''
    const zoneId = searchParams.get('zoneId')
    const horizonDays = Number(searchParams.get('horizonDays') ?? 7)
    if (!zoneId) return errorBody(400, 'Bad Request', "Required request parameter 'zoneId' is not present", path)
    const today = dayjs().tz(zoneId).format('YYYY-MM-DD')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < today) {
      return errorBody(400, 'Bad Request', '지난 날짜는 계획할 수 없습니다.', path)
    }
    if (!Number.isInteger(horizonDays) || horizonDays < 0 || horizonDays > 30) {
      return errorBody(400, 'Bad Request', 'horizonDays는 0 이상 30 이하여야 합니다.', path)
    }

    // ADR-0016: 수면 생활 시간이 있으면 계획일 하루 전체에서 생활 시간을 뺀 시간, 없으면 기상~취침.
    const hasSleepRoutine = mockRoutines.some((routine) => routine.kind === 'SLEEP')
    const dayStart = dayjs.tz(`${date}T00:00:00`, zoneId)
    const wake = hasSleepRoutine ? dayStart : dayStart.hour(WAKE_HOUR)
    const sleep = hasSleepRoutine ? dayStart.add(1, 'day') : dayStart.hour(SLEEP_HOUR)
    const nowMs = Date.now()
    const rawStart = Math.max(wake.valueOf(), date === today ? nowMs : 0)
    const windowStart = Math.min(Math.ceil(rawStart / 300000) * 300000, sleep.valueOf())
    const windowEnd = sleep.valueOf()

    const scheduledTaskIds = new Set(mockSchedules.map((schedule) => schedule.taskId).filter(Boolean))
    const daySchedules = mockSchedules.filter((schedule) => {
      const span = scheduleSpan(schedule)
      return span.end > wake.valueOf() && span.start < windowEnd
    })
    const occurrences = routineOccurrences(date, zoneId)
    const occupied = [...daySchedules.map(scheduleSpan), ...occurrences.map(({ start, end }) => ({ start, end }))]
    const existingTaskWork = daySchedules
      .filter((schedule) => schedule.taskId)
      .reduce((sum, schedule) => sum + (parseMinutes(schedule.plannedDuration) ?? 30), 0)
    const lastDue = dayjs(date).add(horizonDays, 'day').format('YYYY-MM-DD')
    const candidates = mockTasks
      .filter((task) => !isCompleted(task) && !scheduledTaskIds.has(task.id) && task.dueDate.date <= lastDue)
      .map((task) => ({ task, must: task.dueDate.date <= date }))
      .sort((a, b) =>
        Number(b.must) - Number(a.must) ||
        a.task.dueDate.date.localeCompare(b.task.dueDate.date) ||
        b.task.importance - a.task.importance ||
        b.task.difficulty - a.task.difficulty ||
        a.task.id - b.task.id,
      )

    const blocks: unknown[] = []
    const unplaced: unknown[] = []
    let plannedWork = 0
    candidates.forEach(({ task, must }) => {
      const minutes = effectiveExpectedMinutes(task)
      if ((task.inboundDependencyCount ?? 0) > 0) {
        unplaced.push({ taskId: task.id, title: task.title, reason: 'PREDECESSOR_NOT_PLACED', mustTier: must })
        return
      }
      if (!must && existingTaskWork + plannedWork + minutes > DAILY_OBJECTIVE_MINUTES) {
        unplaced.push({ taskId: task.id, title: task.title, reason: 'DAILY_OBJECTIVE_EXCEEDED', mustTier: must })
        return
      }
      let start = windowStart
      const fits = () => {
        const end = start + minutes * 60000
        if (end > windowEnd) return false
        const clash = occupied.find(
          (span) => start < span.end + BUFFER_MINUTES * 60000 && span.start - BUFFER_MINUTES * 60000 < end,
        )
        if (!clash) return true
        start = Math.ceil((clash.end + BUFFER_MINUTES * 60000) / 300000) * 300000
        return null
      }
      let result = fits()
      while (result === null) result = fits()
      if (!result) {
        unplaced.push({ taskId: task.id, title: task.title, reason: 'NO_FITTING_SLOT', mustTier: must })
        return
      }
      const end = start + minutes * 60000
      occupied.push({ start, end })
      plannedWork += minutes
      blocks.push({
        taskId: task.id,
        title: task.title,
        start: local(start, zoneId),
        end: local(end, zoneId),
        duration: isoMinutes(minutes),
        scheduleType: suggestedType(task),
        mustTier: must,
      })
    })
    blocks.sort((a, b) =>
      (a as { start: { dateTime: string } }).start.dateTime.localeCompare((b as { start: { dateTime: string } }).start.dateTime),
    )

    const routinesEnd = Math.max(dayStart.add(1, 'day').valueOf(), windowEnd)
    return json({
      date,
      zoneId,
      window: { start: local(windowStart, zoneId), end: local(windowEnd, zoneId) },
      windowSource: hasSleepRoutine ? 'SLEEP_ROUTINE' : 'PROFILE',
      routines: occurrences
        .filter(({ start, end }) => start < routinesEnd && end > dayStart.valueOf())
        .map(({ routine, start, end }) => ({
          routineId: routine.id,
          kind: routine.kind,
          label: routine.label,
          start: local(start, zoneId),
          end: local(end, zoneId),
        })),
      blocks,
      unplaced,
      objective: {
        dailyObjectiveWork: isoMinutes(DAILY_OBJECTIVE_MINUTES),
        existingTaskWork: isoMinutes(existingTaskWork),
        plannedWork: isoMinutes(plannedWork),
        used: isoMinutes(existingTaskWork + plannedWork),
      },
    })
  }

  if (method === 'POST' && path === '/v2/plans/apply') {
    const body = (await request.json().catch(() => null)) as PlanApplyRequest | null
    if (!body?.date || !body.zoneId || !Array.isArray(body.blocks) || body.blocks.length === 0) {
      return errorBody(400, 'Bad Request', 'Validation failed for 1 field(s)', path)
    }
    if (body.blocks.length > 100) return errorBody(400, 'Bad Request', 'Validation failed for 1 field(s)', path)

    const rejections: PlanRejection[] = []
    const seen = new Set<number>()
    const spans: { index: number; taskId: number; start: number; end: number }[] = []
    body.blocks.forEach((block, index) => {
      const reject = (reason: string, detail: string) => rejections.push({ blockIndex: index, taskId: block.taskId, reason, detail })
      const task = mockTasks.find((candidate) => candidate.id === block.taskId)
      if (!task) return reject('TASK_NOT_FOUND', `task ${block.taskId} not found`)
      if (seen.has(task.id)) return reject('DUPLICATE_TASK', `task ${task.id} appears more than once`)
      seen.add(task.id)
      if (isCompleted(task)) reject('TASK_COMPLETED', `task ${task.id} is completed`)
      const linked = mockSchedules.find((schedule) => schedule.taskId === task.id)
      if (linked) reject('TASK_ALREADY_SCHEDULED', `task ${task.id} already has schedule ${linked.id}`)
      const start = dayjs.tz(block.startTime, body.zoneId).valueOf()
      const end = start + effectiveExpectedMinutes(task) * 60000
      if (start < Date.now()) reject('STARTS_IN_PAST', `starts at ${block.startTime}, before now`)
      mockSchedules.forEach((schedule) => {
        const span = scheduleSpan(schedule)
        if (start < span.end && span.start < end) {
          reject('OVERLAPS_SCHEDULE', `overlaps schedule ${schedule.id} "${schedule.title}"`)
        }
      })
      spans.push({ index, taskId: task.id, start, end })
    })
    spans.forEach((a) =>
      spans.forEach((b) => {
        if (a !== b && a.start < b.end && b.start < a.end) {
          rejections.push({ blockIndex: a.index, taskId: a.taskId, reason: 'OVERLAPS_BLOCK', detail: `overlaps block ${b.index} (task ${b.taskId})` })
        }
      }),
    )
    if (rejections.length > 0) {
      rejections.sort((a, b) => a.blockIndex - b.blockIndex)
      const summary = rejections.map((r) => `block ${r.blockIndex} (task ${r.taskId}) ${r.reason}`).join('; ')
      return errorBody(409, 'Conflict', `Plan rejected, no schedule was created: ${summary}`, path, { rejections })
    }

    const created = body.blocks.map((block) => {
      const task = mockTasks.find((candidate) => candidate.id === block.taskId) as Task
      const schedule: ScheduleResponse = {
        id: nextScheduleId(),
        ownerId: 1,
        title: task.title,
        description: task.description,
        date: { dateTime: block.startTime, zoneId: body.zoneId },
        scheduleType: block.scheduleType ?? suggestedType(task),
        state: 'NOT_STARTED',
        taskId: task.id,
        duration: 'PT0S',
        plannedDuration: isoMinutes(effectiveExpectedMinutes(task)),
      }
      mockSchedules.push(schedule)
      return schedule
    })
    return json({ schedules: created }, 201)
  }

  return null
}
