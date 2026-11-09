import { isEditConflict } from '@features/spaces/conflicts'
import { useSpaces } from '@features/spaces/store'
import WorkspaceIcon from '@shared/components/common/WorkspaceIcon'
import { useCallback, useEffect, useState, useRef } from 'react'
import dayjs from 'dayjs'
import { useToast } from '@contexts/ToastContext'
import { ApiError } from '@shared/api/httpClient'
import {
  formatDateTimeWithZone,
  formatDateWithOffset,
  toDisplayDayjs,
} from '@shared/utils/datetime'
import {
  dispatchScheduleChanged,
  dispatchTaskChanged,
  onScheduleChanged,
  onTaskChanged,
} from '@shared/utils/events'
import type { DateTimeWithZone } from '@shared/types/datetime'
import {
  emptyTrash,
  fetchTrash,
  purgeSchedule,
  purgeTask,
  restoreSchedule,
  restoreTask,
} from '../api/trash'
import { purgeDaysLabel, restoreTaskMessage } from '../utils/trashLabels'
import type {
  TrashContents,
  TrashedSchedule,
  TrashedTask,
} from '../types/trash'
import './TrashPage.css'

const STATE_LABEL: Record<string, string> = {
  NOT_STARTED: '시작 전',
  COMPLETED: '완료',
}

const purgeLabel = (purgeAt: DateTimeWithZone) =>
  purgeDaysLabel(toDisplayDayjs(purgeAt).diff(dayjs(), 'day'))

/**
 * 설정 → 휴지통(ADR-0024 §13). 지운 작업·일정을 30일 동안 보여 주고, 복구하거나 바로 영구 삭제한다.
 * 작업과 함께 지운 일정은 그 작업 아래에 보이고, 작업을 복구하면 함께 돌아온다.
 */
const TrashPage = () => {
  const { spaces } = useSpaces()
  const lock = useRef(false)
  const { addToast } = useToast()
  const [contents, setContents] = useState<TrashContents | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      setContents(await fetchTrash())
    } catch (loadError) {
      console.error('휴지통 조회 실패', loadError)
      setError('휴지통을 불러오지 못했어요.')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // 이 화면에 있는 동안 삭제 토스트의 "되돌리기"로 복구하면 목록에서도 빠져야 한다.
  useEffect(() => {
    const reloadOnRestore = (detail: { reason?: string }) => {
      if (detail.reason === 'restore') void load()
    }
    const offTask = onTaskChanged(reloadOnRestore)
    const offSchedule = onScheduleChanged(reloadOnRestore)
    return () => {
      offTask()
      offSchedule()
    }
  }, [load])

  const run = async (key: string, work: () => Promise<string | null>) => {
    if (lock.current) return
    lock.current = true
    setBusyKey(key)
    try {
      const message = await work()
      if (message) addToast(message, 'success')
      await load()
    } catch (runError) {
      if (isEditConflict(runError)) return
      console.error('휴지통 작업 실패', runError)
      addToast(
        runError instanceof ApiError && runError.status === 404
          ? '이미 복구했거나 삭제된 항목이에요. 목록을 다시 불러올게요.'
          : '요청을 처리하지 못했어요.',
        'error',
      )
      await load()
    } finally {
      lock.current = false
      setBusyKey(null)
    }
  }

  const onRestoreTask = (task: TrashedTask) =>
    run(`task-${task.taskId}`, async () => {
      const result = await restoreTask(task.taskId, task.version)
      dispatchTaskChanged(task.taskId, 'restore')
      dispatchScheduleChanged({ reason: 'restore' })
      return result
        ? restoreTaskMessage(result.skippedDependencies)
        : '작업을 복구했어요.'
    })

  const onRestoreSchedule = (schedule: TrashedSchedule) =>
    run(`schedule-${schedule.scheduleId}`, async () => {
      await restoreSchedule(schedule.scheduleId, schedule.version)
      dispatchScheduleChanged({
        reason: 'restore',
        scheduleId: schedule.scheduleId,
      })
      return '일정을 되돌렸어요.'
    })

  const onPurgeTask = (task: TrashedTask) => {
    const withSchedules = task.schedules.length
      ? ` 함께 지운 일정 ${task.schedules.length}개도 지워져요.`
      : ''
    if (
      !window.confirm(
        `"${task.title}" 작업을 영구 삭제할까요?${withSchedules}\n되돌릴 수 없어요.`,
      )
    )
      return
    void run(`task-${task.taskId}`, async () => {
      await purgeTask(task.taskId, task.version)
      return '영구 삭제했어요.'
    })
  }

  const onPurgeSchedule = (schedule: TrashedSchedule) => {
    if (
      !window.confirm(
        `"${schedule.title}" 일정을 영구 삭제할까요?\n되돌릴 수 없어요.`,
      )
    )
      return
    void run(`schedule-${schedule.scheduleId}`, async () => {
      await purgeSchedule(schedule.scheduleId, schedule.version)
      return '영구 삭제했어요.'
    })
  }

  const onEmpty = () => {
    if (
      !window.confirm(
        '개인 휴지통의 작업과 일정을 영구 삭제할까요? 공유 스페이스 항목은 남아 있어요.\n되돌릴 수 없어요.',
      )
    )
      return
    void run('empty', async () => {
      await emptyTrash()
      return '휴지통을 비웠어요.'
    })
  }

  const isEmpty =
    contents !== null &&
    contents.tasks.length === 0 &&
    contents.schedules.length === 0

  return (
    <section className="trash">
      <header className="trash__header">
        <p className="trash__eyebrow">설정</p>
        <h1 className="trash__title">휴지통</h1>
        <p className="trash__description">
          지운 작업과 일정은 {contents?.retentionDays ?? 30}일 동안 여기에
          있다가 자동으로 영구 삭제돼요. 그 전에는 언제든 복구할 수 있어요.
          반복을 "이번 및 이후"·"전체"로 지운 회차는 휴지통에 남지 않아요.
        </p>
        {contents && !isEmpty && (
          <div className="trash__toolbar">
            <button
              type="button"
              className="trash__button is-danger"
              onClick={onEmpty}
              disabled={busyKey !== null}
            >
              개인 휴지통만 비우기
            </button>
          </div>
        )}
      </header>

      {error && (
        <div className="trash__placeholder" role="alert">
          {error}{' '}
          <button
            type="button"
            className="trash__link"
            onClick={() => void load()}
          >
            다시 시도
          </button>
        </div>
      )}
      {!error && contents === null && (
        <div className="trash__placeholder">휴지통을 불러오는 중...</div>
      )}
      {!error && isEmpty && (
        <div className="trash__placeholder">휴지통이 비어 있어요.</div>
      )}

      {contents && contents.tasks.length > 0 && (
        <section className="trash__group" aria-label="지운 작업">
          <h2 className="trash__group-title">작업 {contents.tasks.length}개</h2>
          <ul className="trash__list">
            {contents.tasks.map((task) => {
              const key = `task-${task.taskId}`
              return (
                <li key={key} className="trash__item">
                  <div className="trash__item-head">
                    <p className="trash__item-title">
                      {task.recurrence && <WorkspaceIcon name="repeat" />}
                      {task.title}
                      {task.completed && (
                        <span className="trash__tag">완료</span>
                      )}
                    </p>
                    <p className="trash__item-meta">
                      {spaces.find((space) => space.id === task.spaceId)
                        ?.name ?? '스페이스'}{' '}
                      · 마감 {formatDateWithOffset(task.dueDate, 'M월 D일')} ·{' '}
                      {formatDateTimeWithZone(task.deletedAt)}에 지움 ·{' '}
                      <span className="trash__purge">
                        {purgeLabel(task.purgeAt)}
                      </span>
                    </p>
                    {task.schedules.length > 0 && (
                      <ul
                        className="trash__sublist"
                        aria-label="함께 지운 일정"
                      >
                        {task.schedules.map((schedule) => (
                          <li key={schedule.scheduleId}>
                            일정 · {schedule.title} ·{' '}
                            {formatDateTimeWithZone(schedule.date)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="trash__actions">
                    <button
                      type="button"
                      className="trash__button is-primary"
                      onClick={() => void onRestoreTask(task)}
                      disabled={
                        busyKey !== null ||
                        task.allowedActions?.restore === false
                      }
                    >
                      복구
                    </button>
                    <button
                      type="button"
                      className="trash__button is-danger"
                      onClick={() => onPurgeTask(task)}
                      disabled={
                        busyKey !== null ||
                        task.allowedActions?.delete === false
                      }
                    >
                      영구 삭제
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {contents && contents.schedules.length > 0 && (
        <section className="trash__group" aria-label="지운 일정">
          <h2 className="trash__group-title">
            일정 {contents.schedules.length}개
          </h2>
          <ul className="trash__list">
            {contents.schedules.map((schedule) => {
              const key = `schedule-${schedule.scheduleId}`
              return (
                <li key={key} className="trash__item">
                  <div className="trash__item-head">
                    <p className="trash__item-title">
                      {schedule.recurrence && <WorkspaceIcon name="repeat" />}
                      {schedule.title}
                      <span className="trash__tag">
                        {STATE_LABEL[schedule.state] ?? schedule.state}
                      </span>
                    </p>
                    <p className="trash__item-meta">
                      {spaces.find((space) => space.id === schedule.spaceId)
                        ?.name ?? '스페이스'}{' '}
                      · {formatDateTimeWithZone(schedule.date)} 일정 ·{' '}
                      {formatDateTimeWithZone(schedule.deletedAt)}에 지움 ·{' '}
                      <span className="trash__purge">
                        {purgeLabel(schedule.purgeAt)}
                      </span>
                    </p>
                  </div>
                  <div className="trash__actions">
                    <button
                      type="button"
                      className="trash__button is-primary"
                      onClick={() => void onRestoreSchedule(schedule)}
                      disabled={
                        busyKey !== null ||
                        schedule.allowedActions?.restore === false
                      }
                    >
                      복구
                    </button>
                    <button
                      type="button"
                      className="trash__button is-danger"
                      onClick={() => onPurgeSchedule(schedule)}
                      disabled={
                        busyKey !== null ||
                        schedule.allowedActions?.delete === false
                      }
                    >
                      영구 삭제
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </section>
  )
}

export default TrashPage
