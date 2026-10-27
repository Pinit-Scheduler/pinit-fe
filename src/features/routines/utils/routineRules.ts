import { minutesToIsoDuration, parseIsoDurationMinutes } from '@shared/utils/isoDuration'
import type {
  DayOfWeek,
  Routine,
  RoutineInput,
  RoutineKind,
  RoutineOverrideItem,
  RoutineOverrideItemInput,
} from '../types/routine'

// ADR-0016 생활 시간 규칙의 클라이언트 사본. 서버(domain)가 최종 판단하고, 여기서는 저장 전에
// 같은 기준으로 알려 준다: 0~20개, 이름 1~20자(CUSTOM 필수), 분 단위 시각, 5분~16시간, 요일 1개 이상,
// 한 주를 순환 구간으로 볼 때 서로 겹치지 않음(맞닿음은 허용).

export const MAX_ROUTINES = 20
export const MAX_LABEL_LENGTH = 20
export const MIN_ROUTINE_MINUTES = 5
export const MAX_ROUTINE_MINUTES = 16 * 60
const DAY_MINUTES = 24 * 60
const WEEK_MINUTES = 7 * DAY_MINUTES

export const DAYS_OF_WEEK: DayOfWeek[] = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']

export const DAY_LABEL: Record<DayOfWeek, string> = {
  MONDAY: '월',
  TUESDAY: '화',
  WEDNESDAY: '수',
  THURSDAY: '목',
  FRIDAY: '금',
  SATURDAY: '토',
  SUNDAY: '일',
}

export const WEEKEND_DAYS: DayOfWeek[] = ['SATURDAY', 'SUNDAY']

export const KIND_LABEL: Record<RoutineKind, string> = {
  BREAKFAST: '아침',
  LUNCH: '점심',
  DINNER: '저녁',
  SLEEP: '수면',
  CUSTOM: '직접 추가',
}

export const PRESET_KINDS: Exclude<RoutineKind, 'CUSTOM'>[] = ['BREAKFAST', 'LUNCH', 'DINNER', 'SLEEP']

/** 카드를 켤 때 채우는 흔한 값 (모두 매일) */
export const KIND_PRESET: Record<RoutineKind, { startTime: string; durationMinutes: number }> = {
  BREAKFAST: { startTime: '08:00', durationMinutes: 30 },
  LUNCH: { startTime: '12:00', durationMinutes: 60 },
  DINNER: { startTime: '18:30', durationMinutes: 60 },
  SLEEP: { startTime: '23:30', durationMinutes: 450 },
  CUSTOM: { startTime: '15:00', durationMinutes: 30 },
}

export type RoutineDraft = {
  /** 화면에서만 쓰는 식별자 */
  key: string
  kind: RoutineKind
  label: string
  /** "HH:mm" */
  startTime: string
  /** 입력이 올바르지 않으면 null */
  durationMinutes: number | null
  days: DayOfWeek[]
  /** ADR-0027 시작 알림 */
  remindAtStart: boolean
}

export type RoutineField = 'label' | 'startTime' | 'duration' | 'days'

export type RoutineIssue = {
  field?: RoutineField
  message: string
}

export type RoutineValidation = {
  /** 보낸 순서(인덱스)별 문제 */
  byIndex: Record<number, RoutineIssue[]>
  /** 특정 항목에 붙지 않는 문제(개수 초과 등) */
  general: string[]
}

/** "HH:mm"을 0시부터의 분으로. 형식이 아니면 null */
export const parseClock = (value: string): number | null => {
  const match = /^(\d{2}):(\d{2})$/.exec(value.trim())
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null
  return hours * 60 + minutes
}

export const sortDays = (days: DayOfWeek[]) =>
  DAYS_OF_WEEK.filter((day) => days.includes(day))

export const routineName = (routine: { kind: RoutineKind; label?: string | null }) =>
  routine.label?.trim() || KIND_LABEL[routine.kind]

export const toRoutineDraft = (routine: Routine | RoutineInput, key: string): RoutineDraft => ({
  key,
  kind: routine.kind,
  label: routine.label ?? '',
  startTime: routine.startTime.slice(0, 5),
  durationMinutes: parseIsoDurationMinutes(routine.duration),
  days: sortDays(routine.days),
  remindAtStart: routine.remindAtStart === true,
})

export const toRoutineInput = (draft: RoutineDraft): RoutineInput => ({
  kind: draft.kind,
  label: draft.label.trim() ? draft.label.trim() : null,
  startTime: draft.startTime,
  duration: minutesToIsoDuration(draft.durationMinutes ?? 0),
  days: sortDays(draft.days),
  remindAtStart: draft.remindAtStart,
})

type Occurrence = { day: DayOfWeek; start: number; end: number }

const occurrencesOf = (draft: RoutineDraft): Occurrence[] => {
  const start = parseClock(draft.startTime)
  const duration = draft.durationMinutes
  if (start === null || duration === null) return []
  return sortDays(draft.days).map((day) => {
    const offset = DAYS_OF_WEEK.indexOf(day) * DAY_MINUTES + start
    return { day, start: offset, end: offset + duration }
  })
}

/** 한 주를 순환 구간으로 보고 겹치는지. 맞닿음([a,b)와 [b,c))은 겹침이 아니다 */
const overlapsCyclic = (a: Occurrence, b: Occurrence) =>
  [-WEEK_MINUTES, 0, WEEK_MINUTES].some((shift) => a.start < b.end + shift && b.start + shift < a.end)

const addIssue = (target: Record<number, RoutineIssue[]>, index: number, issue: RoutineIssue) => {
  const issues = target[index] ?? (target[index] = [])
  issues.push(issue)
}

export const validateRoutineDrafts = (drafts: RoutineDraft[]): RoutineValidation => {
  const byIndex: Record<number, RoutineIssue[]> = {}
  const general: string[] = []
  if (drafts.length > MAX_ROUTINES) general.push(`생활 시간은 ${MAX_ROUTINES}개까지 등록할 수 있어요.`)

  drafts.forEach((draft, index) => {
    const label = draft.label.trim()
    if (draft.kind === 'CUSTOM' && !label) addIssue(byIndex, index, { field: 'label', message: '이름을 입력하세요.' })
    if (label.length > MAX_LABEL_LENGTH) {
      addIssue(byIndex, index, { field: 'label', message: `이름은 ${MAX_LABEL_LENGTH}자 이하로 입력하세요.` })
    }
    if (parseClock(draft.startTime) === null) {
      addIssue(byIndex, index, { field: 'startTime', message: '시작 시각을 입력하세요.' })
    }
    const minutes = draft.durationMinutes
    if (minutes === null || !Number.isInteger(minutes) || minutes < MIN_ROUTINE_MINUTES || minutes > MAX_ROUTINE_MINUTES) {
      addIssue(byIndex, index, { field: 'duration', message: '길이는 5분 이상 16시간 이하로 입력하세요.' })
    }
    if (draft.days.length === 0) addIssue(byIndex, index, { field: 'days', message: '요일을 하나 이상 고르세요.' })
  })

  const occurrences = drafts.map(occurrencesOf)
  for (let i = 0; i < drafts.length; i += 1) {
    for (let j = i + 1; j < drafts.length; j += 1) {
      const clash = occurrences[i].flatMap((a) => occurrences[j].filter((b) => overlapsCyclic(a, b)).map((b) => [a, b] as const))[0]
      if (!clash) continue
      const [a, b] = clash
      addIssue(byIndex, i, { message: `${DAY_LABEL[a.day]}요일 "${routineName(drafts[j])}"과 시간이 겹쳐요.` })
      addIssue(byIndex, j, { message: `${DAY_LABEL[b.day]}요일 "${routineName(drafts[i])}"과 시간이 겹쳐요.` })
    }
  }
  return { byIndex, general }
}

export const hasRoutineIssues = (validation: RoutineValidation) =>
  validation.general.length > 0 || Object.keys(validation.byIndex).length > 0

const SERVER_FIELD_PATTERN = /^routines\[(\d+)\](?:\.(\w+))?$/
const KNOWN_FIELDS: RoutineField[] = ['label', 'startTime', 'duration', 'days']

/**
 * 400 본문의 errors[].field(예: "routines[2].startTime", 겹침은 "routines[2]")를 보낸 순서의 항목으로 되돌린다.
 * 항목을 가리키지 않는 오류와 message는 general로 모은다.
 */
export const mapRoutineServerErrors = (payload: unknown): RoutineValidation => {
  const byIndex: Record<number, RoutineIssue[]> = {}
  const general: string[] = []
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { byIndex, general }
  const body = payload as { errors?: unknown; message?: unknown }
  const errors = Array.isArray(body.errors) ? body.errors : []
  errors.forEach((raw) => {
    if (!raw || typeof raw !== 'object') return
    const { field, reason } = raw as { field?: unknown; reason?: unknown }
    const message = typeof reason === 'string' && reason.trim() ? reason.trim() : '값을 확인해 주세요.'
    const match = typeof field === 'string' ? SERVER_FIELD_PATTERN.exec(field) : null
    if (!match) {
      general.push(message)
      return
    }
    const name = match[2] as RoutineField | undefined
    addIssue(byIndex, Number(match[1]), {
      field: name && KNOWN_FIELDS.includes(name) ? name : undefined,
      message,
    })
  })
  if (errors.length === 0 && typeof body.message === 'string' && body.message.trim()) general.push(body.message.trim())
  return { byIndex, general }
}

export type MealHint = 'LUNCH' | 'DINNER'

/** 흔한 식사 시간대(로컬, 0시부터의 분): 점심 11:30–13:30, 저녁 18:00–19:30 */
const MEAL_WINDOWS: { kind: MealHint; start: number; end: number }[] = [
  { kind: 'LUNCH', start: 11 * 60 + 30, end: 13 * 60 + 30 },
  { kind: 'DINNER', start: 18 * 60, end: 19 * 60 + 30 },
]

/**
 * 블록(계획일 0시부터의 분, [start, end))이 흔한 식사 시간대에 걸리고 그 식사가 등록되지 않았으면 안내할 식사를 돌려준다.
 * 자정을 넘는 시간창을 위해 다음 날의 같은 시간대도 본다.
 */
export const mealHintFor = (startMinute: number, endMinute: number, registered: ReadonlySet<RoutineKind>): MealHint | null => {
  for (const window of MEAL_WINDOWS) {
    if (registered.has(window.kind)) continue
    const hit = [0, DAY_MINUTES].some((shift) => startMinute < window.end + shift && window.start + shift < endMinute)
    if (hit) return window.kind
  }
  return null
}

/**
 * "요일별로 다르게": 같은 종류에 항목을 하나 더 만들 때의 요일을 정한다.
 * 아직 안 쓴 요일이 있으면 그 요일을, 모두 쓰였으면 마지막 항목에서 주말을 떼어 새 항목에 준다
 * (예: 매일 수면 → 평일 수면 + 주말 수면). 뗄 수 없으면 빈 요일로 두어 사용자가 고르게 한다.
 */
export const splitDaysForNewEntry = (entryDays: DayOfWeek[][]): { lastDays: DayOfWeek[] | null; newDays: DayOfWeek[] } => {
  const used = new Set(entryDays.flat())
  const remaining = DAYS_OF_WEEK.filter((day) => !used.has(day))
  if (remaining.length > 0) return { lastDays: null, newDays: remaining }
  const last = entryDays[entryDays.length - 1] ?? []
  const weekend = last.filter((day) => WEEKEND_DAYS.includes(day))
  if (weekend.length > 0 && weekend.length < last.length) {
    return { lastDays: sortDays(last.filter((day) => !weekend.includes(day))), newDays: sortDays(weekend) }
  }
  return { lastDays: null, newDays: [] }
}

// ADR-0027 날짜 예외. 예외는 그 날짜에 시작하는 생활 시간 전체를 바꾼다. 항목 규칙은 주간과 같고 요일이 없으며,
// 그날 [시작, 시작 + 길이) 구간끼리 겹치면 안 된다(맞닿음은 허용). 앞뒤 날짜와는 보지 않는다.

export const MAX_OVERRIDE_NOTE_LENGTH = 20
export const OVERRIDE_PAST_DAYS = 1
export const OVERRIDE_FUTURE_DAYS = 365

export type OverrideItemDraft = Omit<RoutineDraft, 'days'>

const SUNDAY_FIRST: DayOfWeek[] = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY']

/** "YYYY-MM-DD"의 요일. 형식이 아니면 null */
export const dayOfWeekOf = (date: string): DayOfWeek | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match) return null
  const parsed = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  if (Number.isNaN(parsed.getTime()) || parsed.getUTCDate() !== Number(match[3])) return null
  return SUNDAY_FIRST[parsed.getUTCDay()]
}

/** "YYYY-MM-DD"에 days일을 더한다 */
export const addDays = (date: string, days: number): string => {
  const [year, month, day] = date.split('-').map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, day + days))
  return parsed.toISOString().slice(0, 10)
}

const byStart = (a: { startTime: string }, b: { startTime: string }) => a.startTime.localeCompare(b.startTime)

/** 예외를 새로 만들 때 채울 값: 그 날짜 요일의 주간 항목, 시작 순 */
export const overrideItemsFromWeekly = (date: string, weekly: RoutineDraft[], nextKey: () => string): OverrideItemDraft[] => {
  const day = dayOfWeekOf(date)
  if (!day) return []
  return weekly
    .filter((draft) => draft.days.includes(day))
    .map((draft) => ({
      key: nextKey(),
      kind: draft.kind,
      label: draft.label,
      startTime: draft.startTime,
      durationMinutes: draft.durationMinutes,
      remindAtStart: draft.remindAtStart,
    }))
    .sort(byStart)
}

export const toOverrideItemDraft = (item: RoutineOverrideItem | RoutineOverrideItemInput, key: string): OverrideItemDraft => ({
  key,
  kind: item.kind,
  label: item.label ?? '',
  startTime: item.startTime.slice(0, 5),
  durationMinutes: parseIsoDurationMinutes(item.duration),
  remindAtStart: item.remindAtStart === true,
})

export const toOverrideItemInput = (draft: OverrideItemDraft): RoutineOverrideItemInput => ({
  kind: draft.kind,
  label: draft.label.trim() ? draft.label.trim() : null,
  startTime: draft.startTime,
  duration: minutesToIsoDuration(draft.durationMinutes ?? 0),
  remindAtStart: draft.remindAtStart,
})

export const validateOverrideItems = (drafts: OverrideItemDraft[], note = ''): RoutineValidation => {
  const { byIndex, general } = validateRoutineDrafts(drafts.map((draft) => ({ ...draft, days: ['MONDAY'] as DayOfWeek[] })))
  // 위 검사는 한 주 순환 겹침도 보지만 모두 같은 요일이라 그날 겹침과 같다. 자정을 넘는 항목끼리만 다를 수 있어 다시 계산한다.
  Object.values(byIndex).forEach((issues) => {
    for (let i = issues.length - 1; i >= 0; i -= 1) if (!issues[i].field) issues.splice(i, 1)
  })
  const spans = drafts.map((draft) => {
    const start = parseClock(draft.startTime)
    return start === null || draft.durationMinutes === null ? null : { start, end: start + draft.durationMinutes }
  })
  for (let i = 0; i < drafts.length; i += 1) {
    for (let j = i + 1; j < drafts.length; j += 1) {
      const a = spans[i]
      const b = spans[j]
      if (!a || !b || !(a.start < b.end && b.start < a.end)) continue
      addIssue(byIndex, i, { message: `"${routineName(drafts[j])}"과 시간이 겹쳐요.` })
      addIssue(byIndex, j, { message: `"${routineName(drafts[i])}"과 시간이 겹쳐요.` })
    }
  }
  Object.keys(byIndex).forEach((index) => {
    if (byIndex[Number(index)].length === 0) delete byIndex[Number(index)]
  })
  if (note.trim().length > MAX_OVERRIDE_NOTE_LENGTH) general.push(`메모는 ${MAX_OVERRIDE_NOTE_LENGTH}자 이하로 입력하세요.`)
  return { byIndex, general: general.map((message) => message.replace('생활 시간은', '하루 생활 시간은')) }
}

/** 오늘(회원 로컬 "YYYY-MM-DD") 기준으로 저장할 수 있는 날짜인가 */
export const isEditableOverrideDate = (date: string, today: string) =>
  dayOfWeekOf(date) !== null && date >= addDays(today, -OVERRIDE_PAST_DAYS) && date <= addDays(today, OVERRIDE_FUTURE_DAYS)
