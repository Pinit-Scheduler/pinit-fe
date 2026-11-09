import { moveResultMessage } from '@features/spaces/moveResult'
import EditConflictDialog from '@features/spaces/EditConflictDialog'
import type { ConflictState } from '@features/spaces/EditConflictDialog'
import MyInputDisclosure from '@features/spaces/MyInputDisclosure'
import { usePresence } from '@shared/motion/usePresence'
import {
  changedInput,
  isEditConflict,
  latestLoadError,
} from '@features/spaces/conflicts'
import type { InputRow } from '@features/spaces/conflicts'
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useRouteSurfaceNavigation } from '@shared/routing/RouteSurface'
import { useCategories } from '@features/categories'
import TaskForm from '../components/TaskForm'
import type { TaskFormValues } from '../components/TaskForm'
import { fetchTaskDetail, updateTask } from '../api/tasks'
import {
  toApiDateWithOffset,
  toDayjsFromDateWithOffset,
} from '@shared/utils/datetime'
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
import {
  confirmAndUpdateSeries,
  previewSeriesUpdate,
} from '@features/recurrence/utils/seriesMutations'
import { flexibleChanges } from '@features/recurrence/utils/recurrenceRules'

const LABELS = {
  title: '제목',
  description: '설명',
  dueDate: '마감일',
  importance: '중요도',
  difficulty: '난이도',
  expectedDurationMinutes: '예상 시간(분)',
}

const TaskEditPage = () => {
  const { taskId } = useParams()
  const { complete } = useRouteSurfaceNavigation()
  const {
    taskCategory,
    isLoading: categoryLoading,
    hasLoaded: categoryLoaded,
    error: categoryLoadError,
    reload: reloadCategories,
  } = useCategories()
  const numericId = taskId ? Number(taskId) : null
  const [task, setTask] = useState<Task | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [initialPrevIds, setInitialPrevIds] = useState<number[]>([])
  const [initialNextIds, setInitialNextIds] = useState<number[]>([])
  const { setTask: cacheSetTask } = useTaskCache()
  const { addToast } = useToast()
  const recurrenceScope = useRecurrenceScope()
  const [conflict, setConflict] = useState<ConflictState | null>(null)
  // Keeps the conflict dialog mounted, with its last rows, while it fades out.
  const conflictPresence = usePresence(conflict)
  const [keptInput, setKeptInput] = useState<InputRow[] | null>(null)
  const [formKey, setFormKey] = useState(0)
  const reportConflict = (values: TaskFormValues) => {
    if (!task) return
    const server = {
      title: task.title,
      description: task.description,
      dueDate: toDayjsFromDateWithOffset(task.dueDate).format('YYYY-MM-DD'),
      importance: task.importance,
      difficulty: task.difficulty,
      expectedDurationMinutes: (() => {
        const entered = parseIsoDurationMinutes(task.expectedDuration)
        return entered ? String(entered) : ''
      })(),
    }
    // 이전 충돌 상태는 이번 시도의 입력으로 바꾼다.
    setConflict({ rows: changedInput(server, { ...values }, LABELS) })
  }
  const loadLatest = async () => {
    if (!numericId || !conflict) return
    setConflict({ ...conflict, loading: true, loadError: null })
    try {
      const data = await fetchTaskDetail(numericId)
      setTask(data)
      setInitialPrevIds(data.previousTaskIds ?? [])
      setInitialNextIds(data.nextTaskIds ?? [])
      setKeptInput(conflict.rows)
      setConflict(null)
      setFormKey((key) => key + 1)
    } catch (err) {
      console.error('충돌 뒤 작업 다시 불러오기 실패', err)
      setConflict({
        ...conflict,
        loading: false,
        loadError: latestLoadError(err, '작업'),
      })
    }
  }
  const affiliation = (values: TaskFormValues) => {
    const location = values.locationChanged || values.categoryChanged
    if (!location && !values.assigneeChanged) return undefined
    return {
      ...(location
        ? { spaceId: values.spaceId, projectId: values.categoryId ?? null }
        : {}),
      ...(values.assigneeChanged && values.assigneeId !== undefined
        ? { assigneeId: values.assigneeId }
        : {}),
    }
  }
  const seriesRef = (values: TaskFormValues) => ({
    ...task!.recurrence!,
    version: values.recurrenceVersion ?? task!.recurrence!.version,
  })

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
        setError(
          err instanceof Error ? err.message : '작업을 불러오지 못했습니다.',
        )
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
  const updateSeries = async (
    values: TaskFormValues,
    scope: 'FOLLOWING' | 'ALL',
  ) => {
    if (!task?.recurrence) return
    if (
      values.dueDate !==
      toDayjsFromDateWithOffset(task.dueDate).format('YYYY-MM-DD')
    ) {
      addToast(
        '날짜를 옮기는 것은 "이번만"으로 해 주세요. 반복 요일은 반복 관리에서 바꿔요.',
        'error',
      )
      return
    }
    const expectedDuration = parseDurationInput(
      values.expectedDurationMinutes,
      { zeroIsEmpty: true },
    )
    const before = {
      title: task.title,
      description: task.description,
      importance: task.importance,
      difficulty: task.difficulty,
      expectedDurationMinutes:
        parseIsoDurationMinutes(task.expectedDuration) ?? 0,
    }
    const after = {
      title: values.title,
      description: values.description,
      importance: values.importance,
      difficulty: values.difficulty,
      expectedDurationMinutes:
        expectedDuration.kind === 'value' ? expectedDuration.minutes : 0,
    }
    try {
      const outcome = await confirmAndUpdateSeries(
        seriesRef(values),
        scope,
        flexibleChanges(before, after),
        true,
        affiliation(values),
      )
      if (outcome === 'cancelled') return
      if (outcome === 'updated') {
        dispatchTaskChanged({ reason: 'recurrence' })
        addToast('반복 작업을 바꿨어요.', 'success')
      }
      setKeptInput(null)
      complete('/app/tasks')
    } catch (err) {
      console.error('반복 작업 수정 실패', err)
      if (isEditConflict(err)) {
        reportConflict(values)
        return
      }
      addToast(
        err instanceof Error
          ? err.message
          : '반복 작업을 바꾸지 못했어요. 입력한 내용은 유지됩니다.',
        'error',
      )
    }
  }

  const handleSubmit = async (values: TaskFormValues) => {
    if (!numericId) return
    if (task?.recurrence) {
      const scope = await recurrenceScope.ask('edit', task.title, {
        preview: async (scope) => {
          if (scope === 'THIS') return '이번 작업만 수정합니다.'
          const duration = parseDurationInput(values.expectedDurationMinutes, {
            zeroIsEmpty: true,
          })
          const before = {
            title: task.title,
            description: task.description,
            importance: task.importance,
            difficulty: task.difficulty,
            expectedDurationMinutes:
              parseIsoDurationMinutes(task.expectedDuration) ?? 0,
          }
          const after = {
            title: values.title,
            description: values.description,
            importance: values.importance,
            difficulty: values.difficulty,
            expectedDurationMinutes:
              duration.kind === 'value' ? duration.minutes : 0,
          }
          const changes = flexibleChanges(before, after)
          return await previewSeriesUpdate(
            seriesRef(values),
            scope,
            changes,
            affiliation(values),
          )
        },
      })
      if (scope === null) return
      if (scope !== 'THIS') {
        await updateSeries(values, scope)
        return
      }
    }
    try {
      const expectedDuration = parseDurationInput(
        values.expectedDurationMinutes,
        { zeroIsEmpty: true },
      )
      // 입력값을 비우면 "PT0S"로 해제해 난이도 환산값으로 돌린다. 원래 입력이 없었으면 보내지 않는다(유지).
      const expectedDurationField =
        expectedDuration.kind === 'value'
          ? { expectedDuration: minutesToIsoDuration(expectedDuration.minutes) }
          : task?.expectedDuration
            ? { expectedDuration: minutesToIsoDuration(0) }
            : {}
      const payload = {
        expectedVersion: values.expectedVersion ?? task?.version,
        ...affiliation(values),
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
      setTask(updated)
      setInitialPrevIds(values.previousTaskIds)
      setInitialNextIds(values.nextTaskIds)
      cacheSetTask(updated)
      const moveMessage = moveResultMessage(updated.moveResult)
      dispatchTaskChanged(numericId, 'update')
      addToast(moveMessage ?? '작업을 수정했어요.', 'success')
      setKeptInput(null)
      complete('/app/tasks')
    } catch (err) {
      console.error('작업 수정 실패', err)
      if (isEditConflict(err)) {
        reportConflict(values)
        return
      }
      addToast(
        err instanceof Error
          ? err.message
          : '작업을 수정하지 못했습니다. 입력한 내용은 유지됩니다.',
        'error',
      )
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
        <p className="task-page__description">
          작업 정보와 프로젝트, 이전·다음 연결을 수정하세요.
        </p>
      </header>
      <div className="task-page__content">
        {isLoading || (categoryLoading && !categoryLoaded) ? (
          <div
            className="task-page__placeholder task-page__placeholder--loading"
            role="status"
          >
            <p>작업 정보를 불러오는 중...</p>
          </div>
        ) : error || (categoryLoadError && !categoryLoaded) || !task ? (
          <div className="task-page__placeholder">
            <p>작업 정보를 불러오지 못했습니다.</p>
            <p>{error ?? categoryLoadError}</p>
            <button
              type="button"
              onClick={() => void reloadCategories().catch(() => {})}
            >
              프로젝트 다시 불러오기
            </button>
          </div>
        ) : (
          <div className="task-page__arrive">
            {categoryLoadError && (
              <div role="alert">
                <p>
                  프로젝트를 새로 확인하지 못했어요.작성 중인 내용은 유지됩니다.
                </p>
                <button
                  type="button"
                  onClick={() => void reloadCategories().catch(() => {})}
                >
                  프로젝트 다시 확인
                </button>
              </div>
            )}
            {keptInput && <MyInputDisclosure rows={keptInput} open={false} />}
            <TaskForm
              key={`${task.id}:${formKey}`}
              allowedActions={task.allowedActions}
              unavailableReasons={task.unavailableReasons}
              initialValues={{
                spaceId: task.spaceId,
                assigneeId: task.assigneeId,
                expectedVersion: task.version,
                recurrenceVersion: task.recurrence?.version,
                title: task.title,
                description: task.description,
                dueDate: toDayjsFromDateWithOffset(task.dueDate).format(
                  'YYYY-MM-DD',
                ),
                importance: task.importance,
                difficulty: task.difficulty as TaskFormValues['difficulty'],
                expectedDurationMinutes: (() => {
                  const entered = parseIsoDurationMinutes(task.expectedDuration)
                  return entered ? String(entered) : ''
                })(),
                previousTaskIds: initialPrevIds,
                nextTaskIds: initialNextIds,
                tagIds: (task.tags ?? []).map((tag) => tag.id),
                categoryId: task.projectId ?? taskCategory(task.id)?.id ?? null,
              }}
              taskId={task.id}
              onSubmit={handleSubmit}
              submitLabel="작업 수정"
              hideDependencies={
                Boolean(task.recurrence) ||
                task.allowedActions?.editDependencies === false
              }
              effectiveExpectedDurationLabel={(() => {
                const label = formatIsoDurationLabel(
                  task.effectiveExpectedDuration,
                )
                if (!label) return undefined
                return `${label} · ${task.expectedDuration ? '직접 입력' : '난이도 기준'}`
              })()}
            />
          </div>
        )}
      </div>
      {recurrenceScope.dialog}
      {conflictPresence.mounted && conflictPresence.value && (
        <EditConflictDialog
          noun="작업"
          rows={conflictPresence.value.rows}
          loading={conflictPresence.value.loading}
          loadError={conflictPresence.value.loadError}
          closing={conflictPresence.closing}
          onLoadLatest={() => void loadLatest()}
          onClose={() => setConflict(null)}
          onBackToList={() => complete('/app/tasks')}
        />
      )}
    </section>
  )
}

export default TaskEditPage
