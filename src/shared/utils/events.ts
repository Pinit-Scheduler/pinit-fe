export type TaskChangedDetail = {
  taskId?: number
  reason?: string
}

export type ScheduleChangedDetail = {
  scheduleId?: number
  schedule?: unknown
  previousDateKey?: string
  reason?: string
  payload?: unknown
}

/** Every change event delivered to one listener in one flush, in dispatch order. */
export type DataChangeBatch = {
  tasks: TaskChangedDetail[]
  schedules: ScheduleChangedDetail[]
}

export type ChangeKind = 'task' | 'schedule'
const EVENT_NAME: Record<ChangeKind, string> = {
  task: 'task:changed',
  schedule: 'schedule:changed',
}

// ---------------------------------------------------------------------------
// Local change registry. The realtime stream uses it to recognise the echo of
// a change this client just saved, so it does not refetch every list again.
// ---------------------------------------------------------------------------

const LOCAL_ECHO_WINDOW_MS = 5000
// These reasons only re-read state. Nothing was saved, so the server has nothing to echo.
const READ_ONLY_REASONS = new Set(['conflict-reloaded', 'state-verified'])
const localChanges = new Map<string, number[]>()
const localKey = (kind: ChangeKind, id: number) => `${kind}:${id}`

const recentLocal = (key: string, at: number) =>
  (localChanges.get(key) ?? []).filter((time) => at - time < LOCAL_ECHO_WINDOW_MS)

const recordLocalChange = (kind: ChangeKind, id: unknown, reason?: string) => {
  if (typeof id !== 'number' || !Number.isFinite(id)) return
  if (reason && READ_ONLY_REASONS.has(reason)) return
  const key = localKey(kind, id)
  const at = Date.now()
  localChanges.set(key, [...recentLocal(key, at), at])
}

/**
 * True at most once per local save of this resource in the last few seconds.
 * The realtime layer asks this for each server event. A match is the echo of our own save,
 * which the local event already refreshed. One local save absorbs one server event only,
 * so a second change to the same resource still refreshes.
 */
export const takeLocalEcho = (kind: ChangeKind, id: number): boolean => {
  const key = localKey(kind, id)
  const list = recentLocal(key, Date.now())
  if (list.length === 0) {
    localChanges.delete(key)
    return false
  }
  list.shift()
  if (list.length) localChanges.set(key, list)
  else localChanges.delete(key)
  return true
}

// ---------------------------------------------------------------------------
// Dispatch. Events stay plain window CustomEvents, so direct window listeners keep working.
// ---------------------------------------------------------------------------

export const dispatchTaskChanged = (detail: TaskChangedDetail | number, reason?: string) => {
  const detailObj: TaskChangedDetail =
    typeof detail === 'number' ? { taskId: detail, reason } : detail
  recordLocalChange('task', detailObj.taskId, detailObj.reason)
  window.dispatchEvent(new CustomEvent<TaskChangedDetail>('task:changed', { detail: detailObj }))
}

export const dispatchScheduleChanged = (
  detail: ScheduleChangedDetail | string,
  payload?: unknown,
) => {
  const detailObj: ScheduleChangedDetail =
    typeof detail === 'string' ? { reason: detail, payload } : detail
  const embeddedId = (detailObj.schedule as { id?: unknown } | null | undefined)?.id
  recordLocalChange('schedule', detailObj.scheduleId ?? embeddedId, detailObj.reason)
  window.dispatchEvent(new CustomEvent<ScheduleChangedDetail>('schedule:changed', { detail: detailObj }))
}

// ---------------------------------------------------------------------------
// Coalesced subscriptions. One user action often fires task:changed and
// schedule:changed two or three times in the same task, and again from
// awaited continuations of it. Each listener gets one call per flush instead.
// ---------------------------------------------------------------------------

type Subscriber = {
  active: boolean
  batch: DataChangeBatch
  deliver: (batch: DataChangeBatch) => void
}

const queued = new Set<Subscriber>()
let flushScheduled = false

const flush = () => {
  flushScheduled = false
  const subscribers = Array.from(queued)
  queued.clear()
  for (const subscriber of subscribers) {
    if (!subscriber.active) continue
    const batch = subscriber.batch
    subscriber.batch = { tasks: [], schedules: [] }
    try {
      subscriber.deliver(batch)
    } catch (error) {
      // One failing listener must not cancel the others' notification.
      setTimeout(() => {
        throw error
      }, 0)
    }
  }
}

const scheduleFlush = () => {
  if (flushScheduled) return
  flushScheduled = true
  // A macrotask, not a microtask, so "dispatch, await, dispatch" still lands in one batch.
  setTimeout(flush, 0)
}

/**
 * Subscribe to task and/or schedule changes, coalesced. The handler runs at most once per flush
 * (right after the current task) with every detail dispatched since its last call.
 * Use this when a listener reacts to both kinds: it then refetches once, not twice.
 */
export const onDataChanged = (
  handler: (batch: DataChangeBatch) => void,
  kinds: readonly ChangeKind[] = ['task', 'schedule'],
) => {
  const subscriber: Subscriber = {
    active: true,
    batch: { tasks: [], schedules: [] },
    deliver: handler,
  }
  const listeners = kinds.map((kind) => {
    const listener = (event: Event) => {
      if (!subscriber.active) return
      const detail = (event as CustomEvent).detail ?? {}
      if (kind === 'task') subscriber.batch.tasks.push(detail as TaskChangedDetail)
      else subscriber.batch.schedules.push(detail as ScheduleChangedDetail)
      queued.add(subscriber)
      scheduleFlush()
    }
    window.addEventListener(EVENT_NAME[kind], listener)
    return { kind, listener }
  })
  return () => {
    subscriber.active = false
    queued.delete(subscriber)
    listeners.forEach(({ kind, listener }) =>
      window.removeEventListener(EVENT_NAME[kind], listener),
    )
  }
}

/** The fields every detail agrees on. A single detail is returned as is. */
export const mergeChangeDetails = <T extends object>(details: readonly T[]): T => {
  if (details.length === 1) return details[0]
  const [first, ...rest] = details as readonly Record<string, unknown>[]
  const merged: Record<string, unknown> = {}
  if (first)
    for (const key of Object.keys(first))
      if (rest.every((detail) => Object.is(detail[key], first[key]))) merged[key] = first[key]
  return merged as T
}

/**
 * Coalesced task:changed. `detail` keeps only the fields all batched events share
 * (for a single event, that event's detail). `details` lists every event in order.
 */
export const onTaskChanged = (
  handler: (detail: TaskChangedDetail, details: TaskChangedDetail[]) => void,
) => onDataChanged((batch) => handler(mergeChangeDetails(batch.tasks), batch.tasks), ['task'])

/** Coalesced schedule:changed. Same contract as onTaskChanged. */
export const onScheduleChanged = (
  handler: (detail: ScheduleChangedDetail, details: ScheduleChangedDetail[]) => void,
) =>
  onDataChanged(
    (batch) => handler(mergeChangeDetails(batch.schedules), batch.schedules),
    ['schedule'],
  )
