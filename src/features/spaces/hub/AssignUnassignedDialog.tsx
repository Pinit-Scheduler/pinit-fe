import { useCallback, useEffect, useRef, useState } from 'react'
import Modal from '@shared/components/common/Modal'
import { assignTask, fetchUnassignedTasks } from '@features/tasks/api/tasks'
import type { Task } from '@features/tasks/types/task'
import UnavailableNote from '../UnavailableNote'
import { CONFLICT_RELOADED, isEditConflict } from '../conflicts'
import { adminNames, unavailableText } from '../unavailable'
import type { Project, Space } from '../types'
import {
  ASSIGN_PAGE_SIZE,
  assigneeOptions,
  assignRows,
  mergeTasks,
  nextAssignPage,
} from './assign'

/**
 * 허브의 담당자 미정 작업을 한 개씩 배정한다(시안 `hubOpenAssignV18`).
 * 목록은 BE의 담당자 미정 조건으로 받고, 남은 수는 요약(`openCount`)이 정한다. FE는 세지 않는다.
 */
export default function AssignUnassignedDialog({
  space,
  meId,
  projects,
  openCount,
  onClose,
  onAssigned,
}: {
  space: Space
  meId: number | null
  projects: Project[]
  /** 요약의 담당자 미정 미완료 수. 요약을 못 받았으면 null. */
  openCount: number | null
  onClose: () => void
  onAssigned: () => void
}) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [picked, setPicked] = useState<Record<number, number>>({})
  const [busyId, setBusyId] = useState<number | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const request = useRef<AbortController | null>(null)

  const load = useCallback(
    (page: number, replace: boolean) => {
      request.current?.abort()
      const controller = new AbortController()
      request.current = controller
      setLoading(true)
      setLoadFailed(false)
      fetchUnassignedTasks({
        spaceId: space.id,
        page,
        size: ASSIGN_PAGE_SIZE,
        signal: controller.signal,
      })
        .then((response) => {
          if (controller.signal.aborted) return
          setTasks((current) =>
            replace ? response.content : mergeTasks(current, response.content),
          )
          setHasMore(response.last === false)
        })
        .catch(() => {
          if (!controller.signal.aborted) setLoadFailed(true)
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false)
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

  const options = assigneeOptions(space.members, meId)
  const rows = assignRows(tasks, projects)
  const admins = adminNames(space.members)

  const assign = async (row: (typeof rows)[number]) => {
    const memberId = picked[row.id] ?? options[0]?.value
    if (memberId === undefined || row.version === undefined || busyId !== null)
      return
    setBusyId(row.id)
    setNotice(null)
    try {
      await assignTask(row.id, memberId, row.version)
      setTasks((current) => current.filter((task) => task.id !== row.id))
      onAssigned()
    } catch (failure) {
      if (isEditConflict(failure)) {
        setNotice(`${row.title}: ${CONFLICT_RELOADED}`)
        load(0, true)
      } else
        setNotice(
          `${row.title}: ${
            failure instanceof Error && failure.message
              ? failure.message
              : '배정하지 못했어요. 다시 시도해 주세요.'
          }`,
        )
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Modal
      labelledBy="hub-assign-title"
      backdropClassName="space-dialog-backdrop"
      className="space-dialog hub-assign-dialog"
      onClose={busyId === null ? onClose : undefined}
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
        {!loading && !loadFailed && rows.length === 0 && (
          <p className="hub-quiet">모든 작업에 담당자가 있어요.</p>
        )}
        {rows.length > 0 && (
          <ul className="hub-assign">
            {rows.map((row) => {
              const selectId = `hub-assign-${row.id}`
              return (
                <li key={row.id}>
                  <div className="hub-assign__task">
                    <strong>{row.title}</strong>
                    {row.detail && <small>{row.detail}</small>}
                  </div>
                  <div className="hub-assign__pick">
                    <label htmlFor={selectId} className="hub-sr">
                      {row.title} 담당자
                    </label>
                    <select
                      id={selectId}
                      value={picked[row.id] ?? options[0]?.value ?? ''}
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
        {loading && <p className="hub-quiet">불러오는 중…</p>}
        {hasMore && !loading && (
          <button
            type="button"
            className="workspace-button hub-assign__more"
            onClick={() => load(nextAssignPage(tasks.length), false)}
          >
            더 보기
          </button>
        )}
      </div>
      <div className="space-dialog__actions">
        <button
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
