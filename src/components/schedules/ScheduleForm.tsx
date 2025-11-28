import useScheduleForm from '../../hooks/useScheduleForm'
import type { ScheduleTaskType } from '../../types/schedule'
import './ScheduleForm.css'

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

const ScheduleForm = () => {
  const { values, errors, isSubmitting, onChange, onSubmit, reset } = useScheduleForm()

  const toggleId = (list: number[], id: number) =>
    list.includes(id) ? list.filter((item) => item !== id) : [...list, id]

  const handlePreviousToggle = (id: number) => {
    const updated = toggleId(values.previousTaskIds, id)
    onChange('previousTaskIds', updated)
    if (values.nextTaskIds.includes(id)) {
      onChange('nextTaskIds', values.nextTaskIds.filter((item) => item !== id))
    }
  }

  const handleNextToggle = (id: number) => {
    const updated = toggleId(values.nextTaskIds, id)
    onChange('nextTaskIds', updated)
    if (values.previousTaskIds.includes(id)) {
      onChange('previousTaskIds', values.previousTaskIds.filter((item) => item !== id))
    }
  }

  return (
    <form
      className="schedule-form"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
    >
      <label className="schedule-form__field">
        <span>일정 제목</span>
        <input
          value={values.title}
          onChange={(event) => onChange('title', event.target.value)}
          placeholder="예: 마케팅 전략 미팅"
        />
        {errors.title && <small>{errors.title}</small>}
      </label>

      <label className="schedule-form__field">
        <span>설명</span>
        <textarea
          value={values.description}
          onChange={(event) => onChange('description', event.target.value)}
          placeholder="세부 설명을 입력해 주세요"
          rows={3}
        />
        {errors.description && <small>{errors.description}</small>}
      </label>

      <label className="schedule-form__field">
        <span>일정 타입</span>
        <select
          value={values.taskType}
          onChange={(event) => onChange('taskType', event.target.value as ScheduleTaskType)}
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
          value={values.importance}
          onChange={(event) => onChange('importance', Number(event.target.value))}
        />
        {errors.importance && <small>{errors.importance}</small>}
      </label>

      <label className="schedule-form__field">
        <span>긴급도 (1~9)</span>
        <input
          type="number"
          min={1}
          max={9}
          value={values.urgency}
          onChange={(event) => onChange('urgency', Number(event.target.value))}
        />
        {errors.urgency && <small>{errors.urgency}</small>}
      </label>

      <label className="schedule-form__field">
        <span>시작 시간</span>
        <input
          type="datetime-local"
          value={values.date.toISOString().slice(0, 16)}
          onChange={(event) => onChange('date', new Date(event.target.value))}
        />
      </label>

      <label className="schedule-form__field">
        <span>마감 시간</span>
        <input
          type="datetime-local"
          value={values.deadline.toISOString().slice(0, 16)}
          onChange={(event) => onChange('deadline', new Date(event.target.value))}
        />
        {errors.deadline && <small>{errors.deadline}</small>}
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
                  checked={values.previousTaskIds.includes(option.id)}
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
                  checked={values.nextTaskIds.includes(option.id)}
                  onChange={() => handleNextToggle(option.id)}
                />
                <span>{option.title}</span>
              </label>
            ))}
          </div>
        </div>
      </section>

      <div className="schedule-form__actions">
        <button type="button" onClick={reset} disabled={isSubmitting}>
          초기화
        </button>
        <button type="submit" className="is-primary" disabled={isSubmitting}>
          {isSubmitting ? '저장 중...' : '일정 저장'}
        </button>
      </div>
    </form>
  )
}

export default ScheduleForm
