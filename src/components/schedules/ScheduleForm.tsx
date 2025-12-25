import dayjs from 'dayjs'
import { useState } from 'react'
import type { CSSProperties } from 'react'
import useScheduleForm from '../../hooks/useScheduleForm'
import type { ScheduleTaskType, ScheduleFormValues, ScheduleSummary } from '../../types/schedule'
import './ScheduleForm.css'
import ScheduleDependencyModal from '../modals/ScheduleDependencyModal'
import { useTimePreferences } from '../../context/TimePreferencesContext'

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

const formatDateTimeLocalValue = (value: Date, offsetMinutes: number) =>
  dayjs(value).utc().utcOffset(offsetMinutes).format('YYYY-MM-DDTHH:mm')

const parseDateTimeLocalValue = (value: string, offsetMinutes: number) =>
  dayjs(value).utcOffset(offsetMinutes, true).toDate()

type RangeStyle = CSSProperties & {
  '--range-progress'?: string
  '--range-color'?: string
}

const buildRangeStyle = (value: number, color: string): RangeStyle => ({
  '--range-progress': `${((value - 1) / 8) * 100}%`,
  '--range-color': color,
})

/**
 * 일정 생성/수정 폼 컴포넌트
 * @param initialValues - 초기 값
 * @param onSubmit - 제출 핸들러
 * @param submitLabel - 제출 버튼 라벨
 * @constructor
 */
const ScheduleForm = ({ initialValues, onSubmit, submitLabel = '일정 저장' }: ScheduleFormProps) => {
  const form = useScheduleForm({ initialValues })
  const [dependencyMeta, setDependencyMeta] = useState<Record<number, { title: string }>>({})
  const [modalMode, setModalMode] = useState<null | 'previous' | 'next'>(null)
  const { offsetMinutes } = useTimePreferences()

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

  const handleApplyDependencies = (mode: 'previous' | 'next', selections: ScheduleSummary[]) => {
    const ids = selections.map((item) => item.id)
    const metas = selections.reduce<Record<number, { title: string }>>((acc, item) => {
      acc[item.id] = { title: item.title }
      return acc
    }, {})

    setDependencyMeta((prev) => ({ ...prev, ...metas }))

    if (mode === 'previous') {
      const nextPrev = Array.from(new Set([...form.values.previousTaskIds, ...ids])).filter(
        (id) => !form.values.nextTaskIds.includes(id),
      )
      const nextNext = form.values.nextTaskIds.filter((id) => !ids.includes(id))
      form.onChange('previousTaskIds', nextPrev)
      form.onChange('nextTaskIds', nextNext)
    } else {
      const nextNext = Array.from(new Set([...form.values.nextTaskIds, ...ids])).filter(
        (id) => !form.values.previousTaskIds.includes(id),
      )
      const nextPrev = form.values.previousTaskIds.filter((id) => !ids.includes(id))
      form.onChange('previousTaskIds', nextPrev)
      form.onChange('nextTaskIds', nextNext)
    }
    setModalMode(null)
  }

  const removeDependency = (mode: 'previous' | 'next', id: number) => {
    const nextPrev =
      mode === 'previous'
        ? form.values.previousTaskIds.filter((item) => item !== id)
        : form.values.previousTaskIds
    const nextNext =
      mode === 'next' ? form.values.nextTaskIds.filter((item) => item !== id) : form.values.nextTaskIds

    if (mode === 'previous') {
      form.onChange('previousTaskIds', nextPrev)
    } else {
      form.onChange('nextTaskIds', nextNext)
    }
    setDependencyMeta((prev) => {
      const stillUsed = nextPrev.includes(id) || nextNext.includes(id)
      if (stillUsed) return prev
      const next = { ...prev }
      delete next[id]
      return next
    })
  }

  const selectedMeta = (id: number) => dependencyMeta[id]?.title ?? `일정 #${id}`

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

      <label className="schedule-form__field schedule-form__range-field">
        <div className="schedule-form__range-header">
          <span>중요도</span>
          <span className="schedule-form__range-value">{form.values.importance}</span>
        </div>
        <input
          type="range"
          min={1}
          max={9}
          step={1}
          value={form.values.importance}
          onChange={(event) => form.onChange('importance', Number(event.target.value))}
          className="schedule-form__range-input"
          style={buildRangeStyle(form.values.importance, '#60a5fa')}
        />
        <div className="schedule-form__range-scale">
          <span>1</span>
          <span>9</span>
        </div>
        {form.errors.importance && <small>{form.errors.importance}</small>}
      </label>

      <label className="schedule-form__field schedule-form__range-field">
        <div className="schedule-form__range-header">
          <span>긴급도</span>
          <span className="schedule-form__range-value">{form.values.urgency}</span>
        </div>
        <input
          type="range"
          min={1}
          max={9}
          step={1}
          value={form.values.urgency}
          onChange={(event) => form.onChange('urgency', Number(event.target.value))}
          className="schedule-form__range-input"
          style={buildRangeStyle(form.values.urgency, '#f87171')}
        />
        <div className="schedule-form__range-scale">
          <span>1</span>
          <span>9</span>
        </div>
        {form.errors.urgency && <small>{form.errors.urgency}</small>}
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
        <span>마감 시간</span>
        <input
          type="datetime-local"
          value={formatDateTimeLocalValue(form.values.deadline, offsetMinutes)}
          onChange={(event) =>
            form.onChange(
              'deadline',
              parseDateTimeLocalValue(event.target.value, offsetMinutes),
            )
          }
        />
        {form.errors.deadline && <small>{form.errors.deadline}</small>}
      </label>

      <section className="schedule-form__dependency">
        <header>
          <h3>이전/이후 일정</h3>
          <p>버튼을 눌러 달력에서 일정을 선택하세요. 같은 일정을 두 목록에 동시에 추가할 수 없어요.</p>
        </header>
        <div className="schedule-form__dependency-groups">
          <div className="schedule-form__dependency-column">
            <div className="schedule-form__dependency-header">
              <h4>이전에 해야 하는 일정</h4>
              <button type="button" onClick={() => setModalMode('previous')}>
                달력에서 선택
              </button>
            </div>
            {form.values.previousTaskIds.length === 0 ? (
              <p className="schedule-form__dependency-empty">선택된 일정이 없습니다.</p>
            ) : (
              <div className="schedule-form__dependency-tags">
                {form.values.previousTaskIds.map((id) => (
                  <span key={id} className="schedule-form__tag">
                    {selectedMeta(id)}
                    <button
                      type="button"
                      className="schedule-form__tag-remove"
                      onClick={() => removeDependency('previous', id)}
                      aria-label="이전 일정 제거"
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="schedule-form__dependency-column">
            <div className="schedule-form__dependency-header">
              <h4>이후에 해야 하는 일정</h4>
              <button type="button" onClick={() => setModalMode('next')}>
                달력에서 선택
              </button>
            </div>
            {form.values.nextTaskIds.length === 0 ? (
              <p className="schedule-form__dependency-empty">선택된 일정이 없습니다.</p>
            ) : (
              <div className="schedule-form__dependency-tags">
                {form.values.nextTaskIds.map((id) => (
                  <span key={id} className="schedule-form__tag is-next">
                    {selectedMeta(id)}
                    <button
                      type="button"
                      className="schedule-form__tag-remove"
                      onClick={() => removeDependency('next', id)}
                      aria-label="이후 일정 제거"
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            )}
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

      {modalMode && (
        <ScheduleDependencyModal
          isOpen={Boolean(modalMode)}
          mode={modalMode}
          onClose={() => setModalMode(null)}
          selectedIds={
            modalMode === 'previous' ? form.values.previousTaskIds : form.values.nextTaskIds
          }
          onApply={(schedules) => handleApplyDependencies(modalMode, schedules)}
        />
      )}
    </form>
  )
}

export default ScheduleForm
