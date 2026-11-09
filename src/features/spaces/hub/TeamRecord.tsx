import type { CSSProperties } from 'react'
import { formatIsoDurationLabel, formatMinutesLabel } from '@shared/utils/isoDuration'
import TimeBars from '../TimeBars'
import { dayBars, recordRows, weekRange } from '../hub'
import type { Project, Space, WeeklyRecord } from '../types'

/** 이번 주 팀 기록(ADR-0030 §5). 숫자는 응답 그대로 쓴다. */
export default function TeamRecord({
  space,
  projects,
  meId,
  record,
  failed,
  onRetry,
  today,
}: {
  space: Space
  projects: Project[]
  meId: number | null
  record: WeeklyRecord | null
  failed: boolean
  onRetry: () => void
  today: string
}) {
  const head = (
    <div className="hub-section__head">
      <h3 id="hub-record-title">이번 주 팀 기록</h3>
      {record && <span className="hub-quiet-inline">{weekRange(record)}</span>}
    </div>
  )
  let body
  if (failed)
    body = (
      <p className="hub-load-error" role="alert">
        팀 기록을 불러오지 못했어요.{' '}
        <button type="button" className="space-text-button" onClick={onRetry}>
          다시 시도
        </button>
      </p>
    )
  else if (!record)
    body = (
      <p className="hub-quiet hub-record__loading">팀 기록을 불러오는 중…</p>
    )
  else if (record.completedCount === 0)
    body = <p className="hub-empty">이번 주에 완료한 일정이 아직 없어요.</p>
  else {
    const bars = dayBars(record.days, today)
    const projectNames = new Map(projects.map((project) => [project.id, project.name]))
    const memberNames = new Map(
      space.members.map((member) => [
        member.memberId,
        member.memberId === meId ? '나' : member.nickname,
      ]),
    )
    if (meId !== null) memberNames.set(meId, '나')
    // The body mounts once per space and week, when its record arrives; a refetch keeps it.
    // Keyed by space and week so a cached record for another space never glides its bars
    // from this one's lengths: it arrives as its own record.
    body = (
      <div className="hub-record__body" key={`${record.spaceId}:${record.start}`}>
        <p className="hub-record__total">
          완료한 일정 {record.completedCount}개,{' '}
          {formatIsoDurationLabel(record.elapsed) ?? '–'}
        </p>
        <div
          className="hub-days"
          role="img"
          aria-label={bars
            .map((bar) => {
              const [, month, day] = bar.date.split('-')
              return `${Number(month)}/${Number(day)} ${formatMinutesLabel(bar.minutes)}`
            })
            .join(', ')}
        >
          {bars.map((bar, index) => (
            <span
              key={bar.date}
              className={`hub-day${bar.today ? ' is-today' : ''}`}
              style={{ '--hub-day-index': index } as CSSProperties}
            >
              <i style={{ height: `${bar.height}px` }} />
              <small>{bar.label}</small>
            </span>
          ))}
        </div>
        <div className="hub-record__split">
          <div>
            <h4>프로젝트별</h4>
            <TimeBars
              rows={recordRows(
                record.byProject.map((row) => ({ id: row.projectId, elapsed: row.elapsed })),
                projectNames,
                '삭제된 프로젝트',
                '프로젝트 없음',
              )}
            />
          </div>
          <div>
            <h4>실행한 사람별</h4>
            <TimeBars
              rows={recordRows(
                record.byRunner.map((row) => ({ id: row.memberId, elapsed: row.elapsed })),
                memberNames,
                '이전 참여자',
                '',
              )}
            />
          </div>
        </div>
        <p className="hub-quiet">
          완료한 일정의 실제 실행 시간 기준이에요. 사람별 시간은 일정을 실제로
          실행한 사람으로 나눠요.
        </p>
      </div>
    )
  }
  return (
    <section
      className="hub-section hub-record"
      aria-labelledby="hub-record-title"
    >
      {head}
      {body}
    </section>
  )
}
