import UnavailableNote from '../UnavailableNote'
import { adminNames, unavailableLines } from '../unavailable'
import type { Project, Space } from '../types'

export default function HubSettings({
  space,
  deletedSpaces,
  deletedProjects,
  busy,
  onEdit,
  onLeave,
  onDelete,
  onRestoreSpace,
  onRestoreProject,
}: {
  space: Space
  deletedSpaces: Space[]
  deletedProjects: Project[]
  busy: boolean
  onEdit: () => void
  onLeave: () => void
  onDelete: () => void
  onRestoreSpace: (space: Space) => void
  onRestoreProject: (project: Project) => void
}) {
  const actions = space.allowedActions
  const reasons = space.unavailableReasons
  const notes = unavailableLines(
    [
      { off: actions.update === false, reason: reasons?.update ?? reasons?.edit },
      ...(space.personal
        ? []
        : [
            { off: actions.leave === false, reason: reasons?.leave },
            { off: actions.delete === false, reason: reasons?.delete },
          ]),
    ],
    adminNames(space.members),
  )
  const deletedCount = deletedSpaces.length + deletedProjects.length
  return (
    <section
      className="hub-section hub-settings"
      aria-labelledby="hub-settings-title"
    >
      <h3 id="hub-settings-title">스페이스 설정</h3>
      <div className="hub-settings__row">
        <button
          type="button"
          className="space-text-button"
          disabled={!actions.update || busy}
          onClick={onEdit}
        >
          이름·목적 수정
        </button>
        {!space.personal && (
          <>
            <button
              type="button"
              className="space-text-button"
              disabled={!actions.leave || busy}
              onClick={onLeave}
            >
              스페이스 나가기
            </button>
            <button
              type="button"
              className="space-text-button space-text-button--danger"
              disabled={!actions.delete || busy}
              onClick={onDelete}
            >
              스페이스 삭제
            </button>
          </>
        )}
      </div>
      {notes.map((line) => (
        <UnavailableNote key={line} text={line} />
      ))}
      {space.personal && (
        <p className="hub-quiet">
          나의 스페이스는 본인 전용이라 초대·나가기·삭제가 없어요.
        </p>
      )}
      {deletedCount > 0 && (
        <details className="hub-closed">
          <summary>삭제한 스페이스·프로젝트 {deletedCount}개</summary>
          <p className="space-help">
            서버에서 복구 권한을 받은 항목만 복구할 수 있습니다.
          </p>
          <ul className="hub-rows">
            {deletedSpaces.map((item) => (
              <li className="hub-row hub-deleted" key={`s${item.id}`}>
                <span>
                  {item.name} <small>스페이스</small>
                </span>
                <button
                  type="button"
                  className="workspace-button"
                  disabled={!item.allowedActions.restore || busy}
                  onClick={() => onRestoreSpace(item)}
                >
                  복구
                </button>
              </li>
            ))}
            {deletedProjects.map((item) => (
              <li className="hub-row hub-deleted" key={`p${item.id}`}>
                <span>
                  {item.name} <small>프로젝트</small>
                </span>
                <button
                  type="button"
                  className="workspace-button"
                  disabled={!item.allowedActions.restore || busy}
                  onClick={() => onRestoreProject(item)}
                >
                  복구
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}
