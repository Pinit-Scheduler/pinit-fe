import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
import type { Task } from '../features/tasks/types/task'
import type { ScheduleResponse } from '../features/schedules/types/schedule'
import type { TrashContents } from '../features/trash/types/trash'
import { activeScheduleId, mockSchedules, mockTasks, setActiveScheduleId } from './db'

dayjs.extend(utc)
dayjs.extend(timezone)

// 개발용 모크. 휴지통 규칙은 서버(ADR-0024)에 있고, 여기서는 화면 확인에 필요한 모양만 흉내 낸다.
// 지운 작업·일정을 보관했다가 복구하거나 영구 삭제한다. 선후관계는 모크에 없으므로 복구할 것도 없다.

const ZONE_ID = 'Asia/Seoul'
const RETENTION_DAYS = 30

type TrashedTaskEntry = { task: Task; deletedAt: string; schedules: ScheduleResponse[] }
type TrashedScheduleEntry = { schedule: ScheduleResponse; deletedAt: string }

let trashedTasks: TrashedTaskEntry[] = []
let trashedSchedules: TrashedScheduleEntry[] = []

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

const noContent = () => new Response(null, { status: 204 })

const notFound = () => json({ message: '휴지통에서 찾을 수 없습니다.' }, 404)

const zoned = (iso: string) => ({ dateTime: dayjs(iso).tz(ZONE_ID).format('YYYY-MM-DDTHH:mm:ss'), zoneId: ZONE_ID })

const purgeAt = (deletedAt: string) => dayjs(deletedAt).add(RETENTION_DAYS, 'day').toISOString()

const removeSchedule = (id: number) => {
  const index = mockSchedules.findIndex((schedule) => schedule.id === id)
  if (index === -1) return null
  const [schedule] = mockSchedules.splice(index, 1)
  if (activeScheduleId === id) setActiveScheduleId(null)
  return schedule
}

/** DELETE /tasks/{id}: 작업을 휴지통으로. deleteSchedules면 연결 일정도 함께 보내고, 아니면 연결만 끊는다. */
export const moveTaskToTrash = (taskId: number, deleteSchedules: boolean) => {
  const index = mockTasks.findIndex((task) => task.id === taskId)
  if (index === -1) return false
  const [task] = mockTasks.splice(index, 1)
  const linked = mockSchedules.filter((schedule) => schedule.taskId === taskId)
  const schedules: ScheduleResponse[] = []
  linked.forEach((schedule) => {
    if (deleteSchedules || task.recurrence) {
      const removed = removeSchedule(schedule.id)
      if (removed) schedules.push(removed)
    } else {
      schedule.taskId = undefined
    }
  })
  trashedTasks = [{ task, deletedAt: new Date().toISOString(), schedules }, ...trashedTasks]
  return true
}

/** DELETE /schedules/{id}: 일정을 휴지통으로. */
export const moveScheduleToTrash = (scheduleId: number) => {
  const schedule = removeSchedule(scheduleId)
  if (!schedule) return false
  trashedSchedules = [{ schedule, deletedAt: new Date().toISOString() }, ...trashedSchedules]
  return true
}

const contents = (): TrashContents => ({
  retentionDays: RETENTION_DAYS,
  tasks: trashedTasks.map(({ task, deletedAt, schedules }) => ({
    taskId: task.id,
    title: task.title,
    dueDate: task.dueDate,
    completed: task.completed,
    recurrence: task.recurrence ?? null,
    deletedAt: zoned(deletedAt),
    purgeAt: zoned(purgeAt(deletedAt)),
    schedules: schedules.map((schedule) => ({ scheduleId: schedule.id, title: schedule.title, date: schedule.date })),
  })),
  schedules: trashedSchedules.map(({ schedule, deletedAt }) => ({
    scheduleId: schedule.id,
    title: schedule.title,
    date: schedule.date,
    state: schedule.state,
    recurrence: schedule.recurrence ?? null,
    deletedAt: zoned(deletedAt),
    purgeAt: zoned(purgeAt(deletedAt)),
  })),
})

export const handleTrash = (path: string, method: string) => {
  const normalizedPath = path.replace(/^\/v[0-9]+\//, '/')
  if (!normalizedPath.startsWith('/trash')) return null

  if (method === 'GET' && normalizedPath === '/trash') return json(contents())

  if (method === 'DELETE' && normalizedPath === '/trash') {
    trashedTasks = []
    trashedSchedules = []
    return noContent()
  }

  const taskMatch = normalizedPath.match(/^\/trash\/tasks\/(\d+)(\/restore)?$/)
  if (taskMatch) {
    const restore = Boolean(taskMatch[2])
    if (method !== (restore ? 'POST' : 'DELETE')) return null
    const id = Number(taskMatch[1])
    const entry = trashedTasks.find(({ task }) => task.id === id)
    if (!entry) return notFound()
    trashedTasks = trashedTasks.filter((item) => item !== entry)
    if (!restore) return noContent()
    mockTasks.push(entry.task)
    entry.schedules.forEach((schedule) => mockSchedules.push({ ...schedule, taskId: id }))
    return json({
      taskId: id,
      restoredScheduleIds: entry.schedules.map((schedule) => schedule.id),
      relinkedScheduleIds: [],
      restoredDependencies: 0,
      skippedDependencies: 0,
    })
  }

  const scheduleMatch = normalizedPath.match(/^\/trash\/schedules\/(\d+)(\/restore)?$/)
  if (scheduleMatch) {
    const restore = Boolean(scheduleMatch[2])
    if (method !== (restore ? 'POST' : 'DELETE')) return null
    const id = Number(scheduleMatch[1])
    const entry = trashedSchedules.find(({ schedule }) => schedule.id === id)
    if (!entry) return notFound()
    trashedSchedules = trashedSchedules.filter((item) => item !== entry)
    if (!restore) return noContent()
    const taskAlive = entry.schedule.taskId != null && mockTasks.some((task) => task.id === entry.schedule.taskId)
    const linkedTaskId = taskAlive ? entry.schedule.taskId : undefined
    mockSchedules.push({ ...entry.schedule, taskId: linkedTaskId })
    return json({ scheduleId: id, linkedTaskId: linkedTaskId ?? null })
  }

  return null
}
