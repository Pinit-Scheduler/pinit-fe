import SpaceMark from '@features/spaces/SpaceMark'
import TimeBars from '@features/spaces/TimeBars'
import { useSpaces } from '@features/spaces/store'
import type { SpaceTime } from '../types/report'
import { spaceTimeRows } from '../utils/spaceTime'

const monthDay = (date: string) => {
  const [, month, day] = date.split('-')
  return `${Number(month)}/${Number(day)}`
}
const dayBefore = (date: string) => {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10)
}

/** 통계의 "스페이스별 내 완료 시간". bySpace가 없는 응답(이전 BE)에서는 그리지 않는다. */
export default function SpaceTimeSection({
  bySpace,
  start,
  end,
}: {
  bySpace: SpaceTime[] | undefined
  start: string
  /** 기간 다음 날(포함하지 않음) */
  end: string
}) {
  const { spaces, projects } = useSpaces()
  if (!bySpace) return null
  const rows = spaceTimeRows(bySpace, spaces, projects).map((row) => {
    const space =
      row.spaceId === null
        ? null
        : (spaces.find((item) => item.id === row.spaceId) ?? null)
    return {
      ...row,
      mark: row.child ? undefined : <SpaceMark space={space} />,
    }
  })
  return (
    <section className="report-section space-time" aria-labelledby="space-time-title">
      <div className="report-section__head">
        <h2 id="space-time-title">스페이스별 내 완료 시간</h2>
        <p className="report-section__hint report-datum">
          {monthDay(start)}–{monthDay(dayBefore(end))}, 내가 실행해 완료한 일정의
          실제 실행 시간 기준
        </p>
      </div>
      <div className="report-datum">
        {rows.length ? (
          <TimeBars rows={rows} />
        ) : (
          <p className="report-section__hint">이 기간에 내가 완료한 일정이 없어요.</p>
        )}
      </div>
    </section>
  )
}
