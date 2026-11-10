import { ApiError } from '@shared/api/httpClient'
import { getRequestFailureMessage } from '@shared/api/errorMessage'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import Modal from '@shared/components/common/Modal'
import StatusPanel from '@shared/components/common/StatusPanel'
import {
  MOTION_ENTER_MS,
  MOTION_EXIT_MS,
  MOTION_FAST_MS,
  MOTION_STRIKE_DELAY_MS,
  playRise,
  usePresence,
} from '@shared/motion'
import WorkspaceIcon from '@shared/components/common/WorkspaceIcon'
import { useToast } from '@contexts/ToastContext'
import useCurrentDay from '@shared/hooks/useCurrentDay'
import { weekStartOf } from '@features/calibration/utils/calibrationView'
import {
  moveProject,
  createInvitation,
  createProject,
  createSpace,
  deleteProject,
  deleteSpace,
  leaveSpace,
  removeSpaceMember,
  restoreProject,
  restoreSpace,
  revokeInvitation,
  updateProject,
  updateSpace,
  updatePurpose,
  updateSpaceMemberRole,
} from './api'
import { reportEditConflict } from './conflicts'
import { memberRows, projectRows } from './hub'
import HubIdentity from './hub/HubIdentity'
import AssignUnassignedDialog from './hub/AssignUnassignedDialog'
import HubPeople from './hub/HubPeople'
import HubProjects from './hub/HubProjects'
import HubRail from './hub/HubRail'
import HubSettings from './hub/HubSettings'
import TeamRecord from './hub/TeamRecord'
import useHubData from './hub/useHubData'
import { hubPaneToAnimate } from './motion'
import { selectSpace, useSpaces, workspaceChanged } from './store'
import type { Invitation, Project, Space } from './types'
import './spaces.css'
import './hub/hub.css'

type Editor =
  | { kind: 'create-space' }
  | { kind: 'space'; space: Space }
  | { kind: 'purpose'; space: Space }
  | { kind: 'create-project'; space: Space }
  | { kind: 'project'; project: Project }
function EditorDialog({
  editor,
  close,
  saved,
  closing = false,
}: {
  editor: Editor
  close: () => void
  saved: (spaceId?: number) => void
  closing?: boolean
}) {
  const titleId = useId()
  const initialName =
    editor.kind === 'space'
      ? editor.space.name
      : editor.kind === 'project'
        ? editor.project.name
        : ''
  const initialText =
    editor.kind === 'space' || editor.kind === 'purpose'
      ? (editor.space.purpose ?? '')
      : editor.kind === 'project'
        ? (editor.project.outcome ?? '')
        : ''
  const nameInput = useRef<HTMLInputElement>(null)
  const textInput = useRef<HTMLTextAreaElement>(null)
  const [invalidField, setInvalidField] = useState<'name' | 'text' | null>(null)
  const [name, setName] = useState(initialName)
  const [text, setText] = useState(initialText)
  const [busy, setBusy] = useState(false)
  const mutationLock = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const isProject =
    editor.kind === 'project' || editor.kind === 'create-project'
  const title =
    editor.kind === 'create-space'
      ? '목적 스페이스 만들기'
      : editor.kind === 'purpose'
        ? '목적 작성·수정'
        : editor.kind === 'space'
          ? '스페이스 정보 수정'
          : editor.kind === 'create-project'
            ? '프로젝트 만들기'
            : '프로젝트 수정'
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (mutationLock.current) return
    if (editor.kind !== 'purpose' && !name.trim()) {
      setInvalidField('name')
      setError(
        isProject ? '프로젝트 이름을 입력해 주세요.' : '스페이스 이름을 입력해 주세요.',
      )
      requestAnimationFrame(() => nameInput.current?.focus())
      return
    }
    mutationLock.current = true
    setBusy(true)
    setError(null)
    setInvalidField(null)
    try {
      if (editor.kind === 'create-space') {
        const space = await createSpace({ name, purpose: text })
        saved(space.id)
      } else if (editor.kind === 'purpose') {
        await updatePurpose(editor.space.id, text, editor.space.version)
        saved()
      } else if (editor.kind === 'space') {
        await updateSpace(editor.space.id, {
          name,
          purpose: text,
          expectedVersion: editor.space.version,
        })
        saved()
      } else if (editor.kind === 'create-project') {
        await createProject({ spaceId: editor.space.id, name, outcome: text })
        saved()
      } else {
        await updateProject(editor.project.id, {
          name,
          outcome: text,
          expectedVersion: editor.project.version,
        })
        saved()
      }
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 400) {
        const errors = (
          failure.data as { errors?: { field?: string }[] } | null
        )?.errors
        const field = Array.isArray(errors)
          ? errors
              .find((item) => item.field)
              ?.field?.split('.')
              .at(-1)
          : undefined
        if (field === 'name') {
          setInvalidField('name')
          requestAnimationFrame(() => nameInput.current?.focus())
        } else if (field === 'purpose' || field === 'outcome') {
          setInvalidField('text')
          requestAnimationFrame(() => textInput.current?.focus())
        }
      }
      if (reportEditConflict(failure)) close()
      else
        setError(
          getRequestFailureMessage(failure, '저장하지 못했어요. 입력한 내용은 유지됩니다.'),
        )
    } finally {
      mutationLock.current = false
      setBusy(false)
    }
  }
  return (
    <Modal
      labelledBy={titleId}
      backdropClassName="space-dialog-backdrop"
      className="space-dialog"
      onClose={busy ? undefined : close}
      closing={closing}
    >
      <header className="space-dialog__header">
        <h2 id={titleId}>{title}</h2>
        <button
          type="button"
          className="space-icon-button"
          aria-label="닫기"
          disabled={busy}
          onClick={close}
        >
          <WorkspaceIcon name="close" />
        </button>
      </header>
      <form onSubmit={submit}>
        <div className="space-dialog__body space-form">
          {editor.kind !== 'purpose' && (
            <label>
              {isProject ? '프로젝트 이름' : '스페이스 이름'}
              <input
                ref={nameInput}
                aria-invalid={invalidField === 'name'}
                aria-describedby={
                  invalidField === 'name' ? `${titleId}-error` : undefined
                }
                required
                maxLength={80}
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoFocus
                disabled={busy}
              />
            </label>
          )}
          <label>
            {isProject ? '목적에 기여할 성과 · 권장' : '이 스페이스의 목적'}
            <textarea
              autoFocus={editor.kind === 'purpose'}
              ref={textInput}
              aria-invalid={invalidField === 'text'}
              aria-describedby={
                invalidField === 'text' ? `${titleId}-error` : undefined
              }
              rows={4}
              maxLength={1000}
              value={text}
              disabled={busy}
              onChange={(event) => setText(event.target.value)}
              placeholder={
                isProject
                  ? '이 프로젝트를 마쳤을 때 남을 성과를 적어보세요.'
                  : '이 스페이스에서 이루고 싶은 방향과 결과를 적어보세요.'
              }
            />
          </label>
          {editor.kind === 'create-space' && (
            <p className="space-help">
              혼자 시작하고, 필요할 때 함께할 사람을 초대할 수 있어요.
            </p>
          )}
          {error && (
            <p id={`${titleId}-error`} role="alert" className="space-error">
              {error}
            </p>
          )}
        </div>
        <footer className="space-dialog__actions">
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
            disabled={busy}
            type="submit"
          >
            {busy
              ? '저장 중…'
              : editor.kind.startsWith('create')
                ? '만들기'
                : '저장'}
          </button>
        </footer>
      </form>
    </Modal>
  )
}
export default function SpacesPage() {
  const workspace = useSpaces()
  const { addToast } = useToast()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const tab = params.get('tab')
  const [detail, setDetail] = useState(params.has('tab'))
  const [editor, setEditor] = useState<Editor | null>(null)
  const [busy, setBusy] = useState(false)
  const mutationLock = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<{
    title: string
    description: string
    action: () => Promise<unknown>
  } | null>(null)
  const [invitation, setInvitation] = useState<Invitation | null>(null)
  const [copied, setCopied] = useState(false)
  const [movingProject, setMovingProject] = useState<Project | null>(null)
  const [assigningSpaceId, setAssigningSpaceId] = useState<number | null>(null)
  // 다른 스페이스로 바뀌면 배정 대화상자를 닫는다(돌아와도 저절로 열리지 않게). 다시 불러오는 동안 비는 것은 무시한다.
  if (
    assigningSpaceId !== null &&
    workspace.selectedSpace &&
    workspace.selectedSpace.id !== assigningSpaceId
  )
    setAssigningSpaceId(null)
  const backButton = useRef<HTMLButtonElement>(null)
  const rail = useRef<HTMLDivElement>(null)
  const today = useCurrentDay().format('YYYY-MM-DD')
  const weekStart = weekStartOf(today) ?? today
  const space = workspace.selectedSpace
  const withRecord = Boolean(
    space && !space.personal && space.members.length >= 2,
  )
  const { summaries, summary, record } = useHubData(
    space?.id ?? null,
    weekStart,
    withRecord,
  )
  const refresh = workspaceChanged
  const run = async (
    action: () => Promise<unknown>,
    message: string,
  ): Promise<boolean> => {
    if (mutationLock.current) return false
    mutationLock.current = true
    setBusy(true)
    setError(null)
    try {
      await action()
      setConfirm(null)
      addToast(message, 'success')
      refresh()
      return true
    } catch (failure) {
      if (reportEditConflict(failure)) setConfirm(null)
      else
        setError(
          getRequestFailureMessage(failure, '요청을 처리하지 못했어요.'),
        )
      return false
    } finally {
      mutationLock.current = false
      setBusy(false)
    }
  }
  // 프로젝트 완료 표시는 응답 전에 줄을 그어 보이고, 실패하면 되돌린다. 줄이 다 그어진 뒤에
  // 다른 목록으로 옮겨 가도록 저장 결과 반영을 그만큼 기다린다(다시 열기는 더 짧게).
  const [settling, setSettling] = useState<{
    id: number
    completed: boolean
  } | null>(null)
  const settledProject = settling
    ? workspace.projects.find((project) => project.id === settling.id)
    : undefined
  const settled =
    settling !== null &&
    (!settledProject || settledProject.completed === settling.completed)
  useEffect(() => {
    if (!settling) return
    // Once the server shows the new state, keep it through the row's exit, then let go.
    // A save that never shows up (someone changed it again) lets go as well.
    const timer = setTimeout(
      () => setSettling((current) => (current === settling ? null : current)),
      settled ? MOTION_EXIT_MS + MOTION_FAST_MS : 8000,
    )
    return () => clearTimeout(timer)
  }, [settling, settled])
  const toggleProject = async (project: Project) => {
    if (mutationLock.current) return
    const next = { id: project.id, completed: !project.completed }
    setSettling(next)
    const started = Date.now()
    // The strike draws after --motion-strike-delay over --motion-enter; retracting takes --motion-fast.
    const settle = next.completed ? MOTION_STRIKE_DELAY_MS + MOTION_ENTER_MS : MOTION_FAST_MS
    const ok = await run(
      async () => {
        const result = await updateProject(project.id, {
          completed: next.completed,
          expectedVersion: project.version,
        })
        const left = settle - (Date.now() - started)
        if (left > 0) await new Promise((resolve) => setTimeout(resolve, left))
        return result
      },
      project.completed
        ? '프로젝트를 다시 열었어요.'
        : '프로젝트를 완료로 표시했어요.',
    )
    if (!ok) setSettling((current) => (current === next ? null : current))
  }
  const saved = (spaceId?: number) => {
    setEditor(null)
    if (spaceId !== undefined) selectSpace(spaceId)
    addToast('저장했어요.', 'success')
    refresh()
  }
  const invite = async () => {
    if (!space || mutationLock.current) return
    mutationLock.current = true
    setBusy(true)
    setError(null)
    try {
      setInvitation(await createInvitation(space.id))
      setCopied(false)
    } catch (failure) {
      setError(
        getRequestFailureMessage(failure, '초대 링크를 만들지 못했어요.'),
      )
    } finally {
      mutationLock.current = false
      setBusy(false)
    }
  }
  const choose = (spaceId: number) => {
    selectSpace(spaceId)
    setDetail(true)
    requestAnimationFrame(() => {
      if (window.matchMedia?.('(max-width: 760px)').matches)
        backButton.current?.focus()
    })
  }
  const back = () => {
    setDetail(false)
    requestAnimationFrame(() =>
      rail.current
        ?.querySelector<HTMLButtonElement>('[aria-current="true"]')
        ?.focus(),
    )
  }
  // 같은 경로로 다시 들어오면(스페이스 시트의 "모든 스페이스 보기" 등) 좁은 화면은 목록부터 보인다.
  const location = useLocation()
  // Choosing another space swaps the overview's content in place; on a narrow screen the
  // list and the overview take turns. Either way the pane that changed rises in.
  const overview = useRef<HTMLElement>(null)
  const spaceId = space?.id ?? null
  const pane = useRef({ spaceId, detail })
  useLayoutEffect(() => {
    const before = pane.current
    pane.current = { spaceId, detail }
    const narrow = Boolean(window.matchMedia?.('(max-width: 760px)').matches)
    const target = hubPaneToAnimate(before, { spaceId, detail }, narrow)
    if (target === 'overview') playRise(overview.current)
    if (target === 'rail') playRise(rail.current)
  }, [spaceId, detail])
  const entry = useRef(location.key)
  useEffect(() => {
    if (entry.current === location.key) return
    entry.current = location.key
    setDetail(params.has('tab'))
  }, [location.key, params])
  const scrolledTab = useRef<string | null>(null)
  useEffect(() => {
    if (!space || !tab || scrolledTab.current === tab) return
    const target = document.getElementById(`hub-${tab}`)
    if (!target) return
    scrolledTab.current = tab
    target.scrollIntoView({ block: 'start' })
  }, [tab, space])
  const liveSpaces = workspace.spaces.filter((item) => !item.deleted)
  // Every dialog stays mounted through its exit and fades out instead of vanishing.
  const editing = usePresence(editor)
  const confirming = usePresence(confirm)
  const inviting = usePresence(invitation)
  const moving = usePresence(movingProject)
  const assigningDialog = usePresence(
    space && !space.personal && assigningSpaceId === space.id ? space : null,
  )
  return (
    <section className="spaces-page">
      <header className="workspace-page-header">
        <div>
          <h1>스페이스</h1>
          <p>목적과 프로젝트를 나누고, 같은 작업을 함께 관리하세요.</p>
        </div>
        <button
          className="workspace-button workspace-button--primary"
          onClick={() => setEditor({ kind: 'create-space' })}
        >
          스페이스 만들기
        </button>
      </header>
      {workspace.loading && liveSpaces.length === 0 && (
        <StatusPanel variant="loading" title="스페이스를 불러오는 중…" />
      )}
      {(workspace.error || error) && (
        <div className="workspace-inline-error" role="alert">
          <span>{error ?? workspace.error}</span>
          <button
            onClick={() => {
              setError(null)
              void workspace.reload().catch(() => {})
            }}
          >
            다시 시도
          </button>
        </div>
      )}
      <div className={`spaces-hub${detail ? ' is-detail' : ''}`}>
        <div ref={rail} className="spaces-hub__rail">
          <HubRail
            spaces={liveSpaces}
            summaries={summaries.data}
            failed={Boolean(summaries.error) && !summaries.data}
            onRetry={summaries.reload}
            selectedId={space?.id ?? null}
            onSelect={choose}
          />
        </div>
        {space && (
          <article
            ref={overview}
            className="hub-overview"
            aria-labelledby="hub-space-title"
          >
            <button
              ref={backButton}
              type="button"
              className="hub-back"
              onClick={back}
            >
              <WorkspaceIcon name="back" aria-hidden />
              모든 스페이스
            </button>
            <HubIdentity
              space={space}
              meId={workspace.memberId}
              busy={busy}
              onEditPurpose={() => setEditor({ kind: 'purpose', space })}
              onDeletePurpose={() =>
                setConfirm({
                  title: '목적 내용 삭제',
                  description:
                    '목적 내용만 지웁니다. 스페이스와 프로젝트, 작업·일정은 남아 있어요.',
                  action: () => updatePurpose(space.id, null, space.version),
                })
              }
            />
            <div className="hub-columns">
              <HubProjects
                space={space}
                rows={projectRows(workspace.projects, space.id, summary.data)}
                withoutProject={summary.data?.withoutProject ?? null}
                failed={Boolean(summary.error) && !summary.data}
                onRetry={summary.reload}
                busy={busy}
                settling={settling}
                onOpen={(project) => {
                  workspace.selectProject(project.id)
                  navigate('/app/tasks')
                }}
                onCreate={() => setEditor({ kind: 'create-project', space })}
                onEdit={(project) => setEditor({ kind: 'project', project })}
                onToggle={(project) => void toggleProject(project)}
                onMove={setMovingProject}
                onDelete={(project) =>
                  setConfirm({
                    title: '프로젝트 삭제',
                    description:
                      '프로젝트를 목록에서 숨깁니다. 복구는 관리자만 할 수 있어요.',
                    action: () => deleteProject(project.id, project.version),
                  })
                }
              />
              {!space.personal && (
                <HubPeople
                  space={space}
                  rows={memberRows(
                    space.members,
                    workspace.memberId,
                    summary.data,
                  )}
                  unassigned={summary.data?.unassigned ?? null}
                  failed={Boolean(summary.error) && !summary.data}
                  onRetry={summary.reload}
                  busy={busy}
                  onInvite={() => void invite()}
                  onToggleAdmin={(member) =>
                    void run(
                      () =>
                        updateSpaceMemberRole(
                          space.id,
                          member.memberId,
                          member.admin ? 'MEMBER' : 'ADMIN',
                        ),
                      '관리자 역할을 바꿨어요.',
                    )
                  }
                  onAssign={() => setAssigningSpaceId(space.id)}
                  onRemove={(member) =>
                    setConfirm({
                      title: '참여자 제외',
                      description: `${member.name} 님은 이 스페이스의 공유 내용에 접근할 수 없게 됩니다. 맡고 있던 작업은 담당자 미정이 돼요.`,
                      action: () =>
                        removeSpaceMember(space.id, member.memberId),
                    })
                  }
                />
              )}
            </div>
            {withRecord && (
              <TeamRecord
                space={space}
                projects={workspace.projects.filter(
                  (project) => project.spaceId === space.id,
                )}
                meId={workspace.memberId}
                record={record.data}
                failed={Boolean(record.error) && !record.data}
                onRetry={record.reload}
                today={today}
              />
            )}
            <HubSettings
              space={space}
              deletedSpaces={workspace.spaces.filter((item) => item.deleted)}
              deletedProjects={workspace.projects.filter(
                (item) => item.deleted && item.spaceId === space.id,
              )}
              busy={busy}
              onEdit={() => setEditor({ kind: 'space', space })}
              onLeave={() =>
                setConfirm({
                  title: '스페이스 나가기',
                  description:
                    '나가면 이 스페이스의 공유 내용에 접근할 수 없어요. 맡고 있던 작업은 담당자 미정이 돼요.',
                  action: () => leaveSpace(space.id),
                })
              }
              onDelete={() =>
                setConfirm({
                  title: '스페이스 삭제',
                  description:
                    '이 스페이스가 목록에서 숨겨지고 참여자가 접근할 수 없게 됩니다. 복구는 관리자만 할 수 있어요.',
                  action: () => deleteSpace(space.id, space.version),
                })
              }
              onRestoreSpace={(item) =>
                void run(
                  () => restoreSpace(item.id, item.version),
                  '스페이스를 복구했어요.',
                )
              }
              onRestoreProject={(item) =>
                void run(
                  () => restoreProject(item.id, item.version),
                  '프로젝트를 복구했어요.',
                )
              }
            />
          </article>
        )}
      </div>
      {moving.mounted && moving.value && (
        <ProjectMoveDialog
          project={moving.value}
          closing={moving.closing}
          close={() => setMovingProject(null)}
          saved={() => {
            setMovingProject(null)
            saved()
          }}
        />
      )}
      {editing.mounted && editing.value && (
        <EditorDialog
          editor={editing.value}
          closing={editing.closing}
          close={() => setEditor(null)}
          saved={saved}
        />
      )}
      {assigningDialog.mounted && assigningDialog.value && (
        <AssignUnassignedDialog
          space={assigningDialog.value}
          closing={assigningDialog.closing}
          meId={workspace.memberId}
          projects={workspace.projects.filter(
            (project) => project.spaceId === assigningDialog.value?.id,
          )}
          openCount={
            assigningDialog.value.id === space?.id
              ? (summary.data?.unassigned.openCount ?? null)
              : null
          }
          onClose={() => setAssigningSpaceId(null)}
          onAssigned={() => {
            addToast('배정했어요.', 'success')
            refresh()
          }}
          onStale={refresh}
        />
      )}
      {confirming.mounted && confirming.value && (
        <Modal
          labelledBy="space-confirm-title"
          backdropClassName="space-dialog-backdrop"
          className="space-dialog space-dialog--notice"
          onClose={busy ? undefined : () => setConfirm(null)}
          closing={confirming.closing}
        >
          <h2 id="space-confirm-title">{confirming.value.title}</h2>
          <div className="space-dialog__body">
            <p>{confirming.value.description}</p>
          </div>
          {error && (
            <p role="alert" className="space-error">
              {error}
            </p>
          )}
          <div className="space-dialog__actions">
            <button
              className="workspace-button"
              disabled={busy}
              onClick={() => setConfirm(null)}
            >
              취소
            </button>
            <button
              className="workspace-button workspace-button--primary"
              disabled={busy}
              onClick={() => {
                if (confirm) void run(confirm.action, '처리했어요.')
              }}
            >
              {busy ? '처리 중…' : '확인'}
            </button>
          </div>
        </Modal>
      )}
      {inviting.mounted && inviting.value && (
        <InvitationDialog
          invitation={inviting.value}
          closing={inviting.closing}
          busy={busy}
          copied={copied}
          error={error}
          onClose={() => setInvitation(null)}
          onRevoke={(shown) =>
            void run(async () => {
              await revokeInvitation(shown.spaceId, shown.id)
              setInvitation(null)
            }, '초대 링크를 취소했어요.')
          }
          onCopy={(shown) => {
            void navigator.clipboard
              .writeText(shown.inviteUrl ?? '')
              .then(() => setCopied(true))
              .catch(() =>
                setError(
                  '복사하지 못했어요. 링크를 선택해 직접 복사해 주세요.',
                ),
              )
          }}
        />
      )}
    </section>
  )
}

function ProjectMoveDialog({
  project,
  close,
  saved,
  closing = false,
}: {
  project: Project
  close: () => void
  saved: () => void
  closing?: boolean
}) {
  const { spaces } = useSpaces()
  const [spaceId, setSpaceId] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lock = useRef(false)
  const submit = async () => {
    if (spaceId === null || lock.current) return
    lock.current = true
    setBusy(true)
    setError(null)
    try {
      await moveProject(project.id, spaceId, project.version)
      saved()
    } catch (failure) {
      if (reportEditConflict(failure)) close()
      else
        setError(
          getRequestFailureMessage(failure, '프로젝트를 옮기지 못했어요.'),
        )
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  return (
    <Modal
      labelledBy="project-move-title"
      backdropClassName="space-dialog-backdrop"
      className="space-dialog"
      onClose={busy ? undefined : close}
      closing={closing}
    >
      <header className="space-dialog__header">
        <h2 id="project-move-title">프로젝트 스페이스 이동</h2>
      </header>
      <div className="space-dialog__body space-form">
        <p>
          {project.name}의 작업·일정과 과거 기록이 목적지 스페이스에 함께
          표시됩니다. 원래 스페이스에 남은 작업과의 선행 관계는 서버에서
          해제·기록합니다.
        </p>
        <label>
          이동할 스페이스
          <select
            value={spaceId ?? ''}
            disabled={busy}
            onChange={(event) => setSpaceId(Number(event.target.value))}
          >
            <option value="" disabled>
              스페이스를 선택하세요
            </option>
            {spaces
              .filter(
                (space) =>
                  !space.deleted &&
                  space.id !== project.spaceId &&
                  space.allowedActions.edit,
              )
              .map((space) => (
                <option key={space.id} value={space.id}>
                  {space.name}
                </option>
              ))}
          </select>
        </label>
        {error && (
          <p role="alert" className="space-error">
            {error}
          </p>
        )}
      </div>
      <footer className="space-dialog__actions">
        <button className="workspace-button" disabled={busy} onClick={close}>
          취소
        </button>
        <button
          className="workspace-button workspace-button--primary"
          disabled={busy || spaceId === null}
          onClick={() => void submit()}
        >
          {busy ? '이동 중…' : '확인하고 이동'}
        </button>
      </footer>
    </Modal>
  )
}

function InvitationDialog({
  invitation,
  closing,
  busy,
  copied,
  error,
  onClose,
  onRevoke,
  onCopy,
}: {
  invitation: Invitation
  closing: boolean
  busy: boolean
  copied: boolean
  error: string | null
  onClose: () => void
  onRevoke: (invitation: Invitation) => void
  onCopy: (invitation: Invitation) => void
}) {
  return (
    <Modal
      labelledBy="space-invite-title"
      backdropClassName="space-dialog-backdrop"
      className="space-dialog"
      onClose={onClose}
      closing={closing}
    >
      <header className="space-dialog__header">
        <h2 id="space-invite-title">초대 링크</h2>
        <button
          className="space-icon-button"
          aria-label="닫기"
          onClick={onClose}
        >
          <WorkspaceIcon name="close" />
        </button>
      </header>
      <div className="space-dialog__body">
        <p>
          {invitation.spaceName}의 프로젝트와 공유 작업을 함께 관리할 수
          있어요.
        </p>
        <p className="space-notice">
          이동 전 과거 기록도 참여자에게 표시됩니다. 링크는 생성 후 1시간
          동안 사용할 수 있어요.
        </p>
        <label className="space-copy-field">
          초대 링크
          <input
            readOnly
            value={invitation.inviteUrl ?? ''}
            onFocus={(event) => event.target.select()}
          />
        </label>
        <p className="space-help">
          만료: {new Date(invitation.expiresAt).toLocaleString('ko-KR')}
        </p>
        {copied && (
          <p role="status" className="space-copied">
            링크를 복사했어요.
          </p>
        )}
        {error && (
          <p role="alert" className="space-error">
            {error}
          </p>
        )}
      </div>
      <footer className="space-dialog__actions">
        <button
          className="workspace-button"
          disabled={busy}
          onClick={() => onRevoke(invitation)}
        >
          링크 취소
        </button>
        <button
          className="workspace-button workspace-button--primary"
          onClick={() => onCopy(invitation)}
        >
          링크 복사
        </button>
      </footer>
    </Modal>
  )
}
