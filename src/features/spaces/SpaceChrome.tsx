import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import Modal from '@shared/components/common/Modal'
import WorkspaceIcon from '@shared/components/common/WorkspaceIcon'
import { useSpaces } from './store'
import SpaceMark from './SpaceMark'
import { projectSelectionTarget, routeScope, switcherLabel } from './scope'
import './spaces.css'

export function SpaceSwitcher({
  variant = 'sidebar',
}: {
  variant?: 'sidebar' | 'bar'
}) {
  const spaces = useSpaces()
  const { pathname } = useLocation()
  const [open, setOpen] = useState(false)
  const openerRef = useRef<HTMLButtonElement>(null)
  const wasOpen = useRef(false)
  // The selected option is autoFocused before Modal records the opener, so
  // return focus to the button ourselves on every close path.
  useEffect(() => {
    if (wasOpen.current && !open) openerRef.current?.focus()
    wasOpen.current = open
  }, [open])
  const current = spaces.selectedSpace
  const label = switcherLabel(
    routeScope(pathname),
    current,
    spaces.selectedProject,
    spaces.loading,
  )
  return (
    <>
      {variant === 'bar' ? (
        <button
          ref={openerRef}
          type="button"
          className="space-switcher space-switcher--bar"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={`스페이스 전환. 지금 ${label}`}
          onClick={() => setOpen(true)}
        >
          <SpaceMark space={current} />
          <span className="space-switcher__label">{label}</span>
          <span aria-hidden>⌄</span>
        </button>
      ) : (
        <button
          ref={openerRef}
          type="button"
          className="space-switcher"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen(true)}
        >
          <span className="space-avatar" aria-hidden>
            {current?.name.slice(0, 1) ?? '나'}
          </span>
          <span className="space-switcher__copy">
            <strong>
              <SpaceMark space={current} />
              {current?.name ?? label}
            </strong>
            <small>
              {current?.personal ? '본인 전용' : '함께 관리하는 목적 스페이스'}
            </small>
          </span>
          <span aria-hidden>⌄</span>
        </button>
      )}
      {open &&
        createPortal(
          <Modal
            labelledBy="space-switcher-title"
            backdropClassName="space-dialog-backdrop"
            className="space-dialog space-dialog--switcher"
            onClose={() => setOpen(false)}
          >
            <header className="space-dialog__header">
              <h2 id="space-switcher-title">스페이스 전환</h2>
              <button
                type="button"
                className="space-icon-button"
                aria-label="스페이스 선택 닫기"
                onClick={() => setOpen(false)}
              >
                <WorkspaceIcon name="close" />
              </button>
            </header>
            <div className="space-dialog__body">
              {spaces.error && (
                <div role="alert" className="workspace-inline-error">
                  {spaces.error}
                  <button onClick={() => void spaces.reload().catch(() => {})}>
                    다시 시도
                  </button>
                </div>
              )}
              {spaces.spaces
                .filter((space) => !space.deleted)
                .map((space) => (
                  <button
                    className="space-option"
                    autoFocus={space.id === spaces.selectedSpaceId}
                    type="button"
                    key={space.id}
                    aria-pressed={spaces.selectedSpaceId === space.id}
                    onClick={() => {
                      spaces.selectSpace(space.id)
                      setOpen(false)
                    }}
                  >
                    <span className="space-avatar" aria-hidden>
                      {space.name.slice(0, 1)}
                    </span>
                    <span>
                      <strong>{space.name}</strong>
                      <small>
                        {space.personal
                          ? '본인 전용'
                          : space.purpose || '함께할 목적을 기록하세요'}
                      </small>
                    </span>
                    {space.id === spaces.selectedSpaceId && (
                      <WorkspaceIcon name="check" />
                    )}
                  </button>
                ))}
            </div>
            <footer className="space-dialog__footer">
              <p>오늘에는 모든 스페이스의 내 작업이 모입니다.</p>
              <Link to="/app/spaces" onClick={() => setOpen(false)}>
                스페이스·프로젝트 관리
              </Link>
            </footer>
          </Modal>,
          document.querySelector('.workspace-theme') ?? document.body,
        )}
    </>
  )
}
export function SpaceProjectsNav() {
  const { projects, selectedSpaceId, selectedProjectId, selectProject } =
    useSpaces()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const items = projects.filter(
    (project) => project.spaceId === selectedSpaceId && !project.deleted,
  )
  const choose = (id: number | null) => {
    selectProject(id)
    const target = projectSelectionTarget(pathname)
    if (typeof target === 'string') navigate(target)
  }
  return (
    <nav className="space-projects-nav" aria-label="선택한 스페이스의 프로젝트">
      <p>프로젝트</p>
      <button
        type="button"
        aria-pressed={selectedProjectId === null}
        onClick={() => choose(null)}
      >
        스페이스의 모든 작업
      </button>
      {items.map((project) => (
        <button
          type="button"
          key={project.id}
          aria-pressed={selectedProjectId === project.id}
          onClick={() => choose(project.id)}
        >
          <span>{project.name}</span>
          {project.completed && <small>완료</small>}
        </button>
      ))}
      <Link to="/app/spaces?tab=projects">프로젝트 관리</Link>
    </nav>
  )
}
export function SpaceContextBar() {
  const { pathname } = useLocation()
  const today = pathname === '/app/today'
  const trash = pathname === '/app/settings/trash'
  const deadlineRisk = pathname === '/app/deadline-risk'
  const statistics = pathname === '/app/statistics'
  const { selectedSpace, selectedProject } = useSpaces()
  return (
    <section className="space-context" aria-label="목적과 프로젝트">
      {today && (
        <span className="space-context__project">
          모든 스페이스 · 나에게 배정된 작업
        </span>
      )}
      {trash && (
        <span className="space-context__project">
          모든 스페이스 · 복구 권한이 있는 항목
        </span>
      )}
      {deadlineRisk && (
        <span className="space-context__project">개인 스페이스 · 마감 위험 예보</span>
      )}
      {statistics && (
        <span className="space-context__project">모든 스페이스 · 내 기록</span>
      )}
      {!today && !trash && !deadlineRisk && !statistics && selectedSpace?.purpose && (
        <details>
          <summary>
            <span>목적</span>
            <span className="space-context__preview">
              {selectedSpace.purpose}
            </span>
            <span aria-hidden>⌄</span>
          </summary>
          <p>{selectedSpace.purpose}</p>
          {selectedProject?.outcome && (
            <p>목적에 기여할 성과 · {selectedProject.outcome}</p>
          )}
        </details>
      )}
      {!today && !trash && !deadlineRisk && !statistics && selectedProject && (
        <span className="space-context__project">
          {selectedProject.name}
          {selectedProject.completed ? ' · 완료' : ''}
        </span>
      )}
    </section>
  )
}
