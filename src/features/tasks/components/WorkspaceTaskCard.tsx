import { useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Task } from '../types/task'
import { completeTask, reopenTask, fetchTaskDetail } from '../api/tasks'
import { useTaskCache } from '@contexts/TaskCacheContext'
import {
  dispatchTaskChanged,
  dispatchScheduleChanged,
} from '@shared/utils/events'
import { formatDateWithOffset } from '@shared/utils/datetime'
import { formatIsoDurationLabel } from '@shared/utils/isoDuration'
import { cardPath } from '@features/spaces/cardPath'
import { CONFLICT_RELOADED, isEditConflict } from '@features/spaces/conflicts'
import SpacePath from '@features/spaces/SpacePath'
import { routeScope } from '@features/spaces/scope'
import { useSpaces } from '@features/spaces/store'
import { useLocation } from 'react-router-dom'
import WorkspaceIcon from '@shared/components/common/WorkspaceIcon'
import CompletionCheck from '@shared/components/motion/CompletionCheck'
import './WorkspaceTaskCard.css'
import { saveTaskCompletion } from '../utils/taskCompletion'
import { getRequestFailureMessage } from '@shared/api/errorMessage'
export default function WorkspaceTaskCard({
  task,
  onOpen,
  onAssign,
}: {
  task: Task
  onOpen: () => void
  onAssign?: () => void
}) {
  const { tasksById, setTask } = useTaskCache()
  const { pathname } = useLocation()
  const { selectedSpaceId, selectedProjectId, spaces, projects } = useSpaces()
  const item = tasksById[task.id] ?? task
  const done = item.completed ?? item.isCompleted ?? false
  const [pending, setPending] = useState(false),
    [error, setError] = useState<string | null>(null)
  const [refreshOnly, setRefreshOnly] = useState(false)
  // The state the person asked for, shown at once while the save runs. Cleared when the save
  // settles: on success the cache holds the same value, on failure the check rolls back.
  const [optimisticDone, setOptimisticDone] = useState<boolean | null>(null)
  const shownDone = optimisticDone ?? done
  const lock = useRef(false)
  const toggle = async () => {
    if (lock.current) return
    lock.current = true
    setPending(true)
    setOptimisticDone(!done)
    setError(null)
    setRefreshOnly(false)
    try {
      const result = await saveTaskCompletion(item, {
        mutate: done ? reopenTask : completeTask,
        refresh: fetchTaskDetail,
        onSaved: (saved) => {
          setTask(saved)
          dispatchTaskChanged({ taskId: item.id, reason: 'state-mutated' })
          dispatchScheduleChanged({ reason: 'task-state-mutated' })
        },
      })
      setTask(result.task)
      setError(result.refreshError)
      setRefreshOnly(result.refreshError !== null)
    } catch (e) {
      if (isEditConflict(e)) {
        // 다른 참여자가 먼저 바꿨다. 최신 작업을 캐시에 넣어 카드와 다음 시도가 새 버전을 쓰게 한다.
        // 목록 전체를 다시 받으면 카드가 다시 그려져 안내가 사라지므로 이벤트는 보내지 않는다. 자동으로 다시 보내지 않는다.
        setError(CONFLICT_RELOADED)
        try {
          setTask(await fetchTaskDetail(item.id))
        } catch {
          setError('다른 참여자가 먼저 수정했어요. 최신 내용을 불러오지 못했어요.')
          setRefreshOnly(true)
        }
      } else
        setError(
          getRequestFailureMessage(
            e,
            '작업 상태를 바꾸지 못했어요. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.',
          ),
        )
    } finally {
      lock.current = false
      setPending(false)
      setOptimisticDone(null)
    }
  }
  const refreshDetail = async () => {
    if (lock.current) return
    lock.current = true
    setPending(true)
    try {
      setTask(await fetchTaskDetail(item.id))
      setError(null)
      setRefreshOnly(false)
    } catch {
      setError('상태는 저장되었지만 최신 정보를 불러오지 못했어요.')
    } finally {
      lock.current = false
      setPending(false)
    }
  }
  return (
    <article
      className={'workspace-task' + (shownDone ? ' is-completed' : '')}
      aria-busy={pending || undefined}
    >
      {/* Permission decides disabled; a pending save does not, so the check never dims mid-stroke. */}
      <CompletionCheck
        className="workspace-task__check"
        checked={shownDone}
        disabled={
          !(done ? item.allowedActions?.reopen : item.allowedActions?.complete)
        }
        onChange={() => void toggle()}
        label={item.title + (shownDone ? ' 완료 취소' : ' 완료')}
      />
      <div className="workspace-task__copy">
        <button className="workspace-task__title" onClick={onOpen}>
          <span className="motion-strike" data-done={shownDone || undefined}>
            {item.title}
          </span>
        </button>
        <div className="workspace-task__meta">
          <SpacePath
            path={cardPath(
              routeScope(pathname),
              { spaceId: selectedSpaceId, projectId: selectedProjectId },
              item,
              spaces,
              projects,
            )}
          />
          <span>{item.assigneeNickname ?? '담당자 미정'}</span>
          {item.recurrence && <span>반복</span>}
          {!shownDone && (item.inboundDependencyCount ?? 0) > 0 && (
            <span>이전 작업 {item.inboundDependencyCount}개 남음</span>
          )}
        </div>
        {(item.previousTaskIds?.length ?? 0) + (item.nextTaskIds?.length ?? 0) >
          0 && (
          <button className="workspace-task__connection" onClick={onOpen}>
            <WorkspaceIcon name="map" />
            이전 {item.previousTaskIds?.length ?? 0} · 다음{' '}
            {item.nextTaskIds?.length ?? 0}
          </button>
        )}
        <details className="workspace-task__description">
          <summary>
            설명 · 예상{' '}
            {formatIsoDurationLabel(item.effectiveExpectedDuration) ??
              '시간 미입력'}
          </summary>
          <p>{item.description || '등록된 설명이 없어요.'}</p>
          {onAssign && !shownDone && item.allowedActions?.schedule && (
            <button className="workspace-button" onClick={onAssign}>
              일정 배정
            </button>
          )}
        </details>
      </div>
      <div className="workspace-task__side">
        <span>
          {shownDone ? '완료' : formatDateWithOffset(item.dueDate, 'M/D') + ' 마감'}
        </span>
        <div className="workspace-task__meters">
          {[
            [item.importance, 9, '중요도'],
            [item.difficulty, 21, '난이도'],
          ].map(([value, max, label], i) => (
            <span
              key={label}
              className={'workspace-meter workspace-meter--' + i}
              style={
                {
                  '--fill':
                    Math.min(100, (Number(value) / Number(max)) * 100) + '%',
                } as CSSProperties
              }
              aria-label={label + ' ' + value + ' / ' + max}
            >
              {value}
            </span>
          ))}
        </div>
      </div>
      {error && (
        <div
          className="workspace-inline-error workspace-task__error"
          role="alert"
        >
          <span>{error}</span>
          <button
            disabled={pending}
            onClick={() => void (refreshOnly ? refreshDetail() : toggle())}
          >
            {refreshOnly ? '정보 다시 불러오기' : '다시 시도'}
          </button>
        </div>
      )}
    </article>
  )
}
