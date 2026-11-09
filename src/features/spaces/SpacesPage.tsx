import { ApiError } from '@shared/api/httpClient'
import { useId, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import Modal from '@shared/components/common/Modal'
import WorkspaceIcon from '@shared/components/common/WorkspaceIcon'
import { useToast } from '@contexts/ToastContext'
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
import { selectSpace, useSpaces, workspaceChanged } from './store'
import type { Invitation, Project, Space } from './types'
import './spaces.css'

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
}: {
  editor: Editor
  close: () => void
  saved: (spaceId?: number) => void
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
      ? '목적 공간 만들기'
      : editor.kind === 'purpose'
        ? '목적 작성·수정'
        : editor.kind === 'space'
          ? '공간 정보 수정'
          : editor.kind === 'create-project'
            ? '프로젝트 만들기'
            : '프로젝트 수정'
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (mutationLock.current) return
    if (editor.kind !== 'purpose' && !name.trim()) {
      setInvalidField('name')
      setError(
        isProject ? '프로젝트 이름을 입력해 주세요.' : '공간 이름을 입력해 주세요.',
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
      if (!reportEditConflict(failure))
        setError(
          failure instanceof Error
            ? failure.message
            : '저장하지 못했어요. 입력한 내용은 유지됩니다.',
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
              {isProject ? '프로젝트 이름' : '공간 이름'}
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
            {isProject ? '목적에 기여할 성과 · 권장' : '이 공간의 목적'}
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
                  : '이 공간에서 이루고 싶은 방향과 결과를 적어보세요.'
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
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') ?? 'purpose'
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
  const space = workspace.selectedSpace
  const projects = workspace.projects.filter(
    (project) => project.spaceId === space?.id && !project.deleted,
  )
  const refresh = workspaceChanged
  const run = async (action: () => Promise<unknown>, message: string) => {
    if (mutationLock.current) return
    mutationLock.current = true
    setBusy(true)
    setError(null)
    try {
      await action()
      setConfirm(null)
      addToast(message, 'success')
      refresh()
    } catch (failure) {
      if (!reportEditConflict(failure))
        setError(
          failure instanceof Error
            ? failure.message
            : '요청을 처리하지 못했어요. 다시 시도해 주세요.',
        )
    } finally {
      mutationLock.current = false
      setBusy(false)
    }
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
        failure instanceof Error
          ? failure.message
          : '초대 링크를 만들지 못했어요.',
      )
    } finally {
      mutationLock.current = false
      setBusy(false)
    }
  }
  return (
    <section className="spaces-page">
      <header className="workspace-page-header">
        <div>
          <h1>공간·프로젝트 관리</h1>
          <p>목적과 프로젝트를 나누고, 같은 작업을 함께 관리하세요.</p>
        </div>
        <button
          className="workspace-button workspace-button--primary"
          onClick={() => setEditor({ kind: 'create-space' })}
        >
          공간 만들기
        </button>
      </header>
      {workspace.loading && <p role="status">공간을 불러오는 중…</p>}
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
      {space && (
        <div className="space-management workspace-panel">
          <div className="space-management__heading">
            <div>
              <span className="space-avatar" aria-hidden>
                {space.name.slice(0, 1)}
              </span>
              <h2>{space.name}</h2>
              <p>
                {space.personal
                  ? '본인 전용 기본 공간'
                  : `${space.members.length}명이 함께 사용하는 공간`}
              </p>
            </div>
          </div>
          <nav className="space-tabs" aria-label="공간 관리 항목">
            {[
              ['purpose', '목적·정보'],
              ['projects', '프로젝트'],
              ['people', '참여자'],
              ['trash', '삭제 항목'],
            ].map(([id, name]) => (
              <button
                key={id}
                type="button"
                aria-current={tab === id ? 'page' : undefined}
                onClick={() => setParams({ tab: id })}
              >
                {name}
              </button>
            ))}
          </nav>
          <div className="space-management__body">
            {tab === 'purpose' && (
              <>
                <div className="space-section-heading">
                  <h3>목적</h3>
                  <button
                    type="button"
                    className="workspace-button"
                    disabled={!space.allowedActions.update || busy}
                    onClick={() => setEditor({ kind: 'space', space })}
                  >
                    공간 정보 수정
                  </button>
                </div>
                <p className="space-purpose-copy">
                  {space.purpose || '아직 목적을 작성하지 않았어요.'}
                </p>
                <div className="space-inline-actions">
                  <button
                    className="workspace-button"
                    disabled={!space.allowedActions.update || busy}
                    onClick={() => setEditor({ kind: 'purpose', space })}
                  >
                    목적 작성·수정
                  </button>
                  {space.purpose && (
                    <button
                      className="space-text-button"
                      disabled={!space.allowedActions.edit || busy}
                      onClick={() =>
                        setConfirm({
                          title: '목적 내용 삭제',
                          description:
                            '목적 내용만 지웁니다. 공간과 프로젝트, 작업·일정은 남아 있어요.',
                          action: () =>
                            updatePurpose(space.id, null, space.version),
                        })
                      }
                    >
                      목적 내용 삭제
                    </button>
                  )}
                </div>
                {space.personal ? (
                  <p className="space-notice">
                    나의 공간은 본인 전용이며 사람을 초대할 수 없어요.
                  </p>
                ) : (
                  <div className="space-danger-zone">
                    <button
                      className="space-text-button"
                      disabled={!space.allowedActions.leave || busy}
                      onClick={() =>
                        setConfirm({
                          title: '공간 나가기',
                          description:
                            '나가면 이 공간의 공유 내용에 접근할 수 없어요.',
                          action: () => leaveSpace(space.id),
                        })
                      }
                    >
                      공간 나가기
                    </button>
                    <button
                      className="space-text-button space-text-button--danger"
                      disabled={!space.allowedActions.delete || busy}
                      onClick={() =>
                        setConfirm({
                          title: '공간 삭제',
                          description:
                            '이 공간이 목록에서 숨겨지고 참여자가 접근할 수 없게 됩니다. 복구는 관리자만 할 수 있어요.',
                          action: () => deleteSpace(space.id, space.version),
                        })
                      }
                    >
                      공간 삭제
                    </button>
                  </div>
                )}
              </>
            )}
            {tab === 'projects' && (
              <>
                <div className="space-section-heading">
                  <h3>프로젝트</h3>
                  <button
                    className="workspace-button workspace-button--primary"
                    disabled={!space.allowedActions.update || busy}
                    onClick={() => setEditor({ kind: 'create-project', space })}
                  >
                    프로젝트 만들기
                  </button>
                </div>
                {projects.length ? (
                  projects.map((project) => (
                    <article className="space-manager-row" key={project.id}>
                      <div>
                        <Link
                          className="space-project-title"
                          to="/app/tasks"
                          onClick={() => workspace.selectProject(project.id)}
                        >
                          {project.name}
                        </Link>
                        <p>
                          {project.outcome ||
                            '목적에 기여할 성과를 적어보세요.'}
                        </p>
                        {project.completed && <small>완료한 프로젝트</small>}
                      </div>
                      <div className="space-inline-actions">
                        <button
                          className="space-text-button"
                          disabled={!project.allowedActions.update || busy}
                          onClick={() =>
                            setEditor({ kind: 'project', project })
                          }
                        >
                          수정
                        </button>
                        <button
                          className="space-text-button"
                          disabled={!project.allowedActions.update || busy}
                          onClick={() =>
                            void run(
                              () =>
                                updateProject(project.id, {
                                  completed: !project.completed,
                                  expectedVersion: project.version,
                                }),
                              project.completed
                                ? '프로젝트를 다시 열었어요.'
                                : '프로젝트를 완료했어요.',
                            )
                          }
                        >
                          {project.completed ? '재개' : '완료'}
                        </button>
                        <button
                          className="space-text-button"
                          disabled={!project.allowedActions.move || busy}
                          onClick={() => setMovingProject(project)}
                        >
                          공간 이동
                        </button>
                        <button
                          className="space-text-button space-text-button--danger"
                          disabled={!project.allowedActions.delete || busy}
                          onClick={() =>
                            setConfirm({
                              title: '프로젝트 삭제',
                              description:
                                '프로젝트를 목록에서 숨깁니다. 복구는 관리자만 할 수 있어요.',
                              action: () =>
                                deleteProject(project.id, project.version),
                            })
                          }
                        >
                          삭제
                        </button>
                      </div>
                    </article>
                  ))
                ) : (
                  <div className="space-empty">
                    <h3>아직 프로젝트가 없어요</h3>
                    <p>이 목적에 기여할 첫 프로젝트를 만들어 보세요.</p>
                  </div>
                )}
              </>
            )}
            {tab === 'people' && (
              <>
                {space.personal ? (
                  <div className="space-notice">
                    기본 개인 공간에는 초대할 수 없어요. 함께할 공간을 새로
                    만들면 사람을 초대할 수 있습니다.
                  </div>
                ) : (
                  <>
                    <div className="space-section-heading">
                      <h3>참여자 {space.members.length}명</h3>
                      <button
                        className="workspace-button workspace-button--primary"
                        disabled={!space.allowedActions.invite || busy}
                        onClick={() => void invite()}
                      >
                        {busy ? '처리 중…' : '초대 링크 만들기'}
                      </button>
                    </div>
                    <p className="space-help">
                      함께하는 참여자는 같은 작업과 진행 상태를 보고 수정합니다.
                      공유로 옮기기 전 기록도 함께 볼 수 있어요.
                    </p>
                    {space.members.map((member) => (
                      <article
                        className="space-manager-row"
                        key={member.memberId}
                      >
                        <span className="space-avatar" aria-hidden>
                          {member.nickname.slice(0, 1)}
                        </span>
                        <div>
                          <strong>
                            {member.nickname}
                            {member.memberId === workspace.memberId
                              ? ' · 나'
                              : ''}
                          </strong>
                          <small>
                            {member.role === 'ADMIN' ? '관리자' : '참여자'}
                          </small>
                        </div>
                        {member.memberId !== workspace.memberId &&
                          space.allowedActions.manageMembers && (
                            <button
                              className="space-text-button"
                              disabled={busy}
                              onClick={() =>
                                void run(
                                  () =>
                                    updateSpaceMemberRole(
                                      space.id,
                                      member.memberId,
                                      member.role === 'ADMIN'
                                        ? 'MEMBER'
                                        : 'ADMIN',
                                    ),
                                  '관리자 역할을 바꿨어요.',
                                )
                              }
                            >
                              {member.role === 'ADMIN'
                                ? '관리자 해제'
                                : '관리자 지정'}
                            </button>
                          )}
                        {member.memberId !== workspace.memberId && (
                          <button
                            className="space-text-button space-text-button--danger"
                            disabled={
                              !space.allowedActions.manageMembers || busy
                            }
                            onClick={() =>
                              setConfirm({
                                title: '참여자 제외',
                                description: `${member.nickname} 님은 이 공간의 공유 내용에 접근할 수 없게 됩니다.`,
                                action: () =>
                                  removeSpaceMember(space.id, member.memberId),
                              })
                            }
                          >
                            제외
                          </button>
                        )}
                      </article>
                    ))}
                  </>
                )}
              </>
            )}
            {tab === 'trash' && (
              <>
                <h3>삭제된 공간·프로젝트</h3>
                <p className="space-help">
                  서버에서 복구 권한을 받은 항목만 복구할 수 있습니다.
                </p>
                {workspace.spaces
                  .filter((item) => item.deleted)
                  .map((item) => (
                    <article className="space-manager-row" key={`s${item.id}`}>
                      <strong>{item.name}</strong>
                      <button
                        className="workspace-button"
                        disabled={!item.allowedActions.restore || busy}
                        onClick={() =>
                          void run(
                            () => restoreSpace(item.id, item.version),
                            '공간을 복구했어요.',
                          )
                        }
                      >
                        복구
                      </button>
                    </article>
                  ))}
                {workspace.projects
                  .filter((item) => item.deleted && item.spaceId === space.id)
                  .map((item) => (
                    <article className="space-manager-row" key={`p${item.id}`}>
                      <strong>{item.name}</strong>
                      <button
                        className="workspace-button"
                        disabled={!item.allowedActions.restore || busy}
                        onClick={() =>
                          void run(
                            () => restoreProject(item.id, item.version),
                            '프로젝트를 복구했어요.',
                          )
                        }
                      >
                        복구
                      </button>
                    </article>
                  ))}
              </>
            )}
          </div>
        </div>
      )}
      {movingProject && (
        <ProjectMoveDialog
          project={movingProject}
          close={() => setMovingProject(null)}
          saved={() => {
            setMovingProject(null)
            saved()
          }}
        />
      )}
      {editor && (
        <EditorDialog
          editor={editor}
          close={() => setEditor(null)}
          saved={saved}
        />
      )}
      {confirm && (
        <Modal
          labelledBy="space-confirm-title"
          backdropClassName="space-dialog-backdrop"
          className="space-dialog space-dialog--notice"
          onClose={busy ? undefined : () => setConfirm(null)}
        >
          <h2 id="space-confirm-title">{confirm.title}</h2>
          <div className="space-dialog__body">
            <p>{confirm.description}</p>
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
              onClick={() => void run(confirm.action, '처리했어요.')}
            >
              {busy ? '처리 중…' : '확인'}
            </button>
          </div>
        </Modal>
      )}
      {invitation && (
        <Modal
          labelledBy="space-invite-title"
          backdropClassName="space-dialog-backdrop"
          className="space-dialog"
          onClose={() => setInvitation(null)}
        >
          <header className="space-dialog__header">
            <h2 id="space-invite-title">초대 링크</h2>
            <button
              className="space-icon-button"
              aria-label="닫기"
              onClick={() => setInvitation(null)}
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
            {copied && <p role="status">링크를 복사했어요.</p>}
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
              onClick={() =>
                void run(async () => {
                  await revokeInvitation(invitation.spaceId, invitation.id)
                  setInvitation(null)
                }, '초대 링크를 취소했어요.')
              }
            >
              링크 취소
            </button>
            <button
              className="workspace-button workspace-button--primary"
              onClick={() => {
                void navigator.clipboard
                  .writeText(invitation.inviteUrl ?? '')
                  .then(() => setCopied(true))
                  .catch(() =>
                    setError(
                      '복사하지 못했어요. 링크를 선택해 직접 복사해 주세요.',
                    ),
                  )
              }}
            >
              링크 복사
            </button>
          </footer>
        </Modal>
      )}
    </section>
  )
}

function ProjectMoveDialog({
  project,
  close,
  saved,
}: {
  project: Project
  close: () => void
  saved: () => void
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
      if (!reportEditConflict(failure))
        setError(
          failure instanceof Error
            ? failure.message
            : '프로젝트를 옮기지 못했어요.',
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
    >
      <header className="space-dialog__header">
        <h2 id="project-move-title">프로젝트 공간 이동</h2>
      </header>
      <div className="space-dialog__body space-form">
        <p>
          {project.name}의 작업·일정과 과거 기록이 목적지 공간에 함께
          표시됩니다. 원래 공간에 남은 작업과의 선행 관계는 서버에서
          해제·기록합니다.
        </p>
        <label>
          이동할 공간
          <select
            value={spaceId ?? ''}
            disabled={busy}
            onChange={(event) => setSpaceId(Number(event.target.value))}
          >
            <option value="" disabled>
              공간을 선택하세요
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
