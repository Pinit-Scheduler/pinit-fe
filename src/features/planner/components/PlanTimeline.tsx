import dayjs from 'dayjs'
import './PlanTimeline.css'

export type PlanTimelineItem = {
  key: string
  /** routine: ADR-0016 생활 시간. 두 줄 뒤에 전체 폭의 띠로 그린다 */
  kind: 'schedule' | 'block' | 'routine'
  title: string
  startMs: number
  endMs: number
  /** 블록: 승인 대상으로 선택했는지 */
  selected?: boolean
  /** 블록: 승인 전 확인할 문제가 있는지 */
  hasIssue?: boolean
}

type PlanTimelineProps = {
  zoneId: string
  items: PlanTimelineItem[]
  /** 제안 시간창 [start, end) */
  windowStartMs: number
  windowEndMs: number
  onSelectBlock?: (key: string) => void
}

const PX_PER_MINUTE = 0.75
const MIN_ITEM_HEIGHT = 18
const HOUR_MS = 60 * 60 * 1000

const toZoned = (ms: number, zoneId: string) => dayjs(ms).tz(zoneId)

/**
 * 하루 계획 타임라인. 왼쪽 줄은 이미 있는 일정, 오른쪽 줄은 제안 블록이고, 생활 시간은 그 뒤의 띠다.
 * 배치를 계산하지 않고, 받은 구간을 그대로 그린다.
 */
const PlanTimeline = ({ zoneId, items, windowStartMs, windowEndMs, onSelectBlock }: PlanTimelineProps) => {
  const starts = [windowStartMs, ...items.map((item) => item.startMs)]
  const ends = [windowEndMs, ...items.map((item) => item.endMs)]
  const rangeStart = toZoned(Math.min(...starts), zoneId).startOf('hour').valueOf()
  const rawEnd = Math.max(...ends)
  const rangeEnd = Math.max(rangeStart + HOUR_MS, Math.ceil((rawEnd - rangeStart) / HOUR_MS) * HOUR_MS + rangeStart)
  const toPx = (ms: number) => ((ms - rangeStart) / 60000) * PX_PER_MINUTE
  const height = toPx(rangeEnd)

  const hours: number[] = []
  for (let at = rangeStart; at <= rangeEnd; at += HOUR_MS) hours.push(at)

  const formatTime = (ms: number) => toZoned(ms, zoneId).format('HH:mm')

  return (
    <div className="plan-timeline" aria-label="하루 계획 타임라인">
      <div className="plan-timeline__legend" aria-hidden>
        <span className="plan-timeline__legend-item plan-timeline__legend-item--schedule">기존 일정</span>
        <span className="plan-timeline__legend-item plan-timeline__legend-item--block">제안 블록</span>
        {items.some((item) => item.kind === 'routine') && (
          <span className="plan-timeline__legend-item plan-timeline__legend-item--routine">생활 시간</span>
        )}
      </div>
      <div className="plan-timeline__grid" style={{ height }}>
        {hours.map((at) => (
          <div key={at} className="plan-timeline__hour" style={{ top: toPx(at) }}>
            <span>{formatTime(at)}</span>
          </div>
        ))}
        {windowEndMs > windowStartMs && (
          <div
            className="plan-timeline__window"
            style={{ top: toPx(windowStartMs), height: toPx(windowEndMs) - toPx(windowStartMs) }}
            title={`배치 가능 시간 ${formatTime(windowStartMs)}–${formatTime(windowEndMs)}`}
          />
        )}
        {items
          .filter((item) => item.kind === 'routine')
          .map((item) => {
            const top = toPx(item.startMs)
            const label = `${item.title} ${formatTime(item.startMs)}–${formatTime(item.endMs)}`
            return (
              <div
                key={item.key}
                className="plan-timeline__routine"
                style={{ top, height: Math.max(MIN_ITEM_HEIGHT, toPx(item.endMs) - top) }}
                title={label}
                aria-label={`생활 시간 ${label}`}
              >
                <span>{item.title}</span>
              </div>
            )
          })}
        {items.filter((item) => item.kind !== 'routine').map((item) => {
          const top = toPx(item.startMs)
          const itemHeight = Math.max(MIN_ITEM_HEIGHT, toPx(item.endMs) - top)
          const className = [
            'plan-timeline__item',
            `plan-timeline__item--${item.kind}`,
            item.kind === 'block' && !item.selected ? 'is-unselected' : '',
            item.hasIssue ? 'has-issue' : '',
          ]
            .filter(Boolean)
            .join(' ')
          const label = `${item.title} ${formatTime(item.startMs)}–${formatTime(item.endMs)}`
          if (item.kind === 'block' && onSelectBlock) {
            return (
              <button
                key={item.key}
                type="button"
                className={className}
                style={{ top, height: itemHeight }}
                onClick={() => onSelectBlock(item.key)}
                title={label}
                aria-label={label}
              >
                <span className="plan-timeline__item-title">{item.title}</span>
                <span className="plan-timeline__item-time">
                  {formatTime(item.startMs)}–{formatTime(item.endMs)}
                </span>
              </button>
            )
          }
          return (
            <div key={item.key} className={className} style={{ top, height: itemHeight }} title={label}>
              <span className="plan-timeline__item-title">{item.title}</span>
              <span className="plan-timeline__item-time">
                {formatTime(item.startMs)}–{formatTime(item.endMs)}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default PlanTimeline
