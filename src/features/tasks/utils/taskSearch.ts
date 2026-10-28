/**
 * 작업 탭 검색·필터·정렬(ADR-0023 §3·§4). 화면 상태를 `/v2/tasks/search` 인자로 바꾸는 순수 함수만 둔다.
 */

export type TaskStatusFilter = 'CURRENT' | 'ALL' | 'OPEN' | 'READY' | 'BLOCKED' | 'COMPLETED'
export type TaskSortOrder =
  | 'DEADLINE_ASC'
  | 'DEADLINE_DESC'
  | 'IMPORTANCE_DESC'
  | 'DIFFICULTY_ASC'
  | 'DIFFICULTY_DESC'
  | 'CREATED_DESC'
  | 'TITLE_ASC'
export type DeadlinePreset = 'ANY' | 'OVERDUE' | 'TODAY' | 'THIS_WEEK' | 'CUSTOM'

export type TaskFilters = {
  query: string
  status: TaskStatusFilter
  deadline: DeadlinePreset
  /** deadline이 CUSTOM일 때만 쓴다. YYYY-MM-DD, 비우면 그쪽 끝은 열려 있다 */
  deadlineFrom: string
  deadlineTo: string
  importanceMin: number | null
  difficultyMax: number | null
  tagIds: number[]
  sort: TaskSortOrder
}

export const STATUS_OPTIONS: { value: TaskStatusFilter; label: string }[] = [
  { value: 'CURRENT', label: '진행 중' },
  { value: 'ALL', label: '전체' },
  { value: 'OPEN', label: '미완료' },
  { value: 'READY', label: '준비됨' },
  { value: 'BLOCKED', label: '막힘' },
  { value: 'COMPLETED', label: '완료' },
]

export const DEADLINE_OPTIONS: { value: DeadlinePreset; label: string }[] = [
  { value: 'ANY', label: '전체' },
  { value: 'OVERDUE', label: '지난 마감' },
  { value: 'TODAY', label: '오늘' },
  { value: 'THIS_WEEK', label: '이번 주' },
  { value: 'CUSTOM', label: '직접' },
]

export const SORT_OPTIONS: { value: TaskSortOrder; label: string }[] = [
  { value: 'DEADLINE_ASC', label: '마감 빠른 순' },
  { value: 'DEADLINE_DESC', label: '마감 늦은 순' },
  { value: 'IMPORTANCE_DESC', label: '중요도 높은 순' },
  { value: 'DIFFICULTY_ASC', label: '난이도 낮은 순' },
  { value: 'DIFFICULTY_DESC', label: '난이도 높은 순' },
  { value: 'CREATED_DESC', label: '최근 만든 순' },
  { value: 'TITLE_ASC', label: '제목 가나다순' },
]

export const MAX_QUERY_LENGTH = 50

export const DEFAULT_FILTERS: TaskFilters = {
  query: '',
  status: 'CURRENT',
  deadline: 'ANY',
  deadlineFrom: '',
  deadlineTo: '',
  importanceMin: null,
  difficultyMax: null,
  tagIds: [],
  sort: 'DEADLINE_ASC',
}

const pad = (value: number) => String(value).padStart(2, '0')

/** YYYY-MM-DD 날짜에 일 수를 더한다. 시간대와 무관한 달력 계산이다. */
export const addDaysToDateKey = (dateKey: string, days: number) => {
  const [year, month, day] = dateKey.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + days))
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

/** 그 날짜가 속한 주(월요일 시작)의 월요일과 일요일. */
export const weekRangeOf = (dateKey: string) => {
  const [year, month, day] = dateKey.split('-').map(Number)
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay() // 0=일
  const sinceMonday = (weekday + 6) % 7
  const monday = addDaysToDateKey(dateKey, -sinceMonday)
  return { from: monday, to: addDaysToDateKey(monday, 6) }
}

/**
 * 필터를 검색 인자로 바꾼다. `today`는 회원 시간대의 오늘(YYYY-MM-DD)이다.
 * 지난 마감은 어제까지 마감인 미완료 작업이므로 상태를 OPEN으로 좁힌다(상태를 직접 고른 경우는 그대로).
 */
export const toSearchParams = (filters: TaskFilters, today: string): [string, string][] => {
  const params: [string, string][] = []
  const query = filters.query.trim().slice(0, MAX_QUERY_LENGTH)
  if (query) params.push(['q', query])
  let status = filters.status
  let from = ''
  let to = ''
  switch (filters.deadline) {
    case 'OVERDUE':
      to = addDaysToDateKey(today, -1)
      if (status === 'CURRENT') status = 'OPEN'
      break
    case 'TODAY':
      from = today
      to = today
      break
    case 'THIS_WEEK': {
      const week = weekRangeOf(today)
      from = week.from
      to = week.to
      break
    }
    case 'CUSTOM':
      from = filters.deadlineFrom
      to = filters.deadlineTo
      if (from && to && from > to) [from, to] = [to, from]
      break
    default:
      break
  }
  if (status !== 'CURRENT') params.push(['status', status])
  if (from) params.push(['deadlineFrom', from])
  if (to) params.push(['deadlineTo', to])
  if (filters.importanceMin != null && filters.importanceMin > 1) params.push(['importanceMin', String(filters.importanceMin)])
  if (filters.difficultyMax != null && filters.difficultyMax < 21) params.push(['difficultyMax', String(filters.difficultyMax)])
  filters.tagIds.forEach((id) => params.push(['tagIds', String(id)]))
  if (filters.sort !== 'DEADLINE_ASC') params.push(['sort', filters.sort])
  return params
}

/** 필터 버튼에 보여 줄 "적용 중인 조건" 수. 검색어와 정렬은 세지 않는다. */
export const activeFilterCount = (filters: TaskFilters) => {
  let count = 0
  if (filters.status !== DEFAULT_FILTERS.status) count += 1
  if (filters.deadline !== 'ANY' && (filters.deadline !== 'CUSTOM' || filters.deadlineFrom || filters.deadlineTo)) count += 1
  if (filters.importanceMin != null && filters.importanceMin > 1) count += 1
  if (filters.difficultyMax != null && filters.difficultyMax < 21) count += 1
  if (filters.tagIds.length > 0) count += 1
  return count
}

export const isDefaultFilters = (filters: TaskFilters) =>
  !filters.query.trim() && activeFilterCount(filters) === 0 && filters.sort === DEFAULT_FILTERS.sort

/** sessionStorage에서 읽은 값을 검증해 되살린다. 모양이 틀리면 기본값이다. */
export const restoreFilters = (raw: string | null): TaskFilters => {
  if (!raw) return { ...DEFAULT_FILTERS }
  try {
    const parsed = JSON.parse(raw) as Partial<TaskFilters>
    const pick = <T extends string>(value: unknown, allowed: { value: T }[], fallback: T): T =>
      allowed.some((option) => option.value === value) ? (value as T) : fallback
    const numberOrNull = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null)
    const dateOrEmpty = (value: unknown) => (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '')
    return {
      query: typeof parsed.query === 'string' ? parsed.query.slice(0, MAX_QUERY_LENGTH) : '',
      status: pick(parsed.status, STATUS_OPTIONS, DEFAULT_FILTERS.status),
      deadline: pick(parsed.deadline, DEADLINE_OPTIONS, DEFAULT_FILTERS.deadline),
      deadlineFrom: dateOrEmpty(parsed.deadlineFrom),
      deadlineTo: dateOrEmpty(parsed.deadlineTo),
      importanceMin: numberOrNull(parsed.importanceMin),
      difficultyMax: numberOrNull(parsed.difficultyMax),
      tagIds: Array.isArray(parsed.tagIds) ? parsed.tagIds.filter((id): id is number => Number.isInteger(id)) : [],
      sort: pick(parsed.sort, SORT_OPTIONS, DEFAULT_FILTERS.sort),
    }
  } catch {
    return { ...DEFAULT_FILTERS }
  }
}

/** 이미 받은 목록 뒤에 새 페이지를 붙인다. 페이지 사이에 작업이 바뀌어 겹친 항목은 한 번만 남긴다. */
export const mergePage = <T extends { id: number }>(previous: T[], incoming: T[]) => {
  const seen = new Set(previous.map((item) => item.id))
  const merged = [...previous]
  incoming.forEach((item) => {
    if (!seen.has(item.id)) {
      merged.push(item)
      seen.add(item.id)
    }
  })
  return merged
}
