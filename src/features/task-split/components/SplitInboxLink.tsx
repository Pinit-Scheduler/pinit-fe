import { Link } from 'react-router-dom'
import WorkspaceIcon from '@shared/components/common/WorkspaceIcon'
import { useSplitSummary } from '../hooks/useSplitSummary'
import { SPLIT_INBOX_PATH } from '../utils/splitPaths'

/** 작업 목록 머리의 보관함 입구. 쪼개기를 쓸 수 있거나 보관함에 무언가 있을 때만 보인다. */
const SplitInboxLink = () => {
  const { summary } = useSplitSummary()
  if (!summary || !(summary.available || summary.archiveCount > 0)) return null
  return (
    <Link className="workspace-button split-inbox-link" to={SPLIT_INBOX_PATH}>
      <WorkspaceIcon name="split" />
      쪼개기 보관함
      {summary.archiveCount > 0 && (
        <span className="split-inbox-link__count">{summary.archiveCount}</span>
      )}
    </Link>
  )
}

export default SplitInboxLink
