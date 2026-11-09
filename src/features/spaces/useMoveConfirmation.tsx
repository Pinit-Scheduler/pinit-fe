import { useEffect, useRef, useState } from 'react'
import Modal from '@shared/components/common/Modal'
import { useSpaces } from './store'
export type MoveResult = {
  movedTaskIds: number[]
  movedScheduleIds: number[]
  removedDependencyCount: number
}
export function moveResultMessage(result?: MoveResult) {
  if (!result) return null
  return `소속을 옮겼어요. 작업 ${result.movedTaskIds.length}개·일정 ${result.movedScheduleIds.length}개가 함께 이동했고, 공간을 가로지르던 선행 관계 ${result.removedDependencyCount}개를 해제·기록했어요.`
}
export function useMoveConfirmation() {
  const { spaces } = useSpaces()
  const [target, setTarget] = useState<number | null>(null)
  const resolve = useRef<((value: boolean) => void) | null>(null)
  useEffect(
    () => () => {
      resolve.current?.(false)
    },
    [],
  )
  const finish = (accepted: boolean) => {
    resolve.current?.(accepted)
    resolve.current = null
    setTarget(null)
  }
  return {
    confirm: (from: number | undefined, to: number | undefined) => {
      if (from === undefined || to === undefined || from === to)
        return Promise.resolve(true)
      resolve.current?.(false)
      setTarget(to)
      return new Promise<boolean>((done) => {
        resolve.current = done
      })
    },
    dialog:
      target === null ? null : (
        <Modal
          labelledBy="space-move-title"
          backdropClassName="space-dialog-backdrop"
          className="space-dialog space-dialog--notice"
          onClose={() => finish(false)}
        >
          <h2 id="space-move-title">다른 공간으로 옮길까요?</h2>
          <div className="space-dialog__body">
            <p>
              <strong>
                {spaces.find((space) => space.id === target)?.name ??
                  '선택한 공간'}
              </strong>
              으로 연결된 작업과 일정을 함께 이동합니다. 공유 공간에서는 이동 전
              과거 기록도 참여자에게 공개됩니다.
            </p>
            <p>
              원래 공간에 남은 작업과의 선행 관계는 해제되고 기록됩니다. 같은
              공간에서 프로젝트만 바꾸면 선행 관계가 유지됩니다.
            </p>
          </div>
          <div className="space-dialog__actions">
            <button className="workspace-button" onClick={() => finish(false)}>
              취소
            </button>
            <button
              className="workspace-button workspace-button--primary"
              onClick={() => finish(true)}
            >
              확인하고 이동
            </button>
          </div>
        </Modal>
      ),
  }
}
