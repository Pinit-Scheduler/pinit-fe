import { useMemo } from 'react'
import type { KeyboardEvent } from 'react'
import type dayjs from 'dayjs'
import { toDateKey } from '@shared/utils/datetime'
import { describeDay, monthGridDays, type DaySummary } from '../utils/monthGrid'
import './MonthCalendar.css'

type MonthCalendarProps = {
  month: dayjs.Dayjs
  selectedDate: dayjs.Dayjs
  todayKey: string
  summaryByDate: Record<string, DaySummary>
  isLoading: boolean
  error: string | null
  onSelectDate: (date: dayjs.Dayjs) => void
  onChangeMonth: (offset: 1 | -1) => void
}

const WEEKDAY_LABELS = ['월', '화', '수', '목', '금', '토', '일']
const KEY_OFFSETS: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }

/**
 * 월간 달력. 날짜마다 일정 수와 남은 일정 표시를 보여 주고, 누르면 그 날짜를 고른다.
 * 화살표 키로 날짜를 옮길 수 있다(그리드의 선택 칸만 Tab 순서에 든다).
 */
const MonthCalendar = ({
  month,
  selectedDate,
  todayKey,
  summaryByDate,
  isLoading,
  error,
  onSelectDate,
  onChangeMonth,
}: MonthCalendarProps) => {
  const days = useMemo(() => monthGridDays(month), [month])
  const selectedKey = toDateKey(selectedDate)
  const selectedInGrid = days.some((day) => toDateKey(day) === selectedKey)

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, day: dayjs.Dayjs) => {
    const offset = KEY_OFFSETS[event.key]
    if (!offset) return
    event.preventDefault()
    const next = day.add(offset, 'day')
    onSelectDate(next)
    const grid = event.currentTarget.closest('.month-calendar__grid')
    // 다음 렌더 뒤에 새 선택 칸으로 포커스를 옮긴다.
    window.requestAnimationFrame(() => {
      grid?.querySelector<HTMLButtonElement>(`[data-date="${toDateKey(next)}"]`)?.focus()
    })
  }

  return (
    <div className="month-calendar">
      <div className="month-calendar__nav">
        <button type="button" className="month-calendar__nav-btn" onClick={() => onChangeMonth(-1)} aria-label="이전 달">
          ‹
        </button>
        <h3 className="month-calendar__title" aria-live="polite">
          {month.format('YYYY년 M월')}
        </h3>
        <button type="button" className="month-calendar__nav-btn" onClick={() => onChangeMonth(1)} aria-label="다음 달">
          ›
        </button>
      </div>
      <div className="month-calendar__weekdays" aria-hidden>
        {WEEKDAY_LABELS.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
      <div className="month-calendar__grid" role="group" aria-label={`${month.format('YYYY년 M월')} 날짜 선택`} aria-busy={isLoading}>
        {days.map((day, index) => {
          const key = toDateKey(day)
          const summary = summaryByDate[key]
          const isSelected = key === selectedKey
          const isOutside = day.month() !== month.month()
          const open = summary ? summary.total - summary.completed : 0
          const focusable = isSelected || (!selectedInGrid && index === 0)
          return (
            <button
              key={key}
              type="button"
              data-date={key}
              tabIndex={focusable ? 0 : -1}
              className={[
                'month-calendar__day',
                isSelected && 'is-selected',
                isOutside && 'is-outside',
                key === todayKey && 'is-today',
              ]
                .filter(Boolean)
                .join(' ')}
              aria-pressed={isSelected}
              aria-label={describeDay(day.format('M월 D일 dddd'), summary)}
              onClick={() => onSelectDate(day)}
              onKeyDown={(event) => handleKeyDown(event, day)}
            >
              <span className="month-calendar__date">{day.format('D')}</span>
              {summary && summary.total > 0 && (
                <span className={['month-calendar__count', open === 0 && 'is-done'].filter(Boolean).join(' ')} aria-hidden>
                  {summary.total}
                </span>
              )}
            </button>
          )
        })}
      </div>
      {error && (
        <p className="month-calendar__error" role="alert">
          일정 수를 불러오지 못했어요. 날짜는 고를 수 있어요.
        </p>
      )}
    </div>
  )
}

export default MonthCalendar
