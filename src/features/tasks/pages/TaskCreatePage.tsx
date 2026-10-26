import { useNavigate } from 'react-router-dom'
import TaskForm from '../components/TaskForm'
import type { TaskFormValues } from '../components/TaskForm'
import { createTask } from '../api/tasks'
import { useTaskCache } from '@contexts/TaskCacheContext'
import { useToast } from '@contexts/ToastContext'
import { getDisplayZoneId, toApiDateWithOffset } from '@shared/utils/datetime'
import { dispatchTaskChanged } from '@shared/utils/events'
import { minutesToIsoDuration, parseDurationInput } from '@shared/utils/isoDuration'
import './TaskPages.css'
import type { RuleDraft } from '@features/recurrence/utils/recurrenceRules'
import { mapRecurrenceServerErrors, toRule } from '@features/recurrence/utils/recurrenceRules'
import { createRecurrence } from '@features/recurrence/api/recurrences'
import { ApiError } from '@shared/api/httpClient'

const TaskCreatePage = () => {
  const navigate = useNavigate()
  const { setTask } = useTaskCache()
  const { addToast } = useToast()

  /** ADR-0019 FLEXIBLE 반복: 회차마다 그날이 마감인 작업을 만든다. */
  const createRecurringTask = async (values: TaskFormValues, rule: RuleDraft) => {
    const expectedDuration = parseDurationInput(values.expectedDurationMinutes, { zeroIsEmpty: true })
    try {
      await createRecurrence({
        mode: 'FLEXIBLE',
        title: values.title,
        description: values.description,
        flexible: {
          importance: values.importance,
          difficulty: values.difficulty,
          ...(expectedDuration.kind === 'value' ? { expectedDuration: minutesToIsoDuration(expectedDuration.minutes) } : {}),
        },
        rule: toRule(rule),
        zoneId: getDisplayZoneId(),
      })
      dispatchTaskChanged({ reason: 'recurrence' })
      addToast('반복 작업을 만들었어요. 할 일 목록에는 오늘까지의 회차가 보여요.', 'success')
      navigate('/app/tasks')
    } catch (error) {
      console.error('반복 작업 생성 실패', error)
      const fieldErrors = error instanceof ApiError && error.status === 400 ? Object.values(mapRecurrenceServerErrors(error.data)) : []
      addToast(fieldErrors[0] ?? (error instanceof ApiError && error.status === 409 ? '진행 중인 반복이 너무 많아요.' : '반복 작업을 만들지 못했어요.'), 'error')
    }
  }

  const handleSubmit = async (values: TaskFormValues, rule?: RuleDraft | null) => {
    if (rule) {
      await createRecurringTask(values, rule)
      return
    }
    try {
      const expectedDuration = parseDurationInput(values.expectedDurationMinutes, { zeroIsEmpty: true })
      const payload = {
        title: values.title,
        description: values.description,
        dueDate: toApiDateWithOffset(values.dueDate),
        importance: values.importance,
        difficulty: values.difficulty,
        // 비워 두면 보내지 않는다: 서버가 난이도 환산값을 쓴다.
        ...(expectedDuration.kind === 'value' ? { expectedDuration: minutesToIsoDuration(expectedDuration.minutes) } : {}),
        addDependencies: [
          // 새 작업 이전에 해야 할 작업: fromId=선행, toId=0
          ...values.previousTaskIds.map((fromId) => ({ fromId, toId: 0 })),
          // 새 작업 이후에 해야 할 작업: fromId=0, toId=후행
          ...values.nextTaskIds.map((toId) => ({ fromId: 0, toId })),
        ],
      }
      const created = await createTask(payload)
      setTask(created)
      dispatchTaskChanged(created.id, 'create')
      navigate('/app/tasks')
    } catch (error) {
      console.error('작업 생성 실패', error)
      addToast('작업을 생성하지 못했습니다.', 'error')
    }
  }

  return (
    <section className="task-page">
      <header className="task-page__header">
        <p className="task-page__eyebrow">새 작업</p>
        <h1 className="task-page__title">작업 추가</h1>
        <p className="task-page__description">Task 폼과 의존성 선택 모달을 연결할 예정입니다.</p>
      </header>
      <div className="task-page__content">
        <TaskForm onSubmit={handleSubmit} submitLabel="작업 생성" allowRecurrence />
      </div>
    </section>
  )
}

export default TaskCreatePage
