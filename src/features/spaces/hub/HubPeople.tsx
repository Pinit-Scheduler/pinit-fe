import UnavailableNote from '../UnavailableNote'
import { dueLabel, type MemberRow } from '../hub'
import { adminNames, unavailableLines } from '../unavailable'
import type { Space, SpaceSummary } from '../types'
import RowMenu from './RowMenu'

/** 참여자별 맡은 미완료와 담당자 미정. 개인 스페이스에서는 그리지 않는다. */
export default function HubPeople({
  space,
  rows,
  unassigned,
  failed,
  onRetry,
  busy,
  onInvite,
  onToggleAdmin,
  onRemove,
}: {
  space: Space
  rows: MemberRow[]
  unassigned: SpaceSummary['unassigned'] | null
  failed: boolean
  onRetry: () => void
  busy: boolean
  onInvite: () => void
  onToggleAdmin: (row: MemberRow) => void
  onRemove: (row: MemberRow) => void
}) {
  const actions = space.allowedActions
  // 참여자 관리가 꺼지면 그 메뉴 자체를 그리지 않으므로, 안내는 보이는 초대 버튼에만 단다.
  const notes = unavailableLines(
    [{ off: actions.invite === false, reason: space.unavailableReasons?.invite }],
    adminNames(space.members),
  )
  return (
    <section
      className="hub-section"
      id="hub-people"
      aria-labelledby="hub-people-title"
    >
      <div className="hub-section__head">
        <h3 id="hub-people-title">담당</h3>
        <button
          type="button"
          className="workspace-button"
          disabled={!actions.invite || busy}
          onClick={onInvite}
        >
          {busy ? '처리 중…' : '초대 링크 만들기'}
        </button>
      </div>
      {notes.map((line) => (
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
      {rows.length === 1 && (
        <p className="hub-empty">
          아직 혼자 쓰는 스페이스예요. 초대 링크로 함께할 사람을 불러 보세요.
        </p>
      )}
      <ul className="hub-rows">
        {rows.map((row) => (
          <li className="hub-row hub-person" key={row.memberId}>
            <span className="hub-person__name">
              {row.name}
              {row.admin && <small>관리자</small>}
            </span>
            <span className="hub-count">
              미완료 {row.openAssignedCount ?? '–'}
            </span>
            <span className="hub-due">{dueLabel(row.nearestDueDate)}</span>
            {!row.me && actions.manageMembers ? (
              <RowMenu label={`${row.name} 참여자 동작`}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onToggleAdmin(row)}
                >
                  {row.admin ? '관리자 해제' : '관리자 지정'}
                </button>
                <button
                  type="button"
                  className="is-danger"
                  disabled={busy}
                  onClick={() => onRemove(row)}
                >
                  스페이스에서 제외
                </button>
              </RowMenu>
            ) : (
              <span className="hub-menu-placeholder" aria-hidden />
            )}
          </li>
        ))}
      </ul>
      {unassigned && unassigned.openCount > 0 ? (
        <div className="hub-unassigned">
          <span className="hub-person__name">담당자 미정</span>
          <span className="hub-count">{unassigned.openCount}개</span>
          <span className="hub-due">{dueLabel(unassigned.nearestDueDate)}</span>
          <p>담당자가 없는 작업은 누구의 오늘에도 나오지 않아요.</p>
        </div>
      ) : unassigned ? (
        <p className="hub-quiet">모든 작업에 담당자가 있어요.</p>
      ) : null}
    </section>
  )
}
