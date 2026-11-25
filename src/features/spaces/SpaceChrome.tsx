import { Fragment, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import Modal from '@shared/components/common/Modal'
import WorkspaceIcon from '@shared/components/common/WorkspaceIcon'
import useMediaQuery from '@shared/hooks/useMediaQuery'
import { usePresence } from '@shared/motion'
import { usePageSpace } from './pageSpace'
import { useSpaces } from './store'
import ProjectHead from './ProjectHead'
import SpaceMark from './SpaceMark'
import {
  projectSelectionTarget,
  routeScope,
  sheetProjects,
  switcherLabel,
} from './scope'
import './spaces.css'

export function SpaceSwitcher({
  variant = 'sidebar',
}: {
  variant?: 'sidebar' | 'bar'
}) {
  const spaces = useSpaces()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const narrow = useMediaQuery('(max-width: 899px)')
  const [open, setOpen] = useState(false)
  // The sheet stays mounted through its exit and slides or fades away instead of vanishing.
  const sheet = usePresence(open)
  const openerRef = useRef<HTMLButtonElement>(null)
  const allWorkRef = useRef<HTMLButtonElement>(null)
  const focusAllWork = useRef(false)
  const wasOpen = useRef(false)
  // The selected option is autoFocused before Modal records the opener, so
  // return focus to the button ourselves on every close path.
  useEffect(() => {
    if (wasOpen.current && !open) openerRef.current?.focus()
    wasOpen.current = open
  }, [open])
  // After choosing another space the sheet stays open; move focus into its
  // freshly expanded project group.
  useEffect(() => {
    if (focusAllWork.current && allWorkRef.current) {
      focusAllWork.current = false
      allWorkRef.current.focus()
    }
  })
  const choosePart = (id: number | null) => {
    spaces.selectProject(id)
    const target = projectSelectionTarget(pathname)
    if (typeof target === 'string') navigate(target)
    setOpen(false)
  }
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
      {sheet.mounted &&
        createPortal(
          <Modal
            labelledBy="space-switcher-title"
            backdropClassName="space-dialog-backdrop"
            className="space-dialog space-dialog--switcher"
            onClose={() => setOpen(false)}
            closing={sheet.closing}
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
                .map((space) => {
                  const selected = spaces.selectedSpaceId === space.id
                  const projects = sheetProjects(spaces.projects, space.id)
                  return (
                    <Fragment key={space.id}>
                      <button
                        className="space-option"
                        autoFocus={space.id === spaces.selectedSpaceId}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => {
                          spaces.selectSpace(space.id)
                          if (narrow && !selected && projects.length > 0) {
                            focusAllWork.current = true
                            return
                          }
                          setOpen(false)
                        }}
                      >
                        <span className="space-avatar" aria-hidden>
                          {space.name.slice(0, 1)}
                        </span>
                        <span>
                          <strong>
                            <SpaceMark space={space} />
                            {space.name}
                          </strong>
                          <small>
                            {space.personal
                              ? '본인 전용'
                              : space.purpose || '함께할 목적을 기록하세요'}
                          </small>
                        </span>
                        {selected && <WorkspaceIcon name="check" />}
                      </button>
                      {narrow && selected && projects.length > 0 && (
                        <div
                          className="space-option-projects"
                          role="group"
                          aria-label={`${space.name} 의 프로젝트`}
                        >
                          <button
                            ref={allWorkRef}
                            type="button"
                            aria-pressed={spaces.selectedProjectId === null}
                            onClick={() => choosePart(null)}
                          >
                            스페이스의 모든 작업
                          </button>
                          {projects.map((project) => (
                            <button
                              type="button"
                              key={project.id}
                              aria-pressed={
                                spaces.selectedProjectId === project.id
                              }
                              onClick={() => choosePart(project.id)}
                            >
                              <span>{project.name}</span>
                              {project.completed && <small>완료</small>}
                            </button>
                          ))}
                        </div>
                      )}
                    </Fragment>
                  )
                })}
            </div>
            <footer className="space-dialog__footer">
              <p>오늘에는 모든 스페이스의 내 작업이 모입니다.</p>
              <Link to="/app/spaces" onClick={() => setOpen(false)}>
                모든 스페이스 보기
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
  const open = items.filter((project) => !project.completed)
  const closed = items.filter((project) => project.completed)
  // Completed projects stay folded until asked for. Unfolding holds for the space it was done
  // in, and the fold opens by itself while the selected project is one of them, so the
  // selection stays in view.
  const [unfoldedSpaceId, setUnfoldedSpaceId] = useState<number | null>(null)
  const selectedClosed = closed.some(
    (project) => project.id === selectedProjectId,
  )
  const unfolded =
    selectedClosed ||
    (selectedSpaceId !== null && unfoldedSpaceId === selectedSpaceId)
  const foldRef = useRef<HTMLDetailsElement>(null)
  // React writes `open` only when it changes, so a fold the user closed by hand over a selected
  // completed project would stay closed when another one is selected from elsewhere.
  useEffect(() => {
    if (foldRef.current) foldRef.current.open = unfolded
  }, [unfolded, selectedProjectId])
  const choose = (id: number | null) => {
    selectProject(id)
    const target = projectSelectionTarget(pathname)
    if (typeof target === 'string') navigate(target)
  }
  const row = (project: (typeof items)[number]) => (
    <button
      type="button"
      key={project.id}
      aria-pressed={selectedProjectId === project.id}
      onClick={() => choose(project.id)}
    >
      <span>{project.name}</span>
    </button>
  )
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
      {open.map(row)}
      {closed.length > 0 && (
        <details
          ref={foldRef}
          className="space-projects-fold"
          open={unfolded}
          onToggle={(event) => {
            // Only a toggle the user made differs from what was rendered.
            const next = event.currentTarget.open
            if (next !== unfolded)
              setUnfoldedSpaceId(next ? selectedSpaceId : null)
          }}
        >
          <summary>
            완료한 프로젝트 {closed.length}개<span aria-hidden>⌄</span>
          </summary>
          <div>{closed.map(row)}</div>
        </details>
      )}
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
  // 일정은 모든 스페이스를 보여 주는 내 화면이다. 고른 스페이스의 목적·프로젝트를 그 위에 두지 않는다.
  const schedules = pathname === '/app/schedules'
  const { selectedSpace, selectedProject } = useSpaces()
  const pageSpace = usePageSpace()
  // 쪼개기 화면이 다른 스페이스의 요청을 보이면 고른 스페이스의 목적을 그 위에 두지 않는다.
  const foreign =
    pathname.startsWith('/app/tasks/splits') &&
    pageSpace != null &&
    pageSpace !== selectedSpace?.id
  // 허브는 목적과 프로젝트를 본문에 크게 보여 주므로 같은 정보를 위에 다시 두지 않는다.
  if (pathname === '/app/spaces') return null
  // 마인드맵은 스페이스와 상관없는 내 화면이라 범위 표시를 두지 않는다.
  if (pathname === '/app/mind-map') return null
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
      {schedules && (
        <span className="space-context__project">모든 스페이스 · 일정</span>
      )}
      {!today && !trash && !deadlineRisk && !statistics && !schedules && !foreign && selectedSpace?.purpose && (
        <details>
          <summary>
            <span>목적</span>
            <span className="space-context__preview">
              {selectedSpace.purpose}
            </span>
            <span aria-hidden>⌄</span>
          </summary>
          <p>{selectedSpace.purpose}</p>
        </details>
      )}
      {/* 프로젝트를 고르면 그 프로젝트의 성과와 진행이 화면 맨 위에 온다. */}
      {!today &&
        !trash &&
        !deadlineRisk &&
        !statistics &&
        !schedules &&
        selectedSpace &&
        selectedProject &&
        selectedProject.spaceId === selectedSpace.id && (
          // 프로젝트마다 새로 세워, 쓰던 편집 칸과 펼침이 다른 프로젝트로 넘어가지 않는다.
          <ProjectHead
            key={selectedProject.id}
            space={selectedSpace}
            project={selectedProject}
          />
        )}
    </section>
  )
}
