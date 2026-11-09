import { Fragment } from 'react'
import SpaceMark from '../SpaceMark'
import UnavailableNote from '../UnavailableNote'
import { adminNames, unavailableLines } from '../unavailable'
import type { Space } from '../types'

/** 개관 머리(표시 색, 이름, 참여자)와 목적. 목적이 화면의 주인공이다. */
export default function HubIdentity({
  space,
  meId,
  busy,
  onEditPurpose,
  onDeletePurpose,
}: {
  space: Space
  meId: number | null
  busy: boolean
  onEditPurpose: () => void
  onDeletePurpose: () => void
}) {
  const canEdit = Boolean(space.allowedActions.update) && !busy
  const notes = unavailableLines(
    [
      {
        off: space.allowedActions.update === false,
        reason: space.unavailableReasons?.update ?? space.unavailableReasons?.edit,
      },
      {
        off: Boolean(space.purpose) && space.allowedActions.edit === false,
        reason: space.unavailableReasons?.edit,
      },
    ],
    adminNames(space.members),
  )
  return (
    <>
      <header className="hub-identity">
        <SpaceMark space={space} />
        <h2 id="hub-space-title">{space.name}</h2>
        <p className="hub-identity__members">
          {space.personal
            ? '본인 전용'
            : space.members.map((member, index) => (
                <Fragment key={member.memberId}>
                  {index > 0 && ', '}
                  {member.memberId === meId ? '나' : member.nickname}
                  {member.role === 'ADMIN' && <small>관리자</small>}
                </Fragment>
              ))}
        </p>
      </header>
      {space.purpose ? (
        <div className="hub-purpose">
          <p className="hub-purpose__text">{space.purpose}</p>
          <div className="hub-purpose__actions">
            <button
              type="button"
              className="space-text-button"
              disabled={!canEdit}
              onClick={onEditPurpose}
            >
              목적 수정
            </button>
            <button
              type="button"
              className="space-text-button"
              disabled={!space.allowedActions.edit || busy}
              onClick={onDeletePurpose}
            >
              목적 내용 삭제
            </button>
          </div>
        </div>
      ) : (
        <div className="hub-purpose is-empty">
          <p>
            {space.personal
              ? '목적 없이 바로 기록해도 괜찮아요.'
              : '이 스페이스에서 이루려는 것을 적어 두면 참여자 모두가 같은 방향을 볼 수 있어요.'}
          </p>
          <button
            type="button"
            className={space.personal ? 'space-text-button' : 'workspace-button'}
            disabled={!canEdit}
            onClick={onEditPurpose}
          >
            목적 작성
          </button>
        </div>
      )}
      {notes.map((line) => (
        <UnavailableNote key={line} text={line} />
      ))}
    </>
  )
}
