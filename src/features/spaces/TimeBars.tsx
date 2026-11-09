import type { CSSProperties, ReactNode } from 'react'
import { formatMinutesLabel } from '@shared/utils/isoDuration'
import './TimeBars.css'

export type TimeBarRow = {
  key: string
  name: string
  minutes: number
  child?: boolean
  mark?: ReactNode
}

/**
 * 중립 회색 가로 막대. 너비는 가장 긴 행 기준이다(값은 서버가 준 시간 그대로).
 * 막대는 처음에 왼쪽에서 자라고, 값이 바뀌면 새 길이로 미끄러진다(transform만 움직인다).
 */
export default function TimeBars({ rows }: { rows: TimeBarRow[] }) {
  const longest = Math.max(1, ...rows.map((row) => row.minutes))
  return (
    <div className="time-bars">
      {rows.map((row) => (
        <div
          key={row.key}
          className={`time-bars__row${row.child ? ' is-child' : ''}`}
        >
          <span className="time-bars__label">
            {row.mark}
            <span>{row.name}</span>
          </span>
          <span className="time-bars__track" aria-hidden>
            <i
              style={
                {
                  '--time-bar-scale': Math.round((row.minutes / longest) * 100) / 100,
                } as CSSProperties
              }
            />
          </span>
          <strong>{formatMinutesLabel(row.minutes)}</strong>
        </div>
      ))}
    </div>
  )
}
