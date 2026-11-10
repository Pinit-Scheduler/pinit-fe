import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import Modal from '@shared/components/common/Modal'
import { presenceProps, useListPresence } from '@shared/motion'
import { assignTask, fetchUnassignedTasks } from '@features/tasks/api/tasks'
import UnavailableNote from '../UnavailableNote'
import { CONFLICT_RELOADED, isEditConflict } from '../conflicts'
import { adminNames, unavailableText } from '../unavailable'
import type { Project, Space } from '../types'
import {
  ASSIGN_PAGE_SIZE,
  assignReducer,
  assigneeOptions,
  assignRows,
  chosenAssignee,
  initialAssignState,
  nextAssignPage,
  outOfSync,
  reloadAfterFailure,
  shouldLoadMore,
} from './assign'

/**
 * 허브의 담당자 미정 작업을 한 개씩 배정한다(시안 `hubOpenAssignV18`).
 * 목록은 BE의 담당자 미정 조건으로 받고, 남은 수는 요약(`openCount`)이 정한다. FE는 세지 않는다.
 * 상태 변화 규칙은 `assign.ts`의 `assignReducer`에 있다.
 */
export default function AssignUnassignedDialog({
  space,
  meId,
  projects,
  openCount,
  onClose,
  onAssigned,
  onStale,
  closing = false,
}: {
  space: Space
  meId: number | null
  projects: Project[]
  /** 요약의 담당자 미정 미완료 수. 요약을 못 받았으면 null. */
  openCount: number | null
  onClose: () => void
  onAssigned: () => void
  /** 목록과 요약 수가 어긋났거나 배정이 실패했을 때. 허브 요약을 다시 받는다. */
  onStale: () => void
  /** The dialog is playing its exit (usePresence in the parent). */
  closing?: boolean
}) {
  const [state, dispatch] = useReducer(assignReducer, initialAssignState)
  const { tasks, hasMore, loading, loadFailed, loaded, busyId, notice, offset } =
    state
  const [picked, setPicked] = useState<Record<number, number>>({})
  const request = useRef<AbortController | null>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  // 배정해 빠진 줄 대신 초점을 줄 곳. 버튼이 다시 켜진 뒤(busyId가 비면) 옮긴다.
  const focusAfter = useRef<number | 'close' | null>(null)
  // 어긋남 때문에 요약을 다시 부른 뒤에는 목록이 다시 찰 때까지 또 부르지 않는다.
  const resynced = useRef(false)

  const load = useCallback(
    (page: number, replace: boolean) => {
      request.current?.abort()
      const controller = new AbortController()
      request.current = controller
      dispatch({ type: 'load' })
      fetchUnassignedTasks({
        spaceId: space.id,
        page,
        size: ASSIGN_PAGE_SIZE,
        signal: controller.signal,
      })
        .then((response) => {
          if (!controller.signal.aborted)
            dispatch({ type: 'loaded', replace, response })
        })
        .catch(() => {
          if (!controller.signal.aborted) dispatch({ type: 'loadFailed' })
        })
    },
    [space.id],
  )

  useEffect(() => {
    // 첫 조회. 응답이 오면 상태를 바꾸고, 닫히면 요청을 끊는다.
    const timer = setTimeout(() => load(0, true), 0)
    return () => {
      clearTimeout(timer)
      request.current?.abort()
    }
  }, [load])

  const moreNeeded = shouldLoadMore(state)
  useEffect(() => {
    // 보이는 줄을 다 배정했는데 서버에 남은 작업이 있으면 바로 이어서 받는다.
    if (!moreNeeded) return
    const timer = setTimeout(() => load(nextAssignPage(offset), false), 0)
    return () => clearTimeout(timer)
  }, [moreNeeded, offset, load])

  const stale = outOfSync(state, openCount)
  useEffect(() => {
    if (tasks.length > 0) resynced.current = false
    if (!stale || resynced.current) return
    resynced.current = true
    onStale()
  }, [stale, tasks.length, onStale])

  useEffect(() => {
    if (busyId !== null || focusAfter.current === null) return
    const target =
      focusAfter.current === 'close'
        ? closeButton.current
        : document.getElementById(`hub-assign-${focusAfter.current}`)
    focusAfter.current = null
    target?.focus()
  }, [busyId, tasks])

  const options = assigneeOptions(space.members, meId)
  const rows = assignRows(tasks, projects)
  // An assigned task fades out of the list where it was; rows from "더 보기" rise in.
  const shown = useListPresence(loaded ? rows : undefined, (row) => row.id, {
    resetKey: space.id,
  })
  const admins = adminNames(space.members)

  const assign = async (row: (typeof rows)[number]) => {
    const memberId = chosenAssignee(picked[row.id], options)
    if (
      memberId === undefined ||
      row.version === undefined ||
      busyId !== null ||
      loading
    )
      return
    dispatch({ type: 'assigning', id: row.id })
    try {
      await assignTask(row.id, memberId, row.version)
      // 빠진 줄 대신 다음 줄(없으면 앞 줄, 그것도 없으면 닫기)로 초점을 옮긴다.
      const index = rows.findIndex((item) => item.id === row.id)
      const neighbour = rows[index + 1] ?? rows[index - 1]
      focusAfter.current = neighbour ? neighbour.id : 'close'
      dispatch({ type: 'assigned', id: row.id })
      onAssigned()
    } catch (failure) {
      const status = (failure as { status?: number } | null)?.status
      const text = isEditConflict(failure)
        ? CONFLICT_RELOADED
        : failure instanceof Error && failure.message
          ? failure.message
          : '배정하지 못했어요. 다시 시도해 주세요.'
      dispatch({ type: 'assignFailed', notice: `${row.title}: ${text}` })
      // 실패하면 허브 숫자도 낡았을 수 있다. 먼저 고쳐졌거나 사라진 작업이면 목록도 다시 받는다.
      onStale()
      if (reloadAfterFailure(status)) load(0, true)
    }
  }

  return (
    <Modal
      labelledBy="hub-assign-title"
      backdropClassName="space-dialog-backdrop"
      className="space-dialog hub-assign-dialog"
      onClose={busyId === null ? onClose : undefined}
      closing={closing}
    >
      <div className="space-dialog__header">
        <h2 id="hub-assign-title">
          {openCount === null
            ? '담당자 미정 작업'
            : `담당자 미정 작업 ${openCount}개`}
        </h2>
      </div>
      <div className="space-dialog__body">
        <p className="hub-assign__lead">
          맡을 사람을 고르고 배정하세요. 배정한 작업은 그 사람의 오늘에 나와요.
        </p>
        {notice && (
          <p role="alert" className="space-error">
            {notice}
          </p>
        )}
        {loadFailed && (
          <p className="hub-load-error" role="alert">
            작업을 불러오지 못했어요.{' '}
            <button
              type="button"
              className="space-text-button"
              onClick={() => load(0, true)}
            >
              다시 시도
            </button>
          </p>
        )}
        {loaded && !loading && !loadFailed && rows.length === 0 && !hasMore && (
          <p className="hub-quiet">
            {openCount === 0
              ? '모든 작업에 담당자가 있어요.'
              : '지금 배정할 수 있는 작업이 없어요.'}
          </p>
        )}
        {shown.length > 0 && (
          <ul className="hub-assign">
            {shown.map(({ key, item: row, phase }) => {
              const selectId = `hub-assign-${row.id}`
              return (
                <li key={key} {...presenceProps(phase)}>
                  <div className="hub-assign__task">
                    <strong>{row.title}</strong>
                    {row.detail && <small>{row.detail}</small>}
                  </div>
                  <div className="hub-assign__pick">
                    <label htmlFor={selectId} className="sr-only">
                      {row.title} 담당자
                    </label>
                    <select
                      id={selectId}
                      value={chosenAssignee(picked[row.id], options) ?? ''}
                      disabled={!row.canAssign || busyId !== null}
                      onChange={(event) =>
                        setPicked((current) => ({
                          ...current,
                          [row.id]: Number(event.target.value),
                        }))
                      }
                    >
                      {options.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="button"
                    className="workspace-button workspace-button--primary"
                    aria-label={`${row.title} 배정`}
                    disabled={
                      !row.canAssign ||
                      busyId !== null ||
                      loading ||
                      row.version === undefined ||
                      options.length === 0
                    }
                    onClick={() => void assign(row)}
                  >
                    {busyId === row.id ? '배정 중…' : '배정'}
                  </button>
                  {!row.canAssign && (
                    <div className="hub-assign__note">
                      <UnavailableNote text={unavailableText(row.reason, admins)} />
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
        {(loading || moreNeeded) && (
          <p className="hub-quiet hub-assign__loading">
            불러오는 중…
          </p>
        )}
        {hasMore && rows.length > 0 && !loading && (
          <button
            type="button"
            className="workspace-button hub-assign__more"
            disabled={busyId !== null}
            onClick={() => load(nextAssignPage(offset), false)}
          >
            더 보기
          </button>
        )}
      </div>
      <div className="space-dialog__actions">
        <button
          ref={closeButton}
          type="button"
          className="workspace-button"
          disabled={busyId !== null}
          onClick={onClose}
        >
          닫기
        </button>
      </div>
    </Modal>
  )
}
