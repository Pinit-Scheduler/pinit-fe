import { reportEditConflict } from '@features/spaces/conflicts'
import { useSpaces } from '@features/spaces/store'
import UnavailableNote from '@features/spaces/UnavailableNote'
import { adminNames, unavailableLines } from '@features/spaces/unavailable'
import type { UnavailableReasons } from '@features/spaces/types'
import WorkspaceIcon from '@shared/components/common/WorkspaceIcon'
import { useRef, useState } from 'react'
import dayjs from 'dayjs'
import { useToast } from '@contexts/ToastContext'
import { getRequestFailureMessage } from '@shared/api/errorMessage'
import useRevalidatingQuery from '@shared/hooks/useRevalidatingQuery'
import { presenceProps, useListPresence, useTweenedNumber } from '@shared/motion'
import {
  formatDateTimeWithZone,
  formatDateWithOffset,
  toDisplayDayjs,
} from '@shared/utils/datetime'
import {
  dispatchScheduleChanged,
  dispatchTaskChanged,
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
import { isRestoreBatch, withoutSchedule, withoutTask } from '../utils/trashContents'
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

const TrashNotes = ({
  item,
}: {
  item: {
    spaceId?: number
    allowedActions?: { restore?: boolean; delete?: boolean }
    unavailableReasons?: UnavailableReasons
  }
}) => {
  const { spaces } = useSpaces()
  const admins = adminNames(
    spaces.find((space) => space.id === item.spaceId)?.members ?? [],
  )
  return unavailableLines(
    [
      {
        off: item.allowedActions?.restore === false,
        reason: item.unavailableReasons?.restore,
      },
      {
        off: item.allowedActions?.delete === false,
        reason: item.unavailableReasons?.delete,
      },
    ],
    admins,
  ).map((line) => <UnavailableNote key={line} text={line} />)
}

const purgeLabel = (purgeAt: DateTimeWithZone) =>
  purgeDaysLabel(toDisplayDayjs(purgeAt).diff(dayjs(), 'day'))

/** 묶음 제목의 개수는 행이 빠질 때 새 값으로 미끄러진다. 묶음이 처음 보일 때의 값은 그대로 보인다. */
const GroupTitle = ({ kind, count }: { kind: string; count: number }) => (
  <h2 className="trash__group-title">
    {kind} {Math.round(useTweenedNumber(count))}개
  </h2>
)

const TRASH_KEY = 'trash'

const loadTrash = () => fetchTrash()

const loadErrorMessage = (loadError: unknown) => {
  console.error('휴지통 조회 실패', loadError)
  return getRequestFailureMessage(loadError, '휴지통을 불러오지 못했어요. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.')
}

/**
 * 설정 → 휴지통(ADR-0024 §13). 지운 작업·일정을 30일 동안 보여 주고, 복구하거나 바로 영구 삭제한다.
 * 작업과 함께 지운 일정은 그 작업 아래에 보이고, 작업을 복구하면 함께 돌아온다.
 * 다시 읽는 동안에도 목록은 그대로 두고, 복구·삭제한 행만 그 자리에서 사라진다.
 */
const TrashPage = () => {
  const { spaces } = useSpaces()
  const lock = useRef(false)
  const { addToast } = useToast()
  const [pendingKey, setPendingKey] = useState<string | null>(null)
  const {
    data: contents,
    error,
    isInitialLoading,
    isRefreshing,
    refetch,
    setData,
  } = useRevalidatingQuery<TrashContents>(TRASH_KEY, loadTrash, {
    // 이 화면에 있는 동안 삭제 토스트의 "되돌리기"로 복구하면 목록에서도 빠져야 한다.
    invalidateOn: ['task', 'schedule'],
    shouldRefetch: isRestoreBatch,
    errorMessage: loadErrorMessage,
  })

  const taskRows = useListPresence(contents?.tasks, (task) => task.taskId)
  const scheduleRows = useListPresence(
    contents?.schedules,
    (schedule) => schedule.scheduleId,
  )

  /**
   * 한 번에 하나만 처리한다(ref 잠금). 버튼을 막아 목록 전체를 흐리게 하지 않는다.
   * 성공하면 그 행을 바로 빼고(사라지는 애니메이션), 서버 목록으로 다시 맞춘다.
   * 복구는 변경 이벤트가 다시 읽기를 부르므로 따로 다시 읽지 않는다.
   */
  const run = async (
    key: string,
    work: () => Promise<string | null>,
    settle: (current: TrashContents) => TrashContents = (current) => current,
    { notifies = false }: { notifies?: boolean } = {},
  ) => {
    if (lock.current) return
    lock.current = true
    setPendingKey(key)
    try {
      const message = await work()
      setData((previous) =>
        previous ? settle(previous) : (previous as unknown as TrashContents),
      )
      if (message) addToast(message, 'success')
      if (!notifies) refetch()
    } catch (runError) {
      if (reportEditConflict(runError)) {
        refetch()
        return
      }
      console.error('휴지통 작업 실패', runError)
      addToast(
        getRequestFailureMessage(
          runError,
          '요청을 처리하지 못했어요. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.',
        ),
        'error',
      )
      refetch()
    } finally {
      lock.current = false
      setPendingKey(null)
    }
  }

  const onRestoreTask = (task: TrashedTask) =>
    run(
      `task-${task.taskId}`,
      async () => {
        const result = await restoreTask(task.taskId, task.version)
        dispatchTaskChanged(task.taskId, 'restore')
        dispatchScheduleChanged({ reason: 'restore' })
        return result
          ? restoreTaskMessage(result.skippedDependencies)
          : '작업을 복구했어요.'
      },
      (current) => withoutTask(current, task.taskId),
      { notifies: true },
    )

  const onRestoreSchedule = (schedule: TrashedSchedule) =>
    run(
      `schedule-${schedule.scheduleId}`,
      async () => {
        await restoreSchedule(schedule.scheduleId, schedule.version)
        dispatchScheduleChanged({
          reason: 'restore',
          scheduleId: schedule.scheduleId,
        })
        return '일정을 되돌렸어요.'
      },
      (current) => withoutSchedule(current, schedule.scheduleId),
      { notifies: true },
    )

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
    void run(
      `task-${task.taskId}`,
      async () => {
        await purgeTask(task.taskId, task.version)
        return '영구 삭제했어요.'
      },
      (current) => withoutTask(current, task.taskId),
    )
  }

  const onPurgeSchedule = (schedule: TrashedSchedule) => {
    if (
      !window.confirm(
        `"${schedule.title}" 일정을 영구 삭제할까요?\n되돌릴 수 없어요.`,
      )
    )
      return
    void run(
      `schedule-${schedule.scheduleId}`,
      async () => {
        await purgeSchedule(schedule.scheduleId, schedule.version)
        return '영구 삭제했어요.'
      },
      (current) => withoutSchedule(current, schedule.scheduleId),
    )
  }

  const onEmpty = () => {
    if (
      !window.confirm(
        '개인 휴지통의 작업과 일정을 영구 삭제할까요? 공유 스페이스 항목은 남아 있어요.\n되돌릴 수 없어요.',
      )
    )
      return
    // 어느 항목이 개인 휴지통인지는 서버가 정한다. 다시 읽은 목록에서 빠진 행이 사라진다.
    void run('empty', async () => {
      await emptyTrash()
      return '휴지통을 비웠어요.'
    })
  }

  // 사라지는 행이 남아 있는 동안에는 "비어 있어요"를 띄우지 않는다.
  const isEmpty =
    contents !== undefined && taskRows.length === 0 && scheduleRows.length === 0
  const hasItems =
    contents !== undefined &&
    (contents.tasks.length > 0 || contents.schedules.length > 0)

  return (
    <section className="trash" aria-busy={isRefreshing || undefined}>
      <header className="trash__header">
        <p className="trash__eyebrow">설정</p>
        <h1 className="trash__title">휴지통</h1>
        <p className="trash__description">
          지운 작업과 일정은 {contents?.retentionDays ?? 30}일 동안 여기에
          있다가 자동으로 영구 삭제돼요. 그 전에는 언제든 복구할 수 있어요.
          반복을 "이번 및 이후"·"전체"로 지운 회차는 휴지통에 남지 않아요.
        </p>
        {hasItems && (
          <div className="trash__toolbar">
            <button
              type="button"
              className="trash__button is-danger"
              onClick={onEmpty}
              aria-busy={pendingKey === 'empty' || undefined}
            >
              개인 휴지통만 비우기
            </button>
          </div>
        )}
      </header>

      {error && (
        <div
          className="trash__placeholder trash__placeholder--notice"
          role="alert"
        >
          {error}{' '}
          <button type="button" className="trash__link" onClick={refetch}>
            다시 시도
          </button>
        </div>
      )}
      {isInitialLoading && (
        <div className="trash__placeholder trash__placeholder--loading">
          휴지통을 불러오는 중...
        </div>
      )}
      {!error && isEmpty && (
        <div className="trash__placeholder trash__placeholder--notice">
          휴지통이 비어 있어요.
        </div>
      )}

      {taskRows.length > 0 && (
        <section className="trash__group" aria-label="지운 작업">
          <GroupTitle kind="작업" count={contents?.tasks.length ?? 0} />
          <ul className="trash__list">
            {taskRows.map(({ key, item: task, phase }) => (
              <li
                key={key}
                className="trash__item"
                aria-busy={pendingKey === `task-${task.taskId}` || undefined}
                {...presenceProps(phase)}
              >
                <div className="trash__item-head">
                  <p className="trash__item-title">
                    {task.recurrence && <WorkspaceIcon name="repeat" />}
                    {task.title}
                    {task.completed && <span className="trash__tag">완료</span>}
                  </p>
                  <p className="trash__item-meta">
                    {spaces.find((space) => space.id === task.spaceId)?.name ??
                      '스페이스'}{' '}
                    · 마감 {formatDateWithOffset(task.dueDate, 'M월 D일')} ·{' '}
                    {formatDateTimeWithZone(task.deletedAt)}에 지움 ·{' '}
                    <span className="trash__purge">
                      {purgeLabel(task.purgeAt)}
                    </span>
                  </p>
                  {task.schedules.length > 0 && (
                    <ul className="trash__sublist" aria-label="함께 지운 일정">
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
                    disabled={task.allowedActions?.restore === false}
                  >
                    복구
                  </button>
                  <button
                    type="button"
                    className="trash__button is-danger"
                    onClick={() => onPurgeTask(task)}
                    disabled={task.allowedActions?.delete === false}
                  >
                    영구 삭제
                  </button>
                </div>
                <TrashNotes item={task} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {scheduleRows.length > 0 && (
        <section className="trash__group" aria-label="지운 일정">
          <GroupTitle kind="일정" count={contents?.schedules.length ?? 0} />
          <ul className="trash__list">
            {scheduleRows.map(({ key, item: schedule, phase }) => (
              <li
                key={key}
                className="trash__item"
                aria-busy={
                  pendingKey === `schedule-${schedule.scheduleId}` || undefined
                }
                {...presenceProps(phase)}
              >
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
                    disabled={schedule.allowedActions?.restore === false}
                  >
                    복구
                  </button>
                  <button
                    type="button"
                    className="trash__button is-danger"
                    onClick={() => onPurgeSchedule(schedule)}
                    disabled={schedule.allowedActions?.delete === false}
                  >
                    영구 삭제
                  </button>
                </div>
                <TrashNotes item={schedule} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  )
}

export default TrashPage
