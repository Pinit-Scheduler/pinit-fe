import { useState } from 'react'
import type { CSSProperties } from 'react'
import dayjs from 'dayjs'
import { FIBONACCI_DIFFICULTIES } from '@constants/difficulty'
import type { DifficultyValue } from '@constants/difficulty'
import { parseDurationInput } from '@shared/utils/isoDuration'
import './TaskForm.css'
import TaskDependencyModal from './modals/TaskDependencyModal'
import RecurrenceRuleFields from '@features/recurrence/components/RecurrenceRuleFields'
import {
  defaultRuleDraft,
  validateRuleDraft,
  type RuleDraft,
  type RuleDraftField,
} from '@features/recurrence/utils/recurrenceRules'

export type TaskFormValues = {
  title: string
  description: string
  dueDate: string // YYYY-MM-DD
  importance: number
  difficulty: DifficultyValue
  /** 예상 소요시간(분) 입력칸 값. 비우면 서버가 난이도 환산값을 쓴다 */
  expectedDurationMinutes: string
  previousTaskIds: number[]
  nextTaskIds: number[]
}

type TaskFormProps = {
  initialValues?: Partial<TaskFormValues>
  /** rule은 "반복"을 켰을 때만 있다. 첫 회차 날짜는 마감 날짜다 */
  onSubmit: (values: TaskFormValues, rule?: RuleDraft | null) => Promise<void>
  submitLabel?: string
  /** 새 작업에서 "반복"(ADR-0019 FLEXIBLE)을 켤 수 있게 한다 */
  allowRecurrence?: boolean
  /** 반복 회차는 이전·다음 작업을 연결할 수 없다 */
  hideDependencies?: boolean
  /** 서버가 돌려준 유효 예상 소요시간 라벨(수정 화면). 예: "45분 · 난이도 기준" */
  effectiveExpectedDurationLabel?: string
}

const buildDefaultValues = (initial?: Partial<TaskFormValues>): TaskFormValues => {
  const now = dayjs().startOf('day')
  return {
    title: '',
    description: '',
    dueDate: initial?.dueDate ?? now.add(1, 'day').format('YYYY-MM-DD'),
    importance: initial?.importance ?? 5,
    difficulty: initial?.difficulty ?? 2,
    expectedDurationMinutes: initial?.expectedDurationMinutes ?? '',
    previousTaskIds: initial?.previousTaskIds ?? [],
    nextTaskIds: initial?.nextTaskIds ?? [],
    ...initial,
  }
}

const TaskForm = ({
  initialValues,
  onSubmit,
  submitLabel = '저장',
  effectiveExpectedDurationLabel,
  allowRecurrence,
  hideDependencies,
}: TaskFormProps) => {
  const [values, setValues] = useState<TaskFormValues>(() => buildDefaultValues(initialValues))
  const [rule, setRule] = useState<RuleDraft | null>(null)
  const [ruleErrors, setRuleErrors] = useState<Partial<Record<RuleDraftField, string>>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [modalMode, setModalMode] = useState<null | 'previous' | 'next'>(null)
  const [dependencyMeta, setDependencyMeta] = useState<Record<number, { title: string }>>({})
  const isSubmitting = false // mutation 상태 필요시 state로 확장
  const importancePercent = ((values.importance - 1) / 8) * 100

  const validate = () => {
    const next: Record<string, string> = {}
    if (!values.title.trim()) next.title = '제목을 입력하세요.'
    if (!values.description.trim()) next.description = '설명을 입력하세요.'
    if (!values.dueDate) next.dueDate = '마감 날짜를 선택하세요.'
    if (values.importance < 1 || values.importance > 9) next.importance = '중요도는 1~9'
    const expectedDuration = parseDurationInput(values.expectedDurationMinutes, { zeroIsEmpty: true })
    if (expectedDuration.kind === 'invalid') next.expectedDurationMinutes = expectedDuration.message
    setErrors(next)
    return Object.keys(next).length === 0
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    const valid = validate()
    const ruleWithStart = rule ? { ...rule, startDate: values.dueDate } : null
    const nextRuleErrors = ruleWithStart ? validateRuleDraft(ruleWithStart, dayjs().format('YYYY-MM-DD')) : {}
    setRuleErrors(nextRuleErrors)
    if (!valid || Object.keys(nextRuleErrors).length) return
    await onSubmit(values, ruleWithStart)
  }

  const showDependencies = !hideDependencies && rule === null

  return (
    <form className="task-form" onSubmit={handleSubmit}>
      <label className="task-form__field">
        <span>제목</span>
        <input
          value={values.title}
          onChange={(e) => setValues((prev) => ({ ...prev, title: e.target.value }))}
          placeholder="예: 발표 준비"
        />
        {errors.title && <small>{errors.title}</small>}
      </label>

      <label className="task-form__field">
        <span>설명</span>
        <textarea
          value={values.description}
          onChange={(e) => setValues((prev) => ({ ...prev, description: e.target.value }))}
          rows={3}
          placeholder="무엇을 해야 하나요?"
        />
        {errors.description && <small>{errors.description}</small>}
      </label>

      <label className="task-form__field">
        <span>마감 날짜</span>
        <input
          type="date"
          value={values.dueDate}
          onChange={(e) => setValues((prev) => ({ ...prev, dueDate: e.target.value }))}
        />
        {errors.dueDate && <small>{errors.dueDate}</small>}
      </label>

      <label className="task-form__field">
        <div className="task-form__field-head">
          <span>중요도 (1~9)</span>
          <span className="task-form__field-value">{values.importance}</span>
        </div>
        <input
          className="task-form__slider"
          type="range"
          min={1}
          max={9}
          step={1}
          value={values.importance}
          onChange={(e) =>
            setValues((prev) => ({ ...prev, importance: Number(e.target.value) }))
          }
          style={
            {
              '--range-progress': `${importancePercent}%`,
              '--range-color': '#2563eb',
            } as CSSProperties
          }
        />
        <div className="task-form__slider-scale">
          {[1, 3, 5, 7, 9].map((mark) => (
            <span key={mark}>{mark}</span>
          ))}
        </div>
        {errors.importance && <small>{errors.importance}</small>}
      </label>

      <div className="task-form__field">
        <span>난이도</span>
        <div className="task-form__difficulty-row">
          {FIBONACCI_DIFFICULTIES.map((diff) => (
            <button
              key={diff}
              type="button"
              className={[
                'task-form__difficulty-pill',
                values.difficulty === diff ? 'is-active' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => setValues((prev) => ({ ...prev, difficulty: diff }))}
              aria-pressed={values.difficulty === diff}
            >
              {diff}
            </button>
          ))}
        </div>
      </div>

      <label className="task-form__field">
        <span>예상 소요시간 (분, 선택)</span>
        <input
          type="number"
          inputMode="numeric"
          min={5}
          max={1440}
          value={values.expectedDurationMinutes}
          onChange={(e) => setValues((prev) => ({ ...prev, expectedDurationMinutes: e.target.value }))}
          placeholder="비워 두면 난이도에 맞춰 정해져요"
        />
        {effectiveExpectedDurationLabel && (
          <p className="task-form__note">현재 적용: {effectiveExpectedDurationLabel}</p>
        )}
        {errors.expectedDurationMinutes && <small>{errors.expectedDurationMinutes}</small>}
      </label>

      {allowRecurrence && (
        <div className="task-form__field">
          <label className="recurrence-toggle">
            <input
              type="checkbox"
              checked={rule !== null}
              onChange={(e) => {
                const checked = e.target.checked
                setRule(checked ? defaultRuleDraft(values.dueDate) : null)
                if (checked) setValues((prev) => ({ ...prev, previousTaskIds: [], nextTaskIds: [] }))
              }}
            />
            <span>🔁 반복</span>
          </label>
          {rule && (
            <>
              <RecurrenceRuleFields draft={rule} onChange={setRule} errors={ruleErrors} hideStartDate />
              <p className="task-form__note">
                마감 날짜가 첫 회차예요. 회차마다 그날이 마감인 작업이 생기고, 자동 계획이 그날 시간을 잡아요. 반복 작업에는
                이전·다음 작업을 연결할 수 없어요.
              </p>
            </>
          )}
        </div>
      )}

      <div className="task-form__actions">
        <button type="submit" className="task-form__primary" disabled={isSubmitting}>
          {submitLabel}
        </button>
      </div>

      {showDependencies && (
        <>
          <div className="task-form__dependency" data-onboarding-anchor="task-form.dependencies">
            <div className="task-form__dependency-row">
              <h3>이전 작업</h3>
              <button type="button" onClick={() => setModalMode('previous')}>선택</button>
            </div>
            {values.previousTaskIds.length === 0 ? (
              <p className="task-form__note">선택된 이전 작업이 없습니다.</p>
            ) : (
              <div className="task-form__tags">
                {values.previousTaskIds.map((id) => (
                  <span key={id} className="task-form__tag">
                    {dependencyMeta[id]?.title ?? `작업 #${id}`}
                    <button
                      type="button"
                      onClick={() =>
                        setValues((prev) => ({
                          ...prev,
                          previousTaskIds: prev.previousTaskIds.filter((v) => v !== id),
                        }))
                      }
                      aria-label="이전 작업 제거"
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="task-form__dependency">
            <div className="task-form__dependency-row">
              <h3>이후 작업</h3>
              <button type="button" onClick={() => setModalMode('next')}>선택</button>
            </div>
            {values.nextTaskIds.length === 0 ? (
              <p className="task-form__note">선택된 이후 작업이 없습니다.</p>
            ) : (
              <div className="task-form__tags">
                {values.nextTaskIds.map((id) => (
                  <span key={id} className="task-form__tag is-next">
                    {dependencyMeta[id]?.title ?? `작업 #${id}`}
                    <button
                      type="button"
                      onClick={() =>
                        setValues((prev) => ({
                          ...prev,
                          nextTaskIds: prev.nextTaskIds.filter((v) => v !== id),
                        }))
                      }
                      aria-label="이후 작업 제거"
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

        </>
      )}
      <TaskDependencyModal
        isOpen={modalMode !== null}
        onClose={() => setModalMode(null)}
        selectedIds={modalMode === 'previous' ? values.previousTaskIds : values.nextTaskIds}
        title={modalMode === 'previous' ? '이전에 해야 할 작업 선택' : '이후에 해야 할 작업 선택'}
        onApply={(tasks) => {
          const ids = tasks.map((t) => t.id)
          const metas = tasks.reduce<Record<number, { title: string }>>((acc, t) => {
            acc[t.id] = { title: t.title }
            return acc
          }, {})
          setDependencyMeta((prev) => ({ ...prev, ...metas }))
          setValues((prev) => {
            if (modalMode === 'previous') {
              const nextPrev = Array.from(new Set([...prev.previousTaskIds, ...ids])).filter(
                (id) => !prev.nextTaskIds.includes(id),
              )
              const nextNext = prev.nextTaskIds.filter((id) => !ids.includes(id))
              return { ...prev, previousTaskIds: nextPrev, nextTaskIds: nextNext }
            }
            const nextNext = Array.from(new Set([...prev.nextTaskIds, ...ids])).filter(
              (id) => !prev.previousTaskIds.includes(id),
            )
            const nextPrev = prev.previousTaskIds.filter((id) => !ids.includes(id))
            return { ...prev, previousTaskIds: nextPrev, nextTaskIds: nextNext }
          })
          setModalMode(null)
        }}
      />
    </form>
  )
}

export default TaskForm
