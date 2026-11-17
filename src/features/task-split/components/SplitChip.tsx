import WorkspaceIcon from '@shared/components/common/WorkspaceIcon'
import { showsRecommendChip, type SplitEntry } from '../utils/splitEntry'
import { lockChipLabel, lockNotice, RECOMMEND_CHIP } from '../utils/splitLabels'

type SplitChipProps = { entry: SplitEntry; onPress: () => void }

/** 작업 카드의 쪼개기 표시. 잠금은 두 단계, 그 밖에는 권할 때만 보인다. */
const SplitChip = ({ entry, onPress }: SplitChipProps) => {
  if (entry.kind === 'lock') {
    const { lock } = entry
    // 다른 참여자의 요청은 그 사람만 끝낼 수 있다. 누를 수 없게 두고 누가 걸었는지만 알린다.
    if (!lock.mine)
      return (
        <span className="split-chip" title={lockNotice(lock).strong}>
          <WorkspaceIcon name="split" />
          {lockChipLabel(lock.stage)}
        </span>
      )
    return (
      <button
        type="button"
        className="split-chip"
        data-status={lock.stage === 'PROPOSAL_READY' ? 'READY' : undefined}
        onClick={onPress}
      >
        <WorkspaceIcon name="split" />
        {lockChipLabel(lock.stage)}
      </button>
    )
  }
  if (!showsRecommendChip(entry)) return null
  return (
    <button type="button" className="split-chip" onClick={onPress}>
      <WorkspaceIcon name="split" />
      {RECOMMEND_CHIP}
    </button>
  )
}

export default SplitChip
