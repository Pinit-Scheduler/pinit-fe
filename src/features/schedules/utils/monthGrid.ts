import type dayjs from 'dayjs'

// 월간 달력은 월요일 시작 주로 채운다(주간 띠·주간 API와 같은 기준).

/** 그 달 1일이 든 주의 월요일. */
export const monthGridStart = (month: dayjs.Dayjs) => {
  const first = month.startOf('month').startOf('day')
  const sinceMonday = (first.day() + 6) % 7
  return first.subtract(sinceMonday, 'day')
}

/** 달력 칸에 들어갈 주의 월요일들(4~6개). 주간 API를 주마다 한 번씩 부른다. */
export const monthWeekStarts = (month: dayjs.Dayjs) => {
  const start = monthGridStart(month)
  const last = month.endOf('month').startOf('day')
  const weeks: dayjs.Dayjs[] = []
  for (let week = start; !week.isAfter(last); week = week.add(7, 'day')) weeks.push(week)
  return weeks
}

/** 달력 칸의 날짜들(주 수 × 7). */
export const monthGridDays = (month: dayjs.Dayjs) =>
  monthWeekStarts(month).flatMap((week) => Array.from({ length: 7 }, (_, index) => week.add(index, 'day')))

export type DaySummary = { total: number; completed: number }

/** 날짜 키(YYYY-MM-DD)별 일정 수와 완료 수. 같은 id는 한 번만 센다(주 경계에서 겹쳐 받는 경우). */
export const summarizeByDate = <T extends { id: number; state: string }>(items: T[], dateKeyOf: (item: T) => string) => {
  const seen = new Set<number>()
  const summary: Record<string, DaySummary> = {}
  for (const item of items) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    const key = dateKeyOf(item)
    const day = (summary[key] ??= { total: 0, completed: 0 })
    day.total += 1
    if (item.state === 'COMPLETED') day.completed += 1
  }
  return summary
}

export const describeDay = (label: string, summary: DaySummary | undefined) => {
  if (!summary || summary.total === 0) return `${label}, 일정 없음`
  const open = summary.total - summary.completed
  return open > 0 ? `${label}, 일정 ${summary.total}개, 남은 일정 ${open}개` : `${label}, 일정 ${summary.total}개 모두 완료`
}
