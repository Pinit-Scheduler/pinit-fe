import WorkspaceIcon from '@shared/components/common/WorkspaceIcon'
import UnavailableNote from '@features/spaces/UnavailableNote'
import { blockedText, type SplitEntry } from '../utils/splitEntry'
import { RECOMMEND_NOTE } from '../utils/splitLabels'

type SplitOfferProps = { entry: SplitEntry; admins: string[]; onStart: () => void }

/** 작업 상세의 쪼개기 줄. 다른 동작 버튼 아래에 한 줄을 통째로 쓴다. */
const SplitOffer = ({ entry, admins, onStart }: SplitOfferProps) => {
  if (entry.kind !== 'offer') return null
  return (
    <div className="split-offer">
      <button
        type="button"
        className="workspace-button"
        disabled={!entry.enabled}
        onClick={onStart}
      >
        <WorkspaceIcon name="split" /> 쪼개기
      </button>
      {entry.recommended && <p>{RECOMMEND_NOTE}</p>}
      {entry.blockedReasons.map((reason) => (
        <UnavailableNote key={reason} text={blockedText(reason, admins)} />
      ))}
    </div>
  )
}

export default SplitOffer
