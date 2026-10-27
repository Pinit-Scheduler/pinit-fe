import dayjs from 'dayjs'
import { useState } from 'react'
import useScheduleForm from '../hooks/useScheduleForm'
import RecurrenceRuleFields from '@features/recurrence/components/RecurrenceRuleFields'
import {
  defaultRuleDraft,
  validateRuleDraft,
  type RuleDraft,
  type RuleDraftField,
} from '@features/recurrence/utils/recurrenceRules'
import { getTodayWithOffset, toDateKey } from '@shared/utils/datetime'
import type { ScheduleTaskType, ScheduleFormValues } from '../types/schedule'
import './ScheduleForm.css'
import { useTimePreferences } from '@contexts/TimePreferencesContext'

type ScheduleFormProps = {
  initialValues?: Partial<ScheduleFormValues>
  /** rule은 "반복"을 켰을 때만 있다. 시작일은 시작 시간의 날짜다 */
  onSubmit: (values: ScheduleFormValues, rule?: RuleDraft | null) => Promise<void>
  submitLabel?: string
  /** 계획 길이 입력칸 아래 안내. 예: 새 일정은 "비워 두면 30분" */
  plannedDurationHint?: string
  /** 새 일정에서 "반복"(ADR-0019 FIXED)을 켤 수 있게 한다 */
  allowRecurrence?: boolean
}

const scheduleTypeOptions: { value: ScheduleTaskType; label: string }[] = [
  { value: 'DEEP_WORK', label: '집중 작업' },
  { value: 'QUICK_TASK', label: '빠른 일정' },
  { value: 'ADMIN_TASK', label: '행정 작업' },
]

const formatDateTimeLocalValue = (value: Date, offsetMinutes: number) =>
  dayjs(value).utc().utcOffset(offsetMinutes).format('YYYY-MM-DDTHH:mm')

const parseDateTimeLocalValue = (value: string, offsetMinutes: number) =>
  dayjs(value).utcOffset(offsetMinutes, true).toDate()

/**
 * 일정 생성/수정 폼 컴포넌트
 * @param initialValues - 초기 값
 * @param onSubmit - 제출 핸들러
 * @param submitLabel - 제출 버튼 라벨
 * @constructor
 */
const ScheduleForm = ({ initialValues, onSubmit, submitLabel = '일정 저장', plannedDurationHint, allowRecurrence }: ScheduleFormProps) => {
  const form = useScheduleForm({ initialValues })
  const { offsetMinutes } = useTimePreferences()
  const [rule, setRule] = useState<RuleDraft | null>(null)
  const [ruleErrors, setRuleErrors] = useState<Partial<Record<RuleDraftField, string>>>({})

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    const valid = form.validate()
    const ruleWithStart = rule ? { ...rule, startDate: toDateKey(form.values.date) } : null
    const nextRuleErrors = ruleWithStart ? validateRuleDraft(ruleWithStart, getTodayWithOffset().format('YYYY-MM-DD')) : {}
    setRuleErrors(nextRuleErrors)
    if (!valid || Object.keys(nextRuleErrors).length) return
    form.setSubmitting(true)
    try {
      await onSubmit(form.values, ruleWithStart)
      form.reset(initialValues)
      setRule(null)
    } catch (error) {
      console.error('일정 저장 중 오류가 발생했습니다.', error)
    } finally {
      form.setSubmitting(false)
    }
  }

  return (
    <form
      className="schedule-form"
      onSubmit={handleSubmit}
    >
      <label className="schedule-form__field">
        <span>일정 제목</span>
        <input
          value={form.values.title}
          onChange={(event) => form.onChange('title', event.target.value)}
          placeholder="예: 마케팅 전략 미팅"
        />
        {form.errors.title && <small>{form.errors.title}</small>}
      </label>

      <label className="schedule-form__field">
        <span>설명</span>
        <textarea
          value={form.values.description}
          onChange={(event) => form.onChange('description', event.target.value)}
          placeholder="세부 설명을 입력해 주세요"
          rows={3}
        />
        {form.errors.description && <small>{form.errors.description}</small>}
      </label>

      <label className="schedule-form__field">
        <span>일정 타입</span>
        <select
        value={form.values.scheduleType}
        onChange={(event) => form.onChange('scheduleType', event.target.value as ScheduleTaskType)}
      >
          {scheduleTypeOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label className="schedule-form__field">
        <span>시작 시간</span>
        <input
          type="datetime-local"
          value={formatDateTimeLocalValue(form.values.date, offsetMinutes)}
          onChange={(event) =>
            form.onChange('date', parseDateTimeLocalValue(event.target.value, offsetMinutes))
          }
        />
      </label>

      <label className="schedule-form__field">
        <span>계획 길이 (분, 선택)</span>
        <input
          type="number"
          inputMode="numeric"
          min={5}
          max={1440}
          value={form.values.plannedDurationMinutes ?? ''}
          onChange={(event) => form.onChange('plannedDurationMinutes', event.target.value)}
          placeholder="예: 45"
        />
        {plannedDurationHint && <p className="schedule-form__hint">{plannedDurationHint}</p>}
        {form.errors.plannedDurationMinutes && <small>{form.errors.plannedDurationMinutes}</small>}
      </label>

      {allowRecurrence && (
        <div className="schedule-form__field">
          <label className="recurrence-toggle">
            <input
              type="checkbox"
              checked={rule !== null}
              onChange={(event) => setRule(event.target.checked ? defaultRuleDraft(toDateKey(form.values.date)) : null)}
            />
            <span>🔁 반복</span>
          </label>
          {rule && (
            <>
              <RecurrenceRuleFields draft={rule} onChange={setRule} errors={ruleErrors} hideStartDate />
              <p className="schedule-form__hint">
                시작 시간의 날짜부터 정한 시각에 일정이 생겨요. 오늘부터 28일 치를 먼저 만들고 이어서 만들어요.
              </p>
            </>
          )}
        </div>
      )}

      <div className="schedule-form__actions">
        <button type="button" onClick={() => form.reset(initialValues)} disabled={form.isSubmitting}>
          초기화
        </button>
        <button type="submit" className="is-primary" disabled={form.isSubmitting}>
          {form.isSubmitting ? '저장 중...' : submitLabel}
        </button>
      </div>
    </form>
  )
}

export default ScheduleForm
