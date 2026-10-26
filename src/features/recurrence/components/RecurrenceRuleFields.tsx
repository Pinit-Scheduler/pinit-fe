import type { RecurrenceFrequency } from '../types/recurrence'
import {
  DAY_SHORT,
  FREQ_LABEL,
  MAX_COUNT,
  MAX_INTERVAL,
  WEEK_DAYS,
  describeRule,
  sortDays,
  toRule,
  type RecurrenceEnd,
  type RuleDraft,
  type RuleDraftField,
} from '../utils/recurrenceRules'
import './RecurrenceRuleFields.css'

type RecurrenceRuleFieldsProps = {
  draft: RuleDraft
  onChange: (next: RuleDraft) => void
  errors?: Partial<Record<RuleDraftField, string>>
  /** 시작일을 폼의 다른 칸(일정 시작 시각, 작업 마감일)이 정하면 숨긴다 */
  hideStartDate?: boolean
}

const FREQS: RecurrenceFrequency[] = ['DAILY', 'WEEKLY', 'MONTHLY']
const UNIT: Record<RecurrenceFrequency, string> = { DAILY: '일', WEEKLY: '주', MONTHLY: '개월' }
const END_LABEL: Record<RecurrenceEnd, string> = { NONE: '없음', UNTIL: '날짜까지', COUNT: '횟수' }

const toNumberOrNull = (value: string) => (value.trim() === '' ? null : Number(value))

/**
 * 반복 규칙 고르기(ADR-0019 §2·§14): 매일·매주(요일)·매월(날짜), 간격, 종료(없음/날짜/횟수).
 * 고른 규칙은 "매주 월·수·금, 10회"처럼 한 줄로 보여 준다.
 */
const RecurrenceRuleFields = ({ draft, onChange, errors = {}, hideStartDate }: RecurrenceRuleFieldsProps) => {
  const set = (patch: Partial<RuleDraft>) => onChange({ ...draft, ...patch })
  const toggleDay = (day: (typeof WEEK_DAYS)[number]) =>
    set({ days: draft.days.includes(day) ? draft.days.filter((d) => d !== day) : sortDays([...draft.days, day]) })

  return (
    <div className="recurrence-fields" role="group" aria-label="반복 규칙">
      <div className="recurrence-fields__row">
        <label className="recurrence-fields__field">
          <span>주기</span>
          <select value={draft.freq} onChange={(event) => set({ freq: event.target.value as RecurrenceFrequency })}>
            {FREQS.map((freq) => (
              <option key={freq} value={freq}>
                {FREQ_LABEL[freq]}
              </option>
            ))}
          </select>
        </label>
        <label className="recurrence-fields__field recurrence-fields__field--narrow">
          <span>간격</span>
          <span className="recurrence-fields__inline">
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_INTERVAL}
              value={draft.interval ?? ''}
              onChange={(event) => set({ interval: toNumberOrNull(event.target.value) })}
              aria-label={`${UNIT[draft.freq]} 간격`}
            />
            <span>{UNIT[draft.freq]}마다</span>
          </span>
        </label>
      </div>
      {errors.interval && <small className="recurrence-fields__error">{errors.interval}</small>}

      {draft.freq === 'WEEKLY' && (
        <>
          <div className="recurrence-fields__days" role="group" aria-label="반복 요일">
            {WEEK_DAYS.map((day) => (
              <button
                key={day}
                type="button"
                className={`recurrence-fields__day${draft.days.includes(day) ? ' is-active' : ''}`}
                aria-pressed={draft.days.includes(day)}
                onClick={() => toggleDay(day)}
              >
                {DAY_SHORT[day]}
              </button>
            ))}
          </div>
          {errors.days && <small className="recurrence-fields__error">{errors.days}</small>}
        </>
      )}

      {draft.freq === 'MONTHLY' && (
        <label className="recurrence-fields__field recurrence-fields__field--narrow">
          <span>날짜</span>
          <span className="recurrence-fields__inline">
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={31}
              value={draft.dayOfMonth ?? ''}
              onChange={(event) => set({ dayOfMonth: toNumberOrNull(event.target.value) })}
            />
            <span>일</span>
          </span>
          {errors.dayOfMonth && <small className="recurrence-fields__error">{errors.dayOfMonth}</small>}
        </label>
      )}

      {!hideStartDate && (
        <label className="recurrence-fields__field">
          <span>시작일</span>
          <input type="date" value={draft.startDate} onChange={(event) => set({ startDate: event.target.value })} />
          {errors.startDate && <small className="recurrence-fields__error">{errors.startDate}</small>}
        </label>
      )}
      {hideStartDate && errors.startDate && <small className="recurrence-fields__error">{errors.startDate}</small>}

      <div className="recurrence-fields__row">
        <label className="recurrence-fields__field">
          <span>종료</span>
          <select value={draft.end} onChange={(event) => set({ end: event.target.value as RecurrenceEnd })}>
            {(Object.keys(END_LABEL) as RecurrenceEnd[]).map((end) => (
              <option key={end} value={end}>
                {END_LABEL[end]}
              </option>
            ))}
          </select>
        </label>
        {draft.end === 'UNTIL' && (
          <label className="recurrence-fields__field">
            <span>종료일</span>
            <input type="date" value={draft.until} onChange={(event) => set({ until: event.target.value })} />
          </label>
        )}
        {draft.end === 'COUNT' && (
          <label className="recurrence-fields__field recurrence-fields__field--narrow">
            <span>횟수</span>
            <span className="recurrence-fields__inline">
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={MAX_COUNT}
                value={draft.count ?? ''}
                onChange={(event) => set({ count: toNumberOrNull(event.target.value) })}
              />
              <span>회</span>
            </span>
          </label>
        )}
      </div>
      {errors.until && <small className="recurrence-fields__error">{errors.until}</small>}
      {errors.count && <small className="recurrence-fields__error">{errors.count}</small>}

      <p className="recurrence-fields__summary" aria-live="polite">
        🔁 {describeRule(toRule(draft))}
      </p>
    </div>
  )
}

export default RecurrenceRuleFields
