import { parseIsoDurationMinutes } from '@shared/utils/isoDuration'
import type {
  Project,
  Space,
  SpaceMember,
  SpaceSummaries,
  SpaceSummary,
  TaskStateCounts,
  WeeklyRecord,
} from './types'

/**
 * 스페이스 허브의 화면 줄 규칙. 숫자는 BE 요약(ADR-0030)을 그대로 쓰고
 * 여기서 작업을 세거나 응답 숫자를 다시 합치지 않는다.
 */

export type Dot = 'done' | 'running' | 'todo' | 'unassigned'
export type DotView =
  | { kind: 'dots'; dots: Dot[] }
  | { kind: 'bar'; segments: { state: Dot; count: number }[] }

const DOT_LIMIT = 20

const stateCounts = (counts: TaskStateCounts): [Dot, number][] => [
  ['done', counts.completed],
  ['running', counts.running],
  ['todo', counts.open],
  ['unassigned', counts.unassigned],
]

/** 작업 하나를 점 하나로, 20개를 넘으면 상태별 막대로 그린다(시안 hubDotsV18). */
export const taskDots = (counts: TaskStateCounts): DotView => {
  const states = stateCounts(counts)
  if (counts.total > DOT_LIMIT)
    return {
      kind: 'bar',
      segments: states
        .filter(([, count]) => count > 0)
        .map(([state, count]) => ({ state, count })),
    }
  return {
    kind: 'dots',
    dots: states.flatMap(([state, count]) =>
      Array.from({ length: Math.max(0, count) }, () => state),
    ),
  }
}

export const countsLabel = (counts: TaskStateCounts): string => {
  if (counts.total === 0) return '작업 없음'
  const parts = [`작업 ${counts.total}개 중 ${counts.completed}개 완료`]
  if (counts.running) parts.push(`진행 중 ${counts.running}개`)
  if (counts.unassigned) parts.push(`담당자 미정 ${counts.unassigned}개`)
  return parts.join(', ')
}

const monthDay = (date: string): string => {
  const [, month, day] = date.split('-')
  return `${Number(month)}/${Number(day)}`
}

export const dueLabel = (date: string | null): string =>
  date ? `${monthDay(date)} 마감` : ''

export const railLine = (
  space: Pick<Space, 'personal'>,
  row: SpaceSummaries['spaces'][number] | undefined,
): { who: string; open: string } => {
  if (!row) return { who: space.personal ? '본인 전용' : '', open: '–' }
  const who = space.personal
    ? '본인 전용'
    : row.memberCount > 1
      ? `${row.memberCount}명`
      : '혼자'
  return {
    who:
      row.unassignedOpenCount > 0
        ? `${who} · 담당자 미정 ${row.unassignedOpenCount}`
        : who,
    open: String(row.openTaskCount),
  }
}

export type ProjectRow = {
  project: Project
  counts: TaskStateCounts | null
  nearestDueDate: string | null
}

/** 그 스페이스의 삭제되지 않은 프로젝트. 요약에 아직 없는 프로젝트는 숫자 없이 둔다. */
export const projectRows = (
  projects: Project[],
  spaceId: number,
  summary: Pick<SpaceSummary, 'projects'> | null,
): ProjectRow[] =>
  projects
    .filter((project) => project.spaceId === spaceId && !project.deleted)
    .map((project) => {
      const row = summary?.projects.find(
        (item) => item.projectId === project.id,
      )
      return {
        project,
        counts: row?.counts ?? null,
        nearestDueDate: row?.nearestDueDate ?? null,
      }
    })

export type MemberRow = {
  memberId: number
  name: string
  admin: boolean
  me: boolean
  openAssignedCount: number | null
  nearestDueDate: string | null
}

export const memberRows = (
  members: SpaceMember[],
  meId: number | null,
  summary: Pick<SpaceSummary, 'members'> | null,
): MemberRow[] =>
  members.map((member) => {
    const row = summary?.members.find(
      (item) => item.memberId === member.memberId,
    )
    const me = member.memberId === meId
    return {
      memberId: member.memberId,
      name: me ? '나' : member.nickname,
      admin: member.role === 'ADMIN',
      me,
      openAssignedCount: row?.openAssignedCount ?? null,
      nearestDueDate: row?.nearestDueDate ?? null,
    }
  })

export type RecordRow = { key: string; name: string; minutes: number }

/** 서버 순서를 그대로 둔다. 이름이 없는 ID(나간 참여자 등)는 합치지 않고 한 줄씩 남긴다. */
export const recordRows = (
  entries: { id: number | null; elapsed: string }[],
  names: Map<number, string>,
  missing: string,
  nullName: string,
): RecordRow[] =>
  entries.map((entry, index) => ({
    key: `${index}:${entry.id}`,
    name:
      entry.id === null ? nullName : (names.get(entry.id) ?? missing),
    minutes: parseIsoDurationMinutes(entry.elapsed) ?? 0,
  }))

/** end는 다음 월요일이라 하루 전까지 쓴다. */
export const weekRange = (
  record: Pick<WeeklyRecord, 'start' | 'end'>,
): string => {
  const [year, month, day] = record.end.split('-').map(Number)
  const last = new Date(Date.UTC(year, month - 1, day - 1))
  return `${monthDay(record.start)}–${last.getUTCMonth() + 1}/${last.getUTCDate()}`
}

const WEEKDAYS = ['월', '화', '수', '목', '금', '토', '일']
const DAY_BAR_MAX = 48

export type DayBar = {
  date: string
  label: string
  minutes: number
  height: number
  today: boolean
}

/** 요일 막대 7개. 높이는 가장 긴 날 기준(시안 hubTeamRecordV18). */
export const dayBars = (
  days: WeeklyRecord['days'],
  today: string,
): DayBar[] => {
  const minutes = days.map((day) => parseIsoDurationMinutes(day.elapsed) ?? 0)
  const longest = Math.max(1, ...minutes)
  return days.map((day, index) => ({
    date: day.date,
    label: WEEKDAYS[index] ?? '',
    minutes: minutes[index],
    height: minutes[index]
      ? Math.max(8, Math.round((minutes[index] / longest) * DAY_BAR_MAX))
      : 2,
    today: day.date === today,
  }))
}
