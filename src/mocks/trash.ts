import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
import type { Task } from '../features/tasks/types/task'
import type { ScheduleResponse } from '../features/schedules/types/schedule'
import type { TrashContents } from '../features/trash/types/trash'
import { activeScheduleId, mockSchedules, mockTasks, setActiveScheduleId } from './db'
import { personalSpaceId, placementOf } from './workspaceState'

dayjs.extend(utc)
dayjs.extend(timezone)

// 개발용 모크. 휴지통 규칙은 서버(ADR-0024, ADR-0037 §5)에 있고, 여기서는 화면 확인에 필요한 모양만 흉내 낸다.
// 지운 작업·일정을 보관했다가 복구하거나 영구 삭제한다. 선후관계는 모크에 없으므로 복구할 것도 없다.
// 일정은 주인만 다룬다. 작업과 함께 지운 일정도 주인이 혼자 복구·영구 삭제하고, 복구는 어떤 일정도 작업에 다시 잇지 않는다.

const ZONE_ID = 'Asia/Seoul'
const RETENTION_DAYS = 30

type TrashedTaskEntry = { task: Task; deletedAt: string }
/** withTaskId: 작업과 함께 지운 일정이면 그 작업(서버 `trashed_with_task`, `trashed_task_id`), 혼자 지웠으면 null. */
type TrashedScheduleEntry = { schedule: ScheduleResponse; deletedAt: string; withTaskId: number | null }

let trashedTasks: TrashedTaskEntry[] = []
let trashedSchedules: TrashedScheduleEntry[] = []

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

const noContent = () => new Response(null, { status: 204 })

const notFound = () => json({ message: '휴지통에서 찾을 수 없습니다.' }, 404)

const zoned = (iso: string) => ({ dateTime: dayjs(iso).tz(ZONE_ID).format('YYYY-MM-DDTHH:mm:ss'), zoneId: ZONE_ID })

const purgeAt = (deletedAt: string) => dayjs(deletedAt).add(RETENTION_DAYS, 'day').toISOString()

/** actor가 없으면(예전 개인 경로) 누구의 일정이든 부른 사람의 것으로 본다. */
const owns = (actor: number | undefined, schedule: ScheduleResponse) =>
  actor === undefined || schedule.ownerId === actor

const removeSchedule = (id: number) => {
  const index = mockSchedules.findIndex((schedule) => schedule.id === id)
  if (index === -1) return null
  const [schedule] = mockSchedules.splice(index, 1)
  if (activeScheduleId === id) setActiveScheduleId(null)
  return schedule
}

/** 휴지통의 일정은 작업에 연결돼 있지 않다. 복구해도 다시 잇지 않는다. */
const trashSchedule = (schedule: ScheduleResponse, withTaskId: number | null) => {
  trashedSchedules = [
    { schedule: { ...schedule, taskId: undefined }, deletedAt: new Date().toISOString(), withTaskId },
    ...trashedSchedules,
  ]
}

/**
 * DELETE /tasks/{id}: 작업을 휴지통으로. deleteSchedules(또는 반복 회차)면 지우는 사람 자신의 연결 일정을 함께 보내고,
 * 다른 사람의 일정과 남기는 일정은 연결만 끊는다(ADR-0037 §5). 함께 보낸 일정과 끊은 일정의 id를 돌려준다.
 */
export const moveTaskToTrash = (taskId: number, deleteSchedules: boolean, actor?: number) => {
  const index = mockTasks.findIndex((task) => task.id === taskId)
  if (index === -1) return false
  const [task] = mockTasks.splice(index, 1)
  const linked = mockSchedules.filter((schedule) => schedule.taskId === taskId)
  const trashedScheduleIds: number[] = []
  const cutScheduleIds: number[] = []
  linked.forEach((schedule) => {
    if ((deleteSchedules || task.recurrence) && owns(actor, schedule)) {
      const removed = removeSchedule(schedule.id)
      if (removed) {
        trashSchedule(removed, taskId)
        trashedScheduleIds.push(removed.id)
      }
    } else {
      schedule.taskId = undefined
      cutScheduleIds.push(schedule.id)
    }
  })
  trashedTasks = [{ task, deletedAt: new Date().toISOString() }, ...trashedTasks]
  return { trashedScheduleIds, cutScheduleIds }
}

/** 휴지통에 있는 작업과 보낸 시각. 없으면 null. */
export const trashedTaskOf = (taskId: number): { task: Task; deletedAt: string } | null => {
  const entry = trashedTasks.find(({ task }) => task.id === taskId)
  return entry ? { task: entry.task, deletedAt: entry.deletedAt } : null
}

/** 작업을 되살리고, 아직 휴지통에 있는 함께 지운 일정을 주인과 무관하게 주인의 독립 일정으로 되돌린다. */
const restoreEntry = (entry: TrashedTaskEntry) => {
  trashedTasks = trashedTasks.filter((item) => item !== entry)
  mockTasks.push(entry.task)
  const withTask = trashedSchedules.filter((item) => item.withTaskId === entry.task.id)
  trashedSchedules = trashedSchedules.filter((item) => item.withTaskId !== entry.task.id)
  return withTask.map(({ schedule }) => {
    const restored = { ...schedule, taskId: undefined }
    mockSchedules.push(restored)
    return restored
  })
}

/** 휴지통의 작업을 함께 보낸 일정과 같이 되살린다. 휴지통에 없으면 false. */
export const restoreTaskFromTrash = (taskId: number) => {
  const entry = trashedTasks.find(({ task }) => task.id === taskId)
  if (!entry) return false
  restoreEntry(entry)
  return true
}

/**
 * 작업 복구. restoredScheduleIds에는 부른 사람이 주인인 일정만 싣고, relinkedScheduleIds는 늘 비어 있다(ADR-0037 §5).
 * scheduleIds는 되돌린 일정 전부다. 워크스페이스 모크가 주인의 스트림에 기록을 남길 때 쓴다.
 */
export const restoreTrashedTask = (taskId: number, actor?: number) => {
  const entry = trashedTasks.find(({ task }) => task.id === taskId)
  if (!entry) return null
  const schedules = restoreEntry(entry)
  return {
    result: {
      taskId,
      restoredScheduleIds: schedules.filter((schedule) => owns(actor, schedule)).map((schedule) => schedule.id),
      relinkedScheduleIds: [] as number[],
      restoredDependencies: 0,
      skippedDependencies: 0,
    },
    scheduleIds: schedules.map((schedule) => schedule.id),
  }
}

/** 작업 영구 삭제. 함께 지운 일정 가운데 부른 사람 자신의 것만 지우고, 남의 것은 주인이 혼자 지운 일정으로 남긴다. */
const purgeTaskEntry = (entry: TrashedTaskEntry, actor?: number) => {
  trashedTasks = trashedTasks.filter((item) => item !== entry)
  trashedSchedules = trashedSchedules
    .filter((item) => item.withTaskId !== entry.task.id || !owns(actor, item.schedule))
    .map((item) => (item.withTaskId === entry.task.id ? { ...item, withTaskId: null } : item))
}

/** DELETE /schedules/{id}: 일정을 휴지통으로. */
export const moveScheduleToTrash = (scheduleId: number) => {
  const schedule = removeSchedule(scheduleId)
  if (!schedule) return false
  trashSchedule(schedule, null)
  return true
}

/** 워크스페이스 복구·영구 삭제가 확인하는 위치와 버전(`/v2/workspace/{kind}/{id}/restore`). 일정은 주인의 개인 스페이스다. */
const rowMetadata = (kind: 'task' | 'schedule', id: number) => {
  const { spaceId, projectId, version } = placementOf(kind, id)
  return { spaceId, projectId, version, allowedActions: { restore: true, delete: true } }
}

/** 일정은 내 것만 나온다. 작업과 함께 지운 내 일정은 그 작업 아래에 묶고, 그 작업이 목록에 없으면 혼자 지운 일정과 같이 둔다. */
const contents = (actor?: number): TrashContents => {
  const mine = trashedSchedules.filter(({ schedule }) => owns(actor, schedule))
  const taskIds = new Set(trashedTasks.map(({ task }) => task.id))
  return {
    retentionDays: RETENTION_DAYS,
    tasks: trashedTasks.map(({ task, deletedAt }) => ({
      ...rowMetadata('task', task.id),
      taskId: task.id,
      title: task.title,
      dueDate: task.dueDate,
      completed: task.completed,
      recurrence: task.recurrence ?? null,
      deletedAt: zoned(deletedAt),
      purgeAt: zoned(purgeAt(deletedAt)),
      schedules: mine
        .filter((item) => item.withTaskId === task.id)
        .map(({ schedule }) => ({ scheduleId: schedule.id, title: schedule.title, date: schedule.date })),
    })),
    schedules: mine
      .filter((item) => item.withTaskId === null || !taskIds.has(item.withTaskId))
      .map(({ schedule, deletedAt }) => ({
        ...rowMetadata('schedule', schedule.id),
        scheduleId: schedule.id,
        title: schedule.title,
        date: schedule.date,
        state: schedule.state,
        recurrence: schedule.recurrence ?? null,
        deletedAt: zoned(deletedAt),
        purgeAt: zoned(purgeAt(deletedAt)),
      })),
  }
}

/** actor는 부른 회원이다. 없으면(예전 개인 경로) 모든 일정을 그 사람의 것으로 본다. */
export const handleTrash = (path: string, method: string, actor?: number) => {
  const normalizedPath = path.replace(/^\/v[0-9]+\//, '/')
  if (!normalizedPath.startsWith('/trash')) return null

  if (method === 'GET' && normalizedPath === '/trash') return json(contents(actor))

  if (method === 'DELETE' && normalizedPath === '/trash') {
    // 개인 스페이스의 휴지통 작업, 내가 혼자 지운 일정, 그 작업들과 함께 지운 내 일정을 지운다(ADR-0037 §5).
    // 팀 스페이스 휴지통의 작업과, 그 작업과 함께 지운 내 일정은 남는다.
    trashedTasks
      .filter(({ task }) => actor === undefined || placementOf('task', task.id).spaceId === personalSpaceId(actor))
      .forEach((entry) => purgeTaskEntry(entry, actor))
    trashedSchedules = trashedSchedules.filter(
      (item) => item.withTaskId !== null || !owns(actor, item.schedule),
    )
    return noContent()
  }

  const taskMatch = normalizedPath.match(/^\/trash\/tasks\/(\d+)(\/restore)?$/)
  if (taskMatch) {
    const restore = Boolean(taskMatch[2])
    if (method !== (restore ? 'POST' : 'DELETE')) return null
    const id = Number(taskMatch[1])
    if (restore) {
      const restored = restoreTrashedTask(id, actor)
      return restored ? json(restored.result) : notFound()
    }
    const entry = trashedTasks.find(({ task }) => task.id === id)
    if (!entry) return notFound()
    purgeTaskEntry(entry, actor)
    return noContent()
  }

  const scheduleMatch = normalizedPath.match(/^\/trash\/schedules\/(\d+)(\/restore)?$/)
  if (scheduleMatch) {
    const restore = Boolean(scheduleMatch[2])
    if (method !== (restore ? 'POST' : 'DELETE')) return null
    const id = Number(scheduleMatch[1])
    // 작업과 함께 지운 일정도 주인이 혼자 복구·영구 삭제한다. 예전의 409 TRASHED_WITH_TASK는 없다.
    const entry = trashedSchedules.find(({ schedule }) => schedule.id === id && owns(actor, schedule))
    if (!entry) return notFound()
    trashedSchedules = trashedSchedules.filter((item) => item !== entry)
    if (!restore) return noContent()
    // 복구는 작업에 다시 잇지 않는다. 작업이 살아 있어도 주인의 독립 일정으로 돌아온다.
    mockSchedules.push({ ...entry.schedule, taskId: undefined })
    return json({ scheduleId: id, linkedTaskId: null })
  }

  return null
}
