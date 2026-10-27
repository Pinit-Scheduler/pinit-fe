import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
import type {
  RecurrenceCreateRequest,
  RecurrenceRule,
  RecurrenceSeries,
  RecurrenceStatus,
  RecurrenceUpdateRequest,
} from '../features/recurrence/types/recurrence'
import { HORIZON_DAYS, dayOfWeekOf, daysBetween } from '../features/recurrence/utils/recurrenceRules'
import { mockSchedules, mockTasks, nextScheduleId, nextTaskId } from './db'

dayjs.extend(utc)
dayjs.extend(timezone)

// 개발용 모크. 회차 생성·범위 편집 규칙은 서버(ADR-0019)에 있고, 여기서는 화면 확인에 필요한
// 모양(목록, 생성, 범위 수정·삭제와 dry-run impact, 일정·작업의 회차 표시)만 흉내 낸다.
// 회차는 오늘부터 HORIZON_DAYS일 앞까지 만들고, 시작했거나 끝낸 회차는 지우지 않는다(protected).

const ZONE_ID = 'Asia/Seoul'

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

const validationError = (path: string, field: string, reason: string) =>
  json(
    {
      timestamp: new Date().toISOString(),
      status: 400,
      error: 'Bad Request',
      message: reason,
      path: `uri=${path}`,
      errors: [{ field, reason, rejectedValue: null }],
    },
    400,
  )

const notFound = () => json({ message: '반복을 찾을 수 없습니다.' }, 404)

const readJson = async <T>(request: Request): Promise<T | null> => {
  try {
    return (await request.json()) as T
  } catch {
    return null
  }
}

const todayKey = () => dayjs().tz(ZONE_ID).format('YYYY-MM-DD')
const addDaysKey = (dateKey: string, days: number) => dayjs(dateKey).add(days, 'day').format('YYYY-MM-DD')

const monthsBetween = (a: string, b: string) =>
  (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7))

/** 규칙의 회차 날짜 중 [from, to]에 드는 것. count는 시작일부터 센다. */
export const occurrenceDates = (rule: RecurrenceRule, from: string, to: string): string[] => {
  const last = rule.until && rule.until < to ? rule.until : to
  const startMonday = addDaysKey(rule.startDate, -((Number(dayjs(rule.startDate).format('d')) + 6) % 7))
  const dates: string[] = []
  let seen = 0
  for (let date = rule.startDate; date <= last; date = addDaysKey(date, 1)) {
    const matches =
      rule.freq === 'DAILY'
        ? daysBetween(rule.startDate, date) % rule.interval === 0
        : rule.freq === 'WEEKLY'
          ? (rule.days ?? []).includes(dayOfWeekOf(date)) && Math.floor(daysBetween(startMonday, date) / 7) % rule.interval === 0
          : Number(date.slice(8, 10)) === rule.dayOfMonth && monthsBetween(rule.startDate, date) % rule.interval === 0
    if (!matches) continue
    seen += 1
    if (rule.count && seen > rule.count) break
    if (date >= from) dates.push(date)
  }
  return dates
}

let seriesSeq = 0
const mockRecurrences: RecurrenceSeries[] = []

const isOccurrenceOf = (seriesId: number, fromDate: string) => (item: { recurrence?: { seriesId: number; occurrenceDate: string } | null }) =>
  item.recurrence?.seriesId === seriesId && item.recurrence.occurrenceDate >= fromDate

/** 아직 남아 있는(지우지 않고 지킨) 회차의 날짜들. 다시 만들 때 같은 날짜를 또 만들지 않는다. */
const existingOccurrenceDates = (seriesId: number) =>
  new Set(
    [...mockSchedules, ...mockTasks]
      .filter((item) => item.recurrence?.seriesId === seriesId)
      .map((item) => item.recurrence?.occurrenceDate),
  )

/** fromDate부터 HORIZON_DAYS까지 새로 만들 회차 날짜. freed는 곧 지울(그래서 다시 만들어도 되는) 회차 날짜다. */
const datesToGenerate = (series: RecurrenceSeries, fromDate: string, freed: Set<string> = new Set()) => {
  const existing = existingOccurrenceDates(series.id as number)
  freed.forEach((date) => existing.delete(date))
  const from = fromDate < series.rule.startDate ? series.rule.startDate : fromDate
  return occurrenceDates(series.rule, from, addDaysKey(todayKey(), HORIZON_DAYS)).filter((date) => !existing.has(date))
}

const generate = (series: RecurrenceSeries, fromDate: string) => {
  const seriesId = series.id as number
  const dates = datesToGenerate(series, fromDate)
  for (const date of dates) {
    const recurrence = { seriesId, occurrenceDate: date }
    if (series.mode === 'FIXED' && series.fixed) {
      mockSchedules.push({
        id: nextScheduleId(),
        ownerId: 1,
        title: series.title,
        description: series.description,
        date: { dateTime: `${date}T${series.fixed.startTime}:00`, zoneId: series.zoneId },
        scheduleType: series.fixed.scheduleType,
        state: 'NOT_STARTED',
        duration: '00:00:00',
        plannedDuration: series.fixed.plannedDuration,
        recurrence,
      })
    } else if (series.flexible) {
      mockTasks.push({
        id: nextTaskId(),
        title: series.title,
        description: series.description,
        dueDate: { date, zoneId: series.zoneId, offset: dayjs.tz(date, series.zoneId).format('Z') },
        importance: series.flexible.importance,
        difficulty: series.flexible.difficulty,
        expectedDuration: series.flexible.expectedDuration ?? null,
        isCompleted: false,
        completed: false,
        inboundDependencyCount: 0,
        recurrence,
        missed: false,
      })
    }
  }
  series.generatedUntil = addDaysKey(todayKey(), HORIZON_DAYS)
  return dates.length
}

const linkedSchedules = (taskId: number) => mockSchedules.filter((schedule) => schedule.taskId === taskId)

/**
 * fromDate 이후 회차를 지운다. 시작했거나 끝낸 회차는 남긴다(작업 회차는 완료됐거나 거기서 배정한 일정이 시작됐으면 남긴다).
 * 지우는 작업 회차에서 배정한 시작 전 일정도 같이 지운다. dryRun이면 세기만 한다.
 */
const removeOccurrences = (seriesId: number, fromDate: string, dryRun: boolean) => {
  const inScope = isOccurrenceOf(seriesId, fromDate)
  const schedules = mockSchedules.filter(inScope)
  const tasks = mockTasks.filter(inScope)
  const removableSchedules = schedules.filter((schedule) => schedule.state === 'NOT_STARTED')
  const removableTasks = tasks.filter(
    (task) => !(task.completed ?? task.isCompleted) && linkedSchedules(task.id).every((schedule) => schedule.state === 'NOT_STARTED'),
  )
  const deleted = removableSchedules.length + removableTasks.length
  const protectedCount = schedules.length + tasks.length - deleted
  const freedDates = new Set([...removableSchedules, ...removableTasks].flatMap((item) => (item.recurrence ? [item.recurrence.occurrenceDate] : [])))
  if (!dryRun) {
    const doomedSchedules = [...removableSchedules, ...removableTasks.flatMap((task) => linkedSchedules(task.id))]
    for (const schedule of doomedSchedules) mockSchedules.splice(mockSchedules.indexOf(schedule), 1)
    for (const task of removableTasks) mockTasks.splice(mockTasks.indexOf(task), 1)
  }
  return { deleted, protected: protectedCount, freedDates }
}

const now = () => new Date().toISOString()

const createSeries = (body: RecurrenceCreateRequest): RecurrenceSeries => {
  const series: RecurrenceSeries = {
    id: ++seriesSeq,
    mode: body.mode,
    status: 'ACTIVE',
    title: body.title,
    description: body.description ?? '',
    fixed: body.mode === 'FIXED' ? (body.fixed ?? null) : null,
    flexible: body.mode === 'FLEXIBLE' ? (body.flexible ?? null) : null,
    rule: body.rule,
    zoneId: body.zoneId || ZONE_ID,
    generatedUntil: body.rule.startDate,
    ended: false,
    createdAt: now(),
    updatedAt: now(),
  }
  mockRecurrences.push(series)
  generate(series, todayKey())
  return series
}

const markEndedIfDone = (series: RecurrenceSeries) => {
  series.ended = series.status === 'ENDED' || occurrenceDates(series.rule, todayKey(), addDaysKey(todayKey(), 366 * 2)).length === 0
}

// 화면을 바로 볼 수 있게 시리즈 두 개를 깔아 둔다.
createSeries({
  mode: 'FIXED',
  title: '아침 운동',
  description: '스트레칭 20분',
  fixed: { startTime: '07:30', plannedDuration: 'PT30M', scheduleType: 'QUICK_TASK' },
  rule: { freq: 'WEEKLY', interval: 1, days: ['MONDAY', 'WEDNESDAY', 'FRIDAY'], startDate: todayKey(), until: null, count: null },
  zoneId: ZONE_ID,
})
createSeries({
  mode: 'FLEXIBLE',
  title: '주간 보고 쓰기',
  description: '팀 채널에 공유',
  flexible: { importance: 6, difficulty: 3, expectedDuration: null },
  rule: { freq: 'WEEKLY', interval: 1, days: ['FRIDAY'], startDate: todayKey(), until: null, count: null },
  zoneId: ZONE_ID,
})

export const handleRecurrences = async (path: string, method: string, searchParams: URLSearchParams, request: Request) => {
  if (path === '/v2/recurrences' && method === 'GET') {
    const status = (searchParams.get('status') ?? 'ACTIVE') as RecurrenceStatus
    return json({ recurrences: mockRecurrences.filter((series) => series.status === status) })
  }

  if (path === '/v2/recurrences' && method === 'POST') {
    const body = await readJson<RecurrenceCreateRequest>(request)
    if (!body?.title?.trim()) return validationError(path, 'title', '제목을 입력해 주세요.')
    if (!body.rule?.startDate) return validationError(path, 'rule.startDate', '시작일을 골라 주세요.')
    if (body.rule.freq === 'WEEKLY' && !body.rule.days?.length) return validationError(path, 'rule.days', '요일을 하나 이상 골라 주세요.')
    return json(createSeries(body), 201)
  }

  const match = path.match(/^\/v2\/recurrences\/(\d+)$/)
  if (!match) return null
  const series = mockRecurrences.find((item) => item.id === Number(match[1]))
  if (!series) return notFound()

  if (method === 'GET') return json(series)

  const dryRun = searchParams.get('dryRun') === 'true'

  if (method === 'DELETE') {
    const scope = searchParams.get('scope')
    const fromDate = scope === 'FOLLOWING' ? (searchParams.get('fromDate') ?? todayKey()) : series.rule.startDate
    const { deleted, protected: protectedCount } = removeOccurrences(series.id as number, fromDate, dryRun)
    if (!dryRun) {
      // 전체 삭제는 반복을 끝내고, 이번 및 이후 삭제는 기준 회차 전날까지로 규칙을 줄인다.
      if (scope === 'FOLLOWING') series.rule = { ...series.rule, until: addDaysKey(fromDate, -1), count: null }
      else series.status = 'ENDED'
      markEndedIfDone(series)
      series.updatedAt = now()
    }
    return json({ impact: { deleted, protected: protectedCount } })
  }

  if (method === 'PATCH') {
    const body = await readJson<RecurrenceUpdateRequest>(request)
    if (!body?.changes) return validationError(path, 'changes', '바꿀 값이 없습니다.')
    const fromDate = body.scope === 'FOLLOWING' ? (body.fromDate ?? todayKey()) : todayKey()
    const previous = structuredClone(series)
    const next: RecurrenceSeries = {
      ...series,
      title: body.changes.title ?? series.title,
      description: body.changes.description ?? series.description,
      fixed: series.fixed && body.changes.fixed ? { ...series.fixed, ...body.changes.fixed } : series.fixed,
      flexible: series.flexible && body.changes.flexible ? { ...series.flexible, ...body.changes.flexible } : series.flexible,
      rule: body.changes.rule ?? series.rule,
      zoneId: body.changes.zoneId ?? series.zoneId,
      updatedAt: now(),
    }
    // 모크는 바꿀 범위의 남은 회차를 지우고 새 값으로 다시 만든다(서버는 바뀐 칸만 고칠 수 있으면 고친다).
    const { deleted, freedDates } = removeOccurrences(series.id as number, fromDate, dryRun)
    let created: number
    if (dryRun) {
      created = datesToGenerate(next, fromDate, freedDates).length
    } else {
      Object.assign(series, next)
      created = generate(series, fromDate)
      markEndedIfDone(series)
    }
    return json({
      series: dryRun ? next : series,
      previous,
      impact: { patched: 0, deleted, created, overwrittenIndividualEdits: 0 },
    })
  }

  return null
}
