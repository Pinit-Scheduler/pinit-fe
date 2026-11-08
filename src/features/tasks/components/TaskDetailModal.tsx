import WorkspaceIcon from '@shared/components/common/WorkspaceIcon'
import { CategoryBadge } from '@features/categories'
import { useEffect, useState, useId, useRef } from 'react'
import Modal from '@shared/components/common/Modal'
import { useRouteSurfaceNavigation } from '@shared/routing/RouteSurface'
import {
  completeTask,
  createScheduleFromTask,
  deleteTask,
  fetchTaskDetail,
  reopenTask,
} from '../api/tasks'
import type { Task } from '../types/task'
import {
  getDifficultyStyle,
  getImportanceStyle,
} from '@shared/utils/priorityStyles'
import TaskScheduleModal from './TaskScheduleModal'
import { useTaskCache } from '@contexts/TaskCacheContext'
import { useToast } from '@contexts/ToastContext'
import {
  dispatchScheduleChanged,
  dispatchTaskChanged,
  onTaskChanged,
} from '@shared/utils/events'
import { getDeadlineStyle } from '@shared/utils/deadlineStyles'
import { formatDateWithOffset } from '@shared/utils/datetime'
import { formatIsoDurationLabel } from '@shared/utils/isoDuration'
import './TaskDetailModal.css'
import '@features/recurrence/components/RecurrenceRuleFields.css'
import { useRecurrenceScope } from '@features/recurrence/components/RecurrenceScopeDialog'
import {
  confirmAndDeleteSeries,
  previewSeriesDelete,
} from '@features/recurrence/utils/seriesMutations'
import { useTrashUndo } from '@features/trash'

type TaskDetailModalProps = {
  taskId: number
  onClose: () => void
  embedded?: boolean
}

const TaskDetailModal = ({
  taskId,
  onClose,
  embedded = false,
}: TaskDetailModalProps) => {
  const titleId = useId()
  const toggleLock = useRef(false)
  const { tasksById, setTask, removeTask } = useTaskCache()
  const { addToast } = useToast()
  const { offerTaskUndo } = useTrashUndo()
  const { open } = useRouteSurfaceNavigation()
  const [task, setTaskState] = useState<Task | null>(tasksById[taskId] ?? null)
  const [isLoading, setIsLoading] = useState(!tasksById[taskId])
  const [error, setError] = useState<string | null>(null)
  const [showScheduleModal, setShowScheduleModal] = useState(false)
  const [revision, setRevision] = useState(0)
  useEffect(() => onTaskChanged(() => setRevision((value) => value + 1)), [])
  const [isToggling, setIsToggling] = useState(false)
  const recurrenceScope = useRecurrenceScope()

  useEffect(() => {
    const cached = tasksById[taskId]
    if (cached) {
      setTaskState(cached)
      setIsLoading(false)
    }
  }, [taskId, tasksById])

  useEffect(() => {
    let mounted = true
    const load = async () => {
      setIsLoading(true)
      setError(null)
      try {
        const data = await fetchTaskDetail(taskId)
        if (!mounted) return
        setTaskState(data)
        setTask(data)
      } catch (err) {
        if (!mounted) return
        setTaskState(null)
        removeTask(taskId)
        setError(
          err instanceof Error ? err.message : '작업을 불러오지 못했습니다.',
        )
      } finally {
        if (mounted) setIsLoading(false)
      }
    }
    void load()
    return () => {
      mounted = false
    }
  }, [setTask, removeTask, taskId, revision])

  const toggleCompletion = async () => {
    if (!task || toggleLock.current) return
    toggleLock.current = true
    setIsToggling(true)
    try {
      const next =
        (task.completed ?? task.isCompleted)
          ? await reopenTask(task.id, task.version)
          : await completeTask(task.id, task.version)
      const nextCompleted = next.completed ?? next.isCompleted ?? false
      setTaskState(next)
      setTask(next)
      dispatchTaskChanged(task.id, nextCompleted ? 'complete' : 'reopen')
      addToast(
        nextCompleted ? '작업을 완료했어요.' : '작업을 미완료로 전환했어요.',
        'success',
      )
    } catch (err) {
      console.error('작업 상태 변경 실패', err)
      addToast('완료 상태를 변경하지 못했습니다.', 'error')
    } finally {
      toggleLock.current = false
      setIsToggling(false)
    }
  }

  const handleDelete = async () => {
    if (!task) return
    if (task.recurrence) {
      const scope = await recurrenceScope.ask('delete', task.title, {
        preview: (selected) =>
          selected === 'THIS'
            ? Promise.resolve(
                '이번 회차만 휴지통으로 옮겨요. 30일 안에 되돌릴 수 있어요.',
              )
            : previewSeriesDelete(task.recurrence!, selected),
      })
      if (scope === null) return
      if (scope !== 'THIS') {
        try {
          if (await confirmAndDeleteSeries(task.recurrence, scope, true)) {
            dispatchTaskChanged({ reason: 'recurrence' })
            dispatchScheduleChanged({ reason: 'recurrence' })
            addToast('반복 작업을 지웠어요.', 'success')
            onClose()
          }
        } catch (err) {
          console.error('반복 작업 삭제 실패', err)
          addToast('반복 작업을 지우지 못했어요.', 'error')
        }
        return
      }
    } else if (
      !window.confirm(
        '작업을 휴지통으로 옮길까요?\n선후관계는 끊기고, 30일 안에 되돌리면 다시 이어져요.',
      )
    ) {
      return
    }
    try {
      // 반복 회차는 서버가 시작 전인 연결 일정도 함께 지운다(ADR-0019 §7).
      await deleteTask(task.id, false, task.version)
      removeTask(task.id)
      dispatchTaskChanged(task.id, 'delete')
      offerTaskUndo(task.id)
      onClose()
    } catch (err) {
      console.error('작업 삭제 실패', err)
      addToast('작업 삭제에 실패했습니다.', 'error')
    }
  }

  const handleAssignSchedule = async (
    payload: Parameters<typeof createScheduleFromTask>[1],
    expectedVersion?: number,
  ) => {
    if (!task) return
    try {
      await createScheduleFromTask(task.id, payload, expectedVersion)
      dispatchScheduleChanged({
        reason: 'task-assigned',
        scheduleId: undefined,
      })
      addToast('일정으로 배정했어요.', 'success')
      setShowScheduleModal(false)
    } catch (err) {
      console.error('작업 일정 배정 실패', err)
      addToast('일정으로 배정하지 못했습니다.', 'error')
      throw err
    }
  }

  return (
    <>
      <Modal
        embedded={embedded}
        backdropClassName="task-detail-modal__backdrop"
        className="task-detail-modal__content"
        onClose={onClose}
        labelledBy={titleId}
        ariaLabel="작업 상세"
      >
        {isLoading ? (
          <p className="task-detail-modal__loading">
            작업 정보를 불러오는 중...
          </p>
        ) : error || !task ? (
          <div className="task-detail-modal__body">
            <p className="task-detail-modal__loading">
              작업 정보를 불러오지 못했습니다.
            </p>
            <p className="task-detail-modal__description">{error}</p>
            <button
              type="button"
              className="task-detail-modal__action-btn task-detail-modal__action-btn--delete"
              onClick={onClose}
            >
              닫기
            </button>
          </div>
        ) : (
          <>
            <header className="task-detail-modal__header">
              <h1 id={titleId}>작업 상세</h1>
              <button
                className="task-detail-modal__close"
                onClick={(e) => {
                  e.stopPropagation()
                  onClose()
                }}
                aria-label="닫기"
              >
                <WorkspaceIcon name="close" />
              </button>
            </header>
            <div className="task-detail-modal__body">
              <section className="task-detail-modal__section">
                <h2>{task.title}</h2>
                {task.recurrence && (
                  <p className="task-detail-modal__description">
                    <span className="recurrence-badge">
                      <WorkspaceIcon name="repeat" /> 반복
                    </span>{' '}
                    {task.recurrence.occurrenceDate} 회차
                    {task.missed ? ' · 놓친 회차예요' : ''}
                  </p>
                )}
                <p className="task-detail-modal__description">
                  {task.description}
                </p>
                <div className="task-detail-modal__meta">
                  <CategoryBadge kind="task" itemId={task.id} />
                  <span>{task.assigneeNickname ?? '담당자 미정'}</span>
                  <span className="task-detail-modal__badge task-detail-modal__badge--state">
                    {(task.completed ?? task.isCompleted) ? '완료' : '미완료'}
                  </span>
                  <span
                    className="task-detail-modal__badge"
                    style={getImportanceStyle()}
                  >
                    중요도 {task.importance}
                  </span>
                  <span
                    className="task-detail-modal__badge"
                    style={getDifficultyStyle()}
                  >
                    난이도 {task.difficulty}
                  </span>
                  {formatIsoDurationLabel(task.effectiveExpectedDuration) && (
                    <span
                      className="task-detail-modal__badge"
                      title={
                        task.expectedDuration
                          ? '직접 입력한 예상 소요시간'
                          : '난이도 기준 예상 소요시간'
                      }
                    >
                      예상{' '}
                      {formatIsoDurationLabel(task.effectiveExpectedDuration)}
                    </span>
                  )}
                  {task.dueDate && (
                    <span
                      className="task-detail-modal__badge"
                      style={getDeadlineStyle(task.dueDate)}
                    >
                      마감 {formatDateWithOffset(task.dueDate, 'M/D')}
                    </span>
                  )}
                </div>
              </section>

              <section className="task-detail-modal__section">
                <h3>의존성</h3>
                <p className="task-detail-modal__description">
                  이전 작업: {task.previousTaskIds?.length ?? 0}개 / 이후 작업:{' '}
                  {task.nextTaskIds?.length ?? 0}개
                </p>
                {!(task.completed ?? task.isCompleted) &&
                  (task.inboundDependencyCount ?? 0) > 0 && (
                    <p className="task-detail-modal__description">
                      아직 끝나지 않은 이전 작업이 {task.inboundDependencyCount}
                      개 있어요. 모두 완료하면 바로 시작할 수 있어요.
                    </p>
                  )}
              </section>

              <footer className="task-detail-modal__actions">
                <button
                  type="button"
                  disabled={!task.allowedActions?.edit}
                  onClick={() => {
                    open(`/app/tasks/${task.id}/edit`)
                  }}
                  className="task-detail-modal__action-btn task-detail-modal__action-btn--edit"
                >
                  <WorkspaceIcon name="edit" /> 수정
                </button>
                <button
                  type="button"
                  onClick={toggleCompletion}
                  className="task-detail-modal__action-btn task-detail-modal__action-btn--primary"
                  disabled={
                    isToggling ||
                    !(task.isCompleted
                      ? task.allowedActions?.reopen
                      : task.allowedActions?.complete)
                  }
                >
                  {task.isCompleted ? '미완료로 전환' : '완료 처리'}
                </button>
                <button
                  type="button"
                  disabled={!task.allowedActions?.schedule}
                  onClick={() => setShowScheduleModal(true)}
                  className="task-detail-modal__action-btn"
                >
                  <WorkspaceIcon name="calendar" /> 일정으로 배정
                </button>
                <button
                  type="button"
                  disabled={!task.allowedActions?.delete}
                  onClick={handleDelete}
                  className="task-detail-modal__action-btn task-detail-modal__action-btn--delete"
                >
                  <WorkspaceIcon name="trash" /> 삭제
                </button>
              </footer>
            </div>
          </>
        )}
      </Modal>
      {recurrenceScope.dialog}
      <TaskScheduleModal
        isOpen={showScheduleModal}
        expectedVersion={task?.version}
        onClose={() => setShowScheduleModal(false)}
        onSubmit={handleAssignSchedule}
        defaultTitle={task?.title}
        defaultDescription={task?.description}
        taskLabel={task ? `작업 #${task.id}` : undefined}
      />
    </>
  )
}

export default TaskDetailModal
