import './SavedMark.css'

/**
 * 저장이 끝났다는 조용한 표시. 체크가 펜으로 긋듯 그려진 뒤 잠시 머물다 사라진다.
 * 자리는 늘 차지해 나타나고 사라질 때 줄이 밀리지 않는다. 안내 문구는 토스트·화면 문구가 맡으므로 보조 기술에는 숨긴다.
 */
const SavedMark = ({ visible }: { visible: boolean }) => (
  <span className="saved-mark" data-visible={visible || undefined} aria-hidden>
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none">
      <path d="m5 12 4 4L19 6" pathLength={1} />
    </svg>
  </span>
)

export default SavedMark
