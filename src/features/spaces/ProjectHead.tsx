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
/** 남은 글자 수는 한도에 가까워졌을 때만 보인다. */
const OUTCOME_COUNT_FROM = 100

const monthDay = (date: string): string => {
  const [, month, day] = date.split('-')
  return `${Number(month)}/${Number(day)}`
}

/** ⌘ 또는 Ctrl. 저장 단축키 안내에만 쓴다. */
const saveKey = () =>
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
    ? '⌘'
    : 'Ctrl'

/**
 * 성과를 그 자리에서 적고 고친다. 보이는 성과와 같은 글씨로 써서 저장한 뒤의 모양을 쓰면서 본다.
 * 줄바꿈은 적은 그대로 저장한다. 저장 규칙과 충돌 판단은 서버가 한다.
 */
export function OutcomeEditor({
  project,
  close,
}: {
  project: Project
  close: () => void
}) {
  const errorId = useId()
  const hintId = useId()
  const { addToast } = useToast()
  const saved = project.outcome ?? ''
  const [text, setText] = useState(saved)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lock = useRef(false)
  const field = useRef<HTMLTextAreaElement>(null)
  // 칸은 적은 줄 수만큼 자란다. 줄을 바꿀 때마다 스크롤하지 않고 전체를 본다.
  useLayoutEffect(() => {
    const node = field.current
    if (!node) return
    node.style.height = 'auto'
    node.style.height = `${node.scrollHeight}px`
  }, [text])
  // 고칠 때는 이어 쓰는 일이 많아 커서를 끝에 둔다.
  useLayoutEffect(() => {
    const node = field.current
    if (!node) return
    node.focus()
    node.setSelectionRange(node.value.length, node.value.length)
  }, [])
  const changed = text !== saved
  const left = OUTCOME_MAX - text.length
  const save = async () => {
    if (lock.current) return
    if (!changed) {
      close()
      return
    }
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
    <form
      className="project-head__editor"
      aria-busy={busy || undefined}
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      <textarea
        ref={field}
        rows={1}
        maxLength={OUTCOME_MAX}
        value={text}
        disabled={busy}
        aria-label={`${project.name}의 성과`}
        aria-invalid={error !== null}
        aria-describedby={error ? `${errorId} ${hintId}` : hintId}
        placeholder="이 프로젝트를 마쳤을 때 남을 성과를 적어보세요."
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          // 한글 조합 중의 키는 글자를 확정하는 데 쓰인다.
          if (busy || event.nativeEvent.isComposing) return
          if (event.key === 'Escape') close()
          else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            void save()
          }
        }}
      />
      {error && (
        <p id={errorId} role="alert" className="project-head__editor-error">
          {error}
        </p>
      )}
      <div className="project-head__editor-bar">
        <p id={hintId} className="project-head__editor-hint">
          <span>Enter로 줄을 바꿔요.</span>{' '}
          <span className="project-head__editor-keys">
            <kbd>{saveKey()}</kbd>
            <kbd>Enter</kbd>로 저장해요.
          </span>
        </p>
        {left <= OUTCOME_COUNT_FROM && (
          <span className="project-head__editor-count">{left}자 남음</span>
        )}
        <button
          className="workspace-button"
          type="button"
          disabled={busy}
          onClick={close}
        >
          취소
        </button>
        <button
          className="workspace-button workspace-button--primary"
          type="submit"
          disabled={busy || !changed}
        >
          {busy ? '저장 중…' : '저장'}
        </button>
      </div>
    </form>
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
        // 적은 줄바꿈 그대로, 접지 않고 전부 보인다.
        <p className="project-head__outcome">{project.outcome}</p>
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
