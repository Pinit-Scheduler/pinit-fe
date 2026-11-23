// 달력 날짜 키(YYYY-MM-DD) 계산. 시간대와 무관하고 의존성이 없어 node 테스트에서 그대로 불러 쓴다.

const pad = (value: number) => String(value).padStart(2, '0')

const parts = (dateKey: string) => dateKey.split('-').map(Number) as [number, number, number]

const toKey = (date: Date) =>
  `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`

/** YYYY-MM-DD 날짜에 일 수를 더한다. */
export const addDaysToDateKey = (dateKey: string, days: number) => {
  const [year, month, day] = parts(dateKey)
  return toKey(new Date(Date.UTC(year, month - 1, day + days)))
}

/** 0=일 … 6=토 */
export const weekdayOf = (dateKey: string) => {
  const [year, month, day] = parts(dateKey)
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay()
}

/** 그 날짜가 속한 주의 월요일. 웹의 주간 보기와 같이 월요일에 시작한다. */
export const weekStartOf = (dateKey: string) =>
  addDaysToDateKey(dateKey, -((weekdayOf(dateKey) + 6) % 7))

/** 월요일부터 일요일까지 7일. */
export const weekDaysOf = (dateKey: string) => {
  const monday = weekStartOf(dateKey)
  return Array.from({ length: 7 }, (_, index) => addDaysToDateKey(monday, index))
}

const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토']

export const weekdayLabel = (dateKey: string) => WEEKDAY_LABELS[weekdayOf(dateKey)]

/** "11월 23일 (월)" */
export const formatMonthDay = (dateKey: string) => {
  const [, month, day] = parts(dateKey)
  return `${month}월 ${day}일 (${weekdayLabel(dateKey)})`
}

/** "2026년 11월 23일 월요일" */
export const formatFullDate = (dateKey: string) => {
  const [year, month, day] = parts(dateKey)
  return `${year}년 ${month}월 ${day}일 ${weekdayLabel(dateKey)}요일`
}

/** 작업 마감일 라벨 "11/23". 마감은 순간이 아니라 달력 날짜라 시간대 변환을 하지 않는다. */
export const formatDueLabel = (dateKey: string) => {
  const [, month, day] = parts(dateKey)
  return `${month}/${day}`
}

export const dayOfMonth = (dateKey: string) => parts(dateKey)[2]
