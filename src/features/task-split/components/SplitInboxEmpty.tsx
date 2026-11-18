import { Link } from 'react-router-dom'

/**
 * 빈 쪼개기 보관함. 쪼개기를 쓸 수 없으면(요약의 `available`이 false이거나 읽지 못함) 입구가 없으니
 * "쪼개기"를 누르라고 하지 않는다.
 */
const SplitInboxEmpty = ({ startable }: { startable: boolean }) => (
  <div className="split-empty">
    <p>보관함이 비어 있어요.</p>
    {startable && <p>4시간이 넘는 큰 작업을 열고 "쪼개기"를 눌러 보세요.</p>}
    <Link className="workspace-button" to="/app/tasks">
      작업 목록으로
    </Link>
  </div>
)

export default SplitInboxEmpty
