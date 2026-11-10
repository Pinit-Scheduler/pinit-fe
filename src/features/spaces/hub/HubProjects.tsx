import { presenceProps, useListPresence } from '@shared/motion'
import UnavailableNote from '../UnavailableNote'
import { countsLabel, dueLabel, type ProjectRow } from '../hub'
import { adminNames, unavailableLines } from '../unavailable'
import type { Project, Space, SpaceSummary } from '../types'
import TweenedNumber from '@shared/components/motion/TweenedNumber'
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
  done,
  presence,
}: {
  row: ProjectRow
  admins: string[]
  busy: boolean
  handlers: Handlers
  /** Completed as shown: the optimistic value while a toggle is saving, else the server's. */
  done: boolean
  presence: ReturnType<typeof presenceProps>
}) {
  const { project, counts } = row
  const actions = project.allowedActions
  const reasons = project.unavailableReasons
  const notes = unavailableLines(
    [
      { off: actions.update === false, reason: reasons?.update },
      { off: actions.move === false, reason: reasons?.move },
      { off: actions.delete === false, reason: reasons?.delete },
    ],
    admins,
  )
  return (
    <li
      className={`hub-row hub-project${done ? ' is-completed' : ''}`}
      {...presence}
    >
      <button
        type="button"
        className="hub-project__main"
        aria-label={`${project.name} 작업 보기. ${counts ? countsLabel(counts) : '작업 수 없음'}`}
        onClick={() => handlers.onOpen(project)}
      >
        <strong>
          <span className="motion-strike" data-done={done || undefined}>
            {project.name}
          </span>
        </strong>
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
      <span className="hub-count" data-pending={!counts || undefined}>
        {counts ? (
          <>
            <TweenedNumber value={counts.completed} />/<TweenedNumber value={counts.total} />
          </>
        ) : (
          '–'
        )}
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
  loadError,
  onRetry,
  busy,
  settling = null,
  ...handlers
}: {
  space: Space
  rows: ProjectRow[]
  withoutProject: SpaceSummary['withoutProject'] | null
  /** 숫자를 처음 불러오지 못했을 때의 문구. 다시 읽기만 실패하면 null이라 보이던 숫자를 둔다. */
  loadError: string | null
  onRetry: () => void
  busy: boolean
  /**
   * A completion toggle that is saving or just saved: its row shows the new state before the
   * server answers, and keeps it while it leaves for the other list.
   */
  settling?: { id: number; completed: boolean } | null
} & Handlers) {
  const admins = adminNames(space.members)
  const open = rows.filter((row) => !row.project.completed)
  const closed = rows.filter((row) => row.project.completed)
  const loose = withoutProject?.counts
  const createNotes = unavailableLines(
    [{ off: space.allowedActions.update === false, reason: space.unavailableReasons?.update }],
    admins,
  )
  // A row stays in its list until the server confirms the toggle, so the strike is seen
  // drawing (or retracting) in place before the row leaves for the other list.
  const openRows = useListPresence(open, (row) => row.project.id, {
    resetKey: space.id,
  })
  const closedRows = useListPresence(closed, (row) => row.project.id, {
    resetKey: space.id,
  })
  const list = (items: typeof openRows) => (
    <ul className="hub-rows">
      {items.map(({ key, item: row, phase }) => (
        <Row
          key={key}
          row={row}
          admins={admins}
          busy={busy}
          handlers={handlers}
          presence={presenceProps(phase)}
          done={
            settling?.id === row.project.id
              ? settling.completed
              : row.project.completed
          }
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
      {loadError && (
        <p className="hub-load-error" role="alert">
          {loadError}{' '}
          <button type="button" className="space-text-button" onClick={onRetry}>
            다시 시도
          </button>
        </p>
      )}
      {openRows.length ? (
        list(openRows)
      ) : (
        <p className="hub-empty">
          진행 중인 프로젝트가 없어요. 목적에 다가갈 첫 프로젝트를 만들어 보세요.
        </p>
      )}
      {closed.length > 0 && (
        <details className="hub-closed">
          <summary>완료한 프로젝트 {closed.length}개</summary>
          {list(closedRows)}
        </details>
      )}
      {loose && loose.total > 0 && (
        <div className="hub-loose">
          <span>프로젝트 없이 기록한 작업 {loose.total}개</span>
          <span className="sr-only">{countsLabel(loose)}</span>
          <TaskDots counts={loose} />
        </div>
      )}
    </section>
  )
}
