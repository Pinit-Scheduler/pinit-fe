import dayjs from 'dayjs'
import useScheduleForm from '../../hooks/useScheduleForm'
import { SEOUL_TZ } from '../../utils/datetime'
import type { ScheduleTaskType, ScheduleFormValues } from '../../types/schedule'
import './ScheduleForm.css'

type ScheduleFormProps = {
  initialValues?: Partial<ScheduleFormValues>
  onSubmit: (values: ScheduleFormValues) => Promise<void>
  submitLabel?: string
}

const taskTypeOptions: { value: ScheduleTaskType; label: string }[] = [
  { value: 'DEEP_WORK', label: '집중 작업' },
  { value: 'QUICK_TASK', label: '빠른 일정' },
  { value: 'ADMIN_TASK', label: '행정 작업' },
]

const dependencyMockOptions = [
  { id: 101, title: '기획안 마무리' },
  { id: 102, title: '자료 조사' },
  { id: 103, title: '리뷰 일정' },
]

const formatDateTimeLocalValue = (value: Date) =>
  dayjs(value).tz(SEOUL_TZ).format('YYYY-MM-DDTHH:mm')

const parseDateTimeLocalValue = (value: string) => dayjs.tz(value, SEOUL_TZ).toDate()

/**
 * 일정 생성/수정 폼 컴포넌트
 * @param initialValues - 초기 값
 * @param onSubmit - 제출 핸들러
 * @param submitLabel - 제출 버튼 라벨
 * @constructor
 */
const ScheduleForm = ({ initialValues, onSubmit, submitLabel = '일정 저장' }: ScheduleFormProps) => {
  const form = useScheduleForm({ initialValues })

  const toggleId = (list: number[], id: number) =>
    list.includes(id) ? list.filter((item) => item !== id) : [...list, id]

  const handlePreviousToggle = (id: number) => {
    const updated = toggleId(form.values.previousTaskIds, id)
    form.onChange('previousTaskIds', updated)
    if (form.values.nextTaskIds.includes(id)) {
      form.onChange('nextTaskIds', form.values.nextTaskIds.filter((item) => item !== id))
    }
  }

  const handleNextToggle = (id: number) => {
    const updated = toggleId(form.values.nextTaskIds, id)
    form.onChange('nextTaskIds', updated)
    if (form.values.previousTaskIds.includes(id)) {
      form.onChange('previousTaskIds', form.values.previousTaskIds.filter((item) => item !== id))
    }
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!form.validate()) return
    form.setSubmitting(true)
    try {
      await onSubmit(form.values)
      form.reset()
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
          value={form.values.taskType}
          onChange={(event) => form.onChange('taskType', event.target.value as ScheduleTaskType)}
        >
          {taskTypeOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label className="schedule-form__field">
        <span>중요도 (1~9)</span>
        <input
          type="number"
          min={1}
          max={9}
          value={form.values.importance}
          onChange={(event) => form.onChange('importance', Number(event.target.value))}
        />
        {form.errors.importance && <small>{form.errors.importance}</small>}
      </label>

      <label className="schedule-form__field">
        <span>긴급도 (1~9)</span>
        <input
          type="number"
          min={1}
          max={9}
          value={form.values.urgency}
          onChange={(event) => form.onChange('urgency', Number(event.target.value))}
        />
        {form.errors.urgency && <small>{form.errors.urgency}</small>}
      </label>

      <label className="schedule-form__field">
        <span>시작 시간</span>
        <input
          type="datetime-local"
          value={formatDateTimeLocalValue(form.values.date)}
          onChange={(event) => form.onChange('date', parseDateTimeLocalValue(event.target.value))}
        />
      </label>

      <label className="schedule-form__field">
        <span>마감 시간</span>
        <input
          type="datetime-local"
          value={formatDateTimeLocalValue(form.values.deadline)}
          onChange={(event) =>
            form.onChange('deadline', parseDateTimeLocalValue(event.target.value))
          }
        />
        {form.errors.deadline && <small>{form.errors.deadline}</small>}
      </label>

      <section className="schedule-form__dependency">
        <header>
          <h3>이전/이후 일정</h3>
          <p>같은 일정을 두 목록에 동시에 추가할 수 없어요.</p>
        </header>
        <div className="schedule-form__dependency-groups">
          <div>
            <h4>이전에 해야 하는 일정</h4>
            {dependencyMockOptions.map((option) => (
              <label key={option.id} className="schedule-form__checkbox">
                <input
                  type="checkbox"
                  checked={form.values.previousTaskIds.includes(option.id)}
                  onChange={() => handlePreviousToggle(option.id)}
                />
                <span>{option.title}</span>
              </label>
            ))}
          </div>
          <div>
            <h4>이후에 해야 하는 일정</h4>
            {dependencyMockOptions.map((option) => (
              <label key={option.id} className="schedule-form__checkbox">
                <input
                  type="checkbox"
                  checked={form.values.nextTaskIds.includes(option.id)}
                  onChange={() => handleNextToggle(option.id)}
                />
                <span>{option.title}</span>
              </label>
            ))}
          </div>
        </div>
      </section>

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
