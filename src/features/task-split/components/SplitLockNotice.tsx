import type { SplitLock } from '../api/taskSplitInfo'
import { lockNotice } from '../utils/splitLabels'

/** 작업 상세 위의 잠금 안내. */
const SplitLockNotice = ({ lock }: { lock: SplitLock }) => {
  const { strong, rest } = lockNotice(lock)
  return (
    <div className="split-lock" role="status">
      <p>
        <strong>{strong}</strong>
        {rest}
      </p>
    </div>
  )
}

export default SplitLockNotice
