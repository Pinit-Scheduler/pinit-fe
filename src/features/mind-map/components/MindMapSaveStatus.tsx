import { SAVE_LABELS } from '../model/saveMachine'
import type { SaveStatus } from '../model/saveMachine'

type Props = {
  status: SaveStatus
  failure: string | null
  onRetry: () => void
}

/**
 * 저장 상태. 저장하지 못했으면 이유 한 줄과 `다시 시도`. 화면 읽기에는 저장하지 못한 이유만 알린다
 * (저장할 때마다 바뀌는 `저장 중…`·`저장됨`은 알리지 않는다). 알림 자리는 늘 두어야 바뀐 글을 읽어 준다.
 */
export default function MindMapSaveStatus({ status, failure, onRetry }: Props) {
  const failed = status === 'failed'
  const reason = failed ? failure : null
  return (
    <div className={`mind-map-save mind-map-save--${status}`}>
      <span className="mind-map-save__label">{SAVE_LABELS[status]}</span>
      <span className="mind-map-save__reason" aria-live="polite" title={reason ?? undefined}>
        {reason}
      </span>
      {failed && (
        <button type="button" className="mind-map-save__retry" onClick={onRetry}>
          다시 시도
        </button>
      )}
    </div>
  )
}
