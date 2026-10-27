import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import TaskForm from '../components/TaskForm'
import type { TaskFormValues } from '../components/TaskForm'
import { fetchTaskDetail, updateTask } from '../api/tasks'
import { toApiDateWithOffset, toDayjsFromDateWithOffset } from '@shared/utils/datetime'
import type { Task } from '../types/task'
import { useTaskCache } from '@contexts/TaskCacheContext'
import { useToast } from '@contexts/ToastContext'
import { dispatchTaskChanged } from '@shared/utils/events'
import {
  formatIsoDurationLabel,
  minutesToIsoDuration,
  parseDurationInput,
  parseIsoDurationMinutes,
} from '@shared/utils/isoDuration'
import './TaskPages.css'
import { useRecurrenceScope } from '@features/recurrence/components/RecurrenceScopeDialog'
import { confirmAndUpdateSeries } from '@features/recurrence/utils/seriesMutations'
import { flexibleChanges } from '@features/recurrence/utils/recurrenceRules'

const TaskEditPage = () => {
  const { taskId } = useParams()
  const navigate = useNavigate()
  const numericId = taskId ? Number(taskId) : null
  const [task, setTask] = useState<Task | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [initialPrevIds, setInitialPrevIds] = useState<number[]>([])
  const [initialNextIds, setInitialNextIds] = useState<number[]>([])
  const { setTask: cacheSetTask } = useTaskCache()
  const { addToast } = useToast()
  const recurrenceScope = useRecurrenceScope()

  useEffect(() => {
    if (!numericId) return
    let mounted = true
    const load = async () => {
      setIsLoading(true)
      setError(null)
      try {
        const data = await fetchTaskDetail(numericId)
        if (!mounted) return
        setTask(data)
        setInitialPrevIds(data.previousTaskIds ?? [])
        setInitialNextIds(data.nextTaskIds ?? [])
      } catch (err) {
        if (!mounted) return
        setError(err instanceof Error ? err.message : '작업을 불러오지 못했습니다.')
      } finally {
        if (mounted) setIsLoading(false)
      }
    }
    load()
    return () => {
      mounted = false
    }
  }, [numericId])

  /** ADR-0019 "이번 및 이후"·"전체": 바꾼 값만 시리즈에 보낸다. 날짜 이동은 "이번만"에서만 된다. */
  const updateSeries = async (values: TaskFormValues, scope: 'FOLLOWING' | 'ALL') => {
    if (!task?.recurrence) return
    if (values.dueDate !== toDayjsFromDateWithOffset(task.dueDate).format('YYYY-MM-DD')) {
      addToast('날짜를 옮기는 것은 "이번만"으로 해 주세요. 반복 요일은 반복 관리에서 바꿔요.', 'error')
      return
    }
    const expectedDuration = parseDurationInput(values.expectedDurationMinutes, { zeroIsEmpty: true })
    const before = {
      title: task.title,
      description: task.description,
      importance: task.importance,
      difficulty: task.difficulty,
      expectedDurationMinutes: parseIsoDurationMinutes(task.expectedDuration) ?? 0,
    }
    const after = {
      title: values.title,
      description: values.description,
      importance: values.importance,
      difficulty: values.difficulty,
      expectedDurationMinutes: expectedDuration.kind === 'value' ? expectedDuration.minutes : 0,
    }
    try {
      const outcome = await confirmAndUpdateSeries(task.recurrence, scope, flexibleChanges(before, after))
      if (outcome === 'cancelled') return
      if (outcome === 'updated') {
        dispatchTaskChanged({ reason: 'recurrence' })
        addToast('반복 작업을 바꿨어요.', 'success')
      }
      navigate('/app/tasks')
    } catch (err) {
      console.error('반복 작업 수정 실패', err)
      addToast('반복 작업을 바꾸지 못했어요.', 'error')
    }
  }

  const handleSubmit = async (values: TaskFormValues) => {
    if (!numericId) return
    if (task?.recurrence) {
      const scope = await recurrenceScope.ask('edit', task.title)
      if (scope === null) return
      if (scope !== 'THIS') {
        await updateSeries(values, scope)
        return
      }
    }
    try {
      const expectedDuration = parseDurationInput(values.expectedDurationMinutes, { zeroIsEmpty: true })
      // 입력값을 비우면 "PT0S"로 해제해 난이도 환산값으로 돌린다. 원래 입력이 없었으면 보내지 않는다(유지).
      const expectedDurationField =
        expectedDuration.kind === 'value'
          ? { expectedDuration: minutesToIsoDuration(expectedDuration.minutes) }
          : task?.expectedDuration
            ? { expectedDuration: minutesToIsoDuration(0) }
            : {}
      const payload = {
        title: values.title,
        description: values.description,
        dueDate: toApiDateWithOffset(values.dueDate),
        importance: values.importance,
        difficulty: values.difficulty,
        ...expectedDurationField,
        addDependencies: [
          ...values.previousTaskIds
            .filter((id) => !initialPrevIds.includes(id))
            .map((fromId) => ({ fromId, toId: numericId })),
          ...values.nextTaskIds
            .filter((id) => !initialNextIds.includes(id))
            .map((toId) => ({ fromId: numericId, toId })),
        ],
        removeDependencies: [
          ...initialPrevIds
            .filter((id) => !values.previousTaskIds.includes(id))
            .map((fromId) => ({ fromId, toId: numericId })),
          ...initialNextIds
            .filter((id) => !values.nextTaskIds.includes(id))
            .map((toId) => ({ fromId: numericId, toId })),
        ],
        tagIds: values.tagIds,
      }
      const updated = await updateTask(numericId, payload)
      cacheSetTask(updated)
      dispatchTaskChanged(numericId, 'update')
      addToast('작업을 수정했어요.', 'success')
      navigate('/app/tasks')
    } catch (err) {
      console.error('작업 수정 실패', err)
      addToast('작업을 수정하지 못했습니다.', 'error')
    }
  }

  if (!numericId) {
    return (
      <section className="task-page">
        <div className="task-page__placeholder">
          <p>유효하지 않은 작업 ID입니다.</p>
        </div>
      </section>
    )
  }

  return (
    <section className="task-page">
      <header className="task-page__header">
        <p className="task-page__eyebrow">작업 수정</p>
        <h1 className="task-page__title">작업 업데이트</h1>
        <p className="task-page__description">Task 상세를 불러와 폼에 채워 수정합니다.</p>
      </header>
      <div className="task-page__content">
        {isLoading ? (
          <div className="task-page__placeholder">
            <p>작업 정보를 불러오는 중...</p>
          </div>
        ) : error || !task ? (
          <div className="task-page__placeholder">
            <p>작업 정보를 불러오지 못했습니다.</p>
            <p>{error}</p>
          </div>
        ) : (
          <TaskForm
            initialValues={{
              title: task.title,
              description: task.description,
              dueDate: toDayjsFromDateWithOffset(task.dueDate).format('YYYY-MM-DD'),
              importance: task.importance,
              difficulty: task.difficulty as TaskFormValues['difficulty'],
              expectedDurationMinutes: (() => {
                const entered = parseIsoDurationMinutes(task.expectedDuration)
                return entered ? String(entered) : ''
              })(),
              previousTaskIds: initialPrevIds,
              nextTaskIds: initialNextIds,
              tagIds: (task.tags ?? []).map((tag) => tag.id),
            }}
            taskId={task.id}
            onSubmit={handleSubmit}
            submitLabel="작업 수정"
            hideDependencies={Boolean(task.recurrence)}
            effectiveExpectedDurationLabel={(() => {
              const label = formatIsoDurationLabel(task.effectiveExpectedDuration)
              if (!label) return undefined
              return `${label} · ${task.expectedDuration ? '직접 입력' : '난이도 기준'}`
            })()}
          />
        )}
      </div>
      {recurrenceScope.dialog}
    </section>
  )
}

export default TaskEditPage
