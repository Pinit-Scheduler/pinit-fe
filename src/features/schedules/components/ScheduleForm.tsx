import dayjs from 'dayjs'
import useScheduleForm from '../hooks/useScheduleForm'
import type { ScheduleTaskType, ScheduleFormValues } from '../types/schedule'
import './ScheduleForm.css'
import { useTimePreferences } from '@contexts/TimePreferencesContext'

type ScheduleFormProps = {
  initialValues?: Partial<ScheduleFormValues>
  onSubmit: (values: ScheduleFormValues) => Promise<void>
  submitLabel?: string
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
const ScheduleForm = ({ initialValues, onSubmit, submitLabel = '일정 저장' }: ScheduleFormProps) => {
  const form = useScheduleForm({ initialValues })
  const { offsetMinutes } = useTimePreferences()

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!form.validate()) return
    form.setSubmitting(true)
    try {
      await onSubmit(form.values)
      form.reset(initialValues)
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
