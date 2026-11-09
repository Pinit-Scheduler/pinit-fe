import UnavailableNote from '../UnavailableNote'
import { countsLabel, dueLabel, type ProjectRow } from '../hub'
import { adminNames, unavailableLines } from '../unavailable'
import type { Project, Space, SpaceSummary } from '../types'
import RowMenu from './RowMenu'
import TaskDots from './TaskDots'

type Handlers = {
  onOpen: (project: Project) => void
  onCreate: () => void
  onEdit: (project: Project) => void
  onToggle: (project: Project) => void
  onMove: (project: Project) => void
  onDelete: (project: Project) => void
}

function Row({
  row,
  admins,
  busy,
  handlers,
}: {
  row: ProjectRow
  admins: string[]
  busy: boolean
  handlers: Handlers
}) {
  const { project, counts } = row
  const actions = project.allowedActions
  const notes = unavailableLines(
    [
      { off: actions.update === false, reason: undefined },
      { off: actions.move === false, reason: undefined },
      { off: actions.delete === false, reason: undefined },
    ],
    admins,
  )
  return (
    <li className={`hub-row hub-project${project.completed ? ' is-completed' : ''}`}>
      <button
        type="button"
        className="hub-project__main"
        aria-label={`${project.name} 작업 보기. ${counts ? countsLabel(counts) : '작업 수 없음'}`}
        onClick={() => handlers.onOpen(project)}
      >
        <strong>{project.name}</strong>
        {project.outcome && <small>{project.outcome}</small>}
      </button>
      <span className="hub-row__dots">
        {counts === null ? (
          <span className="hub-row__none">–</span>
        ) : counts.total === 0 ? (
          <span className="hub-row__none">작업 없음</span>
        ) : (
          <TaskDots counts={counts} />
        )}
      </span>
      <span className="hub-count">
        {counts ? `${counts.completed}/${counts.total}` : '–'}
      </span>
      <span className="hub-due">{dueLabel(row.nearestDueDate)}</span>
      <RowMenu label={`${project.name} 프로젝트 동작`}>
        <button
          type="button"
          disabled={!actions.update || busy}
          onClick={() => handlers.onEdit(project)}
        >
          수정
        </button>
        <button
          type="button"
          disabled={!actions.update || busy}
          onClick={() => handlers.onToggle(project)}
        >
          {project.completed ? '다시 열기' : '완료로 표시'}
        </button>
        <button
          type="button"
          disabled={!actions.move || busy}
          onClick={() => handlers.onMove(project)}
        >
          스페이스 이동
        </button>
        <button
          type="button"
          className="is-danger"
          disabled={!actions.delete || busy}
          onClick={() => handlers.onDelete(project)}
        >
          삭제
        </button>
        {notes.map((line) => (
          <UnavailableNote key={line} text={line} />
        ))}
      </RowMenu>
    </li>
  )
}

export default function HubProjects({
  space,
  rows,
  withoutProject,
  failed,
  onRetry,
  busy,
  ...handlers
}: {
  space: Space
  rows: ProjectRow[]
  withoutProject: SpaceSummary['withoutProject'] | null
  failed: boolean
  onRetry: () => void
  busy: boolean
} & Handlers) {
  const admins = adminNames(space.members)
  const open = rows.filter((row) => !row.project.completed)
  const closed = rows.filter((row) => row.project.completed)
  const loose = withoutProject?.counts
  const createNotes = unavailableLines(
    [{ off: space.allowedActions.update === false, reason: space.unavailableReasons?.update }],
    admins,
  )
  const list = (items: ProjectRow[]) => (
    <ul className="hub-rows">
      {items.map((row) => (
        <Row
          key={row.project.id}
          row={row}
          admins={admins}
          busy={busy}
          handlers={handlers}
        />
      ))}
    </ul>
  )
  return (
    <section
      className="hub-section"
      id="hub-projects"
      aria-labelledby="hub-projects-title"
    >
      <div className="hub-section__head">
        <h3 id="hub-projects-title">프로젝트</h3>
        <button
          type="button"
          className="space-text-button"
          disabled={!space.allowedActions.update || busy}
          onClick={handlers.onCreate}
        >
          + 프로젝트 만들기
        </button>
      </div>
      {createNotes.map((line) => (
        <UnavailableNote key={line} text={line} />
      ))}
      {failed && (
        <p className="hub-load-error" role="alert">
          숫자를 불러오지 못했어요.{' '}
          <button type="button" className="space-text-button" onClick={onRetry}>
            다시 시도
          </button>
        </p>
      )}
      {open.length ? (
        list(open)
      ) : (
        <p className="hub-empty">
          진행 중인 프로젝트가 없어요. 목적에 다가갈 첫 프로젝트를 만들어 보세요.
        </p>
      )}
      {closed.length > 0 && (
        <details className="hub-closed">
          <summary>완료한 프로젝트 {closed.length}개</summary>
          {list(closed)}
        </details>
      )}
      {loose && loose.total > 0 && (
        <div
          className="hub-loose"
          aria-label={`프로젝트 없이 기록한 작업. ${countsLabel(loose)}`}
        >
          <span>프로젝트 없이 기록한 작업 {loose.total}개</span>
          <TaskDots counts={loose} />
        </div>
      )}
    </section>
  )
}
