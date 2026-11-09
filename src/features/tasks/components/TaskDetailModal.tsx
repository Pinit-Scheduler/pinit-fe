import WorkspaceIcon from '@shared/components/common/WorkspaceIcon'
import { cardPath } from '@features/spaces/cardPath'
import SpacePath from '@features/spaces/SpacePath'
import { isEditConflict } from '@features/spaces/conflicts'
import { useEffect, useState, useId, useRef } from 'react'
import type { CSSProperties } from 'react'
import Modal from '@shared/components/common/Modal'
import CompletionCheck from '@shared/components/motion/CompletionCheck'
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
import { isResourceUnavailable } from '@features/spaces/metadata'
import { useSpaces } from '@features/spaces/store'
import UnavailableNote from '@features/spaces/UnavailableNote'
import { adminNames, unavailableLines } from '@features/spaces/unavailable'
import { useArrival } from '../utils/useArrival'
import { detailRefreshNeeded } from '../utils/taskDetailRefresh'

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
  const { spaces, projects } = useSpaces()
  // What this modal read itself, for this id. The cache (seeded by lists, updated by every save)
  // is shown first, so opening a known task never flashes a loading line (audit A6).
  const [fetched, setFetched] = useState<{
    id: number
    task: Task | null
    error: string | null
  } | null>(null)
  const own = fetched?.id === taskId ? fetched : null
  const task: Task | null = tasksById[taskId] ?? own?.task ?? null
  const error = own?.error ?? null
  const isLoading = !task && !error
  const [showScheduleModal, setShowScheduleModal] = useState(false)
  const [revision, setRevision] = useState(0)
  // Completion shown at once while the save runs; cleared when it settles (rolls back on failure).
  const [optimistic, setOptimistic] = useState<{
    id: number
    done: boolean
  } | null>(null)
  const ownToggles = useRef(0)
  const relatedIds = useRef<number[]>([])
  useEffect(() => {
    relatedIds.current = [
      ...(task?.previousTaskIds ?? []),
      ...(task?.nextTaskIds ?? []),
    ]
  })
  const recurrenceScope = useRecurrenceScope()

  useEffect(
    () =>
      onTaskChanged((_detail, details) => {
        const next = detailRefreshNeeded(
          details,
          taskId,
          relatedIds.current,
          ownToggles.current,
        )
        ownToggles.current = next.ownToggles
        if (next.refetch) setRevision((value) => value + 1)
      }),
    [taskId],
  )

  useEffect(() => {
    let mounted = true
    // A background read: whatever is on screen stays until the answer arrives.
    fetchTaskDetail(taskId)
      .then((data) => {
        if (!mounted) return
        setFetched({ id: taskId, task: data, error: null })
        setTask(data)
      })
      .catch((err) => {
        if (!mounted) return
        if (isResourceUnavailable('task', taskId)) removeTask(taskId)
        setFetched({
          id: taskId,
          task: null,
          error:
            err instanceof Error ? err.message : '작업을 불러오지 못했습니다.',
        })
      })
    return () => {
      mounted = false
    }
  }, [setTask, removeTask, taskId, revision])

  const savedDone = task ? (task.completed ?? task.isCompleted ?? false) : false
  const shownDone =
    optimistic && task && optimistic.id === task.id ? optimistic.done : savedDone
  const arriving = useArrival(isLoading, taskId)

  const toggleCompletion = async () => {
    if (!task || toggleLock.current) return
    toggleLock.current = true
    setOptimistic({ id: task.id, done: !savedDone })
    try {
      const next = savedDone
        ? await reopenTask(task.id, task.version)
        : await completeTask(task.id, task.version)
      const nextCompleted = next.completed ?? next.isCompleted ?? false
      setFetched({ id: next.id, task: next, error: null })
      setTask(next)
      ownToggles.current++
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
      setOptimistic(null)
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
    try {
      if (expectedVersion === undefined)
        throw new Error('작업을 다시 연 뒤 일정에 배정해 주세요. 입력한 내용은 유지됩니다.')
      await createScheduleFromTask(taskId, payload, expectedVersion)
      dispatchScheduleChanged({
        reason: 'task-assigned',
        scheduleId: undefined,
      })
      addToast('일정으로 배정했어요.', 'success')
      setShowScheduleModal(false)
    } catch (err) {
      console.error('작업 일정 배정 실패', err)
      // 충돌은 배정 창이 안내하고 최신 버전을 받는다.
      if (!isEditConflict(err)) addToast('일정으로 배정하지 못했습니다.', 'error')
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
          <p
            className="task-detail-modal__loading task-detail-modal__loading--wait"
            role="status"
          >
            작업 정보를 불러오는 중...
          </p>
        ) : !task ? (
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
            <div
              className="task-detail-modal__body"
              data-arrive={arriving || undefined}
            >
              {error && (
                <p className="task-detail-modal__notice" role="alert">
                  {error}
                </p>
              )}
              <section
                className="task-detail-modal__section"
                style={{ '--arrive-index': 0 } as CSSProperties}
              >
                <div className="task-detail-modal__title-row">
                  <CompletionCheck
                    className="task-detail-modal__check"
                    checked={shownDone}
                    disabled={
                      !(savedDone
                        ? task.allowedActions?.reopen
                        : task.allowedActions?.complete)
                    }
                    onChange={() => void toggleCompletion()}
                    label={task.title + (shownDone ? ' 완료 취소' : ' 완료')}
                  />
                  <h2
                    className={
                      'task-detail-modal__title' +
                      (shownDone ? ' is-completed' : '')
                    }
                  >
                    <span
                      className="motion-strike"
                      data-done={shownDone || undefined}
                    >
                      {task.title}
                    </span>
                  </h2>
                </div>
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
                  <SpacePath
                    path={cardPath(
                      'all',
                      { spaceId: null, projectId: null },
                      task,
                      spaces,
                      projects,
                    )}
                  />
                  <span>{task.assigneeNickname ?? '담당자 미정'}</span>
                  <span
                    className="task-detail-modal__badge task-detail-modal__badge--state"
                    data-done={shownDone || undefined}
                  >
                    {shownDone ? '완료' : '미완료'}
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

              <section
                className="task-detail-modal__section"
                style={{ '--arrive-index': 1 } as CSSProperties}
              >
                <h3>의존성</h3>
                <p className="task-detail-modal__description">
                  이전 작업: {task.previousTaskIds?.length ?? 0}개 / 이후 작업:{' '}
                  {task.nextTaskIds?.length ?? 0}개
                </p>
                {!shownDone &&
                  (task.inboundDependencyCount ?? 0) > 0 && (
                    <p className="task-detail-modal__description">
                      아직 끝나지 않은 이전 작업이 {task.inboundDependencyCount}
                      개 있어요. 모두 완료하면 바로 시작할 수 있어요.
                    </p>
                  )}
              </section>

              <footer
                className="task-detail-modal__actions"
                style={{ '--arrive-index': 2 } as CSSProperties}
              >
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
                  onClick={() => void toggleCompletion()}
                  className="task-detail-modal__action-btn task-detail-modal__action-btn--primary"
                  aria-busy={optimistic !== null || undefined}
                  disabled={
                    !(savedDone
                      ? task.allowedActions?.reopen
                      : task.allowedActions?.complete)
                  }
                >
                  {shownDone ? '미완료로 전환' : '완료 처리'}
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
                {unavailableLines(
                  [
                    {
                      off: task.allowedActions?.edit === false,
                      reason: task.unavailableReasons?.edit,
                    },
                    {
                      off: task.isCompleted
                        ? task.allowedActions?.reopen === false
                        : task.allowedActions?.complete === false,
                      reason: task.isCompleted
                        ? task.unavailableReasons?.reopen
                        : task.unavailableReasons?.complete,
                    },
                    {
                      off: task.allowedActions?.schedule === false,
                      reason: task.unavailableReasons?.schedule,
                    },
                    {
                      off: task.allowedActions?.delete === false,
                      reason: task.unavailableReasons?.delete,
                    },
                  ],
                  adminNames(
                    spaces.find((space) => space.id === task.spaceId)
                      ?.members ?? [],
                  ),
                ).map((line) => (
                  <UnavailableNote key={line} text={line} />
                ))}
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
        onConflict={async () => {
          const latest = await fetchTaskDetail(taskId)
          setFetched({ id: taskId, task: latest, error: null })
          setTask(latest)
          return latest.version
        }}
        defaultTitle={task?.title}
        defaultDescription={task?.description}
        taskLabel={task ? `작업 #${task.id}` : undefined}
      />
    </>
  )
}

export default TaskDetailModal
