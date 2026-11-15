import { useId, useLayoutEffect, useRef, useState } from 'react'
import { getRequestFailureMessage } from '@shared/api/errorMessage'
import { useToast } from '@contexts/ToastContext'
import { updateProject } from './api'
import { reportEditConflict } from './conflicts'
import { countsLabel } from './hub'
import TaskDots from './hub/TaskDots'
import { useSpaceSummary } from './hub/useHubData'
import { workspaceChanged } from './store'
import { adminNames, unavailableText } from './unavailable'
import type { Project, Space } from './types'
import './hub/hub.css'
import './ProjectHead.css'

const OUTCOME_MAX = 1000

const monthDay = (date: string): string => {
  const [, month, day] = date.split('-')
  return `${Number(month)}/${Number(day)}`
}

/** 성과를 그 자리에서 적고 고친다. 저장 규칙과 충돌 판단은 서버가 한다. */
export function OutcomeEditor({
  project,
  close,
}: {
  project: Project
  close: () => void
}) {
  const errorId = useId()
  const { addToast } = useToast()
  const [text, setText] = useState(project.outcome ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lock = useRef(false)
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError(null)
    try {
      await updateProject(project.id, {
        outcome: text,
        expectedVersion: project.version,
      })
      addToast('저장했어요.', 'success')
      workspaceChanged()
      close()
    } catch (failure) {
      if (reportEditConflict(failure)) close()
      else
        setError(
          `${getRequestFailureMessage(failure, '성과를 저장하지 못했어요.')} 입력한 내용은 유지돼요.`,
        )
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  return (
    <form className="project-head__editor" onSubmit={submit}>
      <textarea
        autoFocus
        rows={2}
        maxLength={OUTCOME_MAX}
        value={text}
        disabled={busy}
        aria-label={`${project.name}의 성과`}
        aria-invalid={error !== null}
        aria-describedby={error ? errorId : undefined}
        placeholder="이 프로젝트를 마쳤을 때 남을 성과를 적어보세요."
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !busy) close()
        }}
      />
      <div className="project-head__editor-actions">
        <button
          className="workspace-button workspace-button--primary"
          type="submit"
          disabled={busy}
        >
          {busy ? '저장 중…' : '저장'}
        </button>
        <button
          className="workspace-button"
          type="button"
          disabled={busy}
          onClick={close}
        >
          취소
        </button>
      </div>
      {error && (
        <p id={errorId} role="alert" className="space-error">
          {error}
        </p>
      )}
    </form>
  )
}

/** 긴 성과는 두 줄까지만 보이고, 넘칠 때만 펼치는 버튼을 둔다. */
function Outcome({ text }: { text: string }) {
  const node = useRef<HTMLParagraphElement>(null)
  const [open, setOpen] = useState(false)
  const [clipped, setClipped] = useState(false)
  useLayoutEffect(() => {
    const target = node.current
    if (!target || open) return
    const measure = () =>
      setClipped(target.scrollHeight > target.clientHeight + 1)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(target)
    return () => observer.disconnect()
  }, [text, open])
  return (
    <>
      <p
        ref={node}
        className={`project-head__outcome${open ? ' is-open' : ''}`}
      >
        {text}
      </p>
      {(clipped || open) && (
        <button
          type="button"
          className="space-text-button project-head__more"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? '접기' : '성과 전체 보기'}
        </button>
      )}
    </>
  )
}

/**
 * 프로젝트를 골라 들어온 화면의 머리. 이 프로젝트가 남길 성과를 가장 크게 두고,
 * 바로 아래에 거기까지 온 만큼을 허브와 같은 점과 숫자(ADR-0030 요약)로 보여 준다.
 */
export default function ProjectHead({
  space,
  project,
}: {
  space: Space
  project: Project
}) {
  const summary = useSpaceSummary(space.id)
  const [editing, setEditing] = useState(false)
  const row = summary.data?.projects.find(
    (item) => item.projectId === project.id,
  )
  const canEdit = Boolean(project.allowedActions.update)
  const offReason =
    project.allowedActions.update === false
      ? unavailableText(
          project.unavailableReasons?.update,
          adminNames(space.members),
        )
      : null
  return (
    <section
      className="project-head"
      aria-label={`${project.name} 프로젝트의 성과와 진행`}
    >
      <div className="project-head__label">
        <strong>{project.name}의 성과</strong>
        {project.completed && <span>완료한 프로젝트</span>}
        {canEdit && !editing && project.outcome && (
          <button
            type="button"
            className="space-text-button"
            onClick={() => setEditing(true)}
          >
            성과 수정
          </button>
        )}
      </div>
      {editing ? (
        <OutcomeEditor project={project} close={() => setEditing(false)} />
      ) : project.outcome ? (
        <Outcome text={project.outcome} />
      ) : (
        <p className="project-head__empty">
          이 프로젝트를 마쳤을 때 남을 성과를 아직 적지 않았어요.{' '}
          {canEdit ? (
            <button
              type="button"
              className="space-text-button"
              onClick={() => setEditing(true)}
            >
              성과 적기
            </button>
          ) : (
            offReason
          )}
        </p>
      )}
      <div className="project-head__progress">
        {row ? (
          row.counts.total === 0 ? (
            <span>아직 이 프로젝트에 작업이 없어요.</span>
          ) : (
            <>
              <TaskDots counts={row.counts} />
              <span>{countsLabel(row.counts)}</span>
              {row.nearestDueDate && (
                <span className="project-head__due">
                  가장 이른 마감 {monthDay(row.nearestDueDate)}
                </span>
              )}
            </>
          )
        ) : summary.error ? (
          <span role="alert" className="project-head__load-error">
            {summary.error}{' '}
            <button
              type="button"
              className="space-text-button"
              onClick={summary.reload}
            >
              다시 시도
            </button>
          </span>
        ) : (
          <span aria-hidden>–</span>
        )}
      </div>
    </section>
  )
}
