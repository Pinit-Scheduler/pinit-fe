import { StatusPanel } from '@shared/components/common'
import { formatDateTimeWithZone } from '@shared/utils/datetime'
import useMcpActivity from '../hooks/useMcpActivity'
import { describeActivity, formatTargets, outcomeBadge } from '../utils/mcpActivity'
import './McpActivityList.css'

const DATE_FORMAT = 'MM.DD HH:mm'

/** 설정 "AI 연결" 안의 AI 사용 이력(ADR-0026 §8). 값은 서버에 없으므로 동작·대상 번호·결과만 보인다. */
const McpActivityList = () => {
  const { items, isLoading, isLoadingMore, error, hasMore, changesOnly, setChangesOnly, loadMore, refetch } =
    useMcpActivity()

  const renderItems = () => {
    if (isLoading && items.length === 0) {
      return <StatusPanel variant="loading" title="AI 사용 이력을 불러오는 중..." />
    }
    if (error && items.length === 0) {
      return (
        <StatusPanel
          variant="error"
          title="AI 사용 이력을 불러오지 못했어요."
          description={error}
          action={
            <button type="button" onClick={refetch}>
              다시 시도
            </button>
          }
        />
      )
    }
    if (items.length === 0) {
      return (
        <StatusPanel
          variant="empty"
          title={changesOnly ? 'AI가 바꾼 기록이 없어요.' : '아직 AI 사용 이력이 없어요.'}
        />
      )
    }
    return (
      <ul className="mcp-activity__list" aria-label="AI 사용 이력">
        {items.map((activity) => {
          const targets = formatTargets(activity.targets)
          const badge = outcomeBadge(activity.outcome)
          return (
            <li key={activity.id} className="mcp-activity__item">
              <div className="mcp-activity__line">
                <span className="mcp-activity__action">{describeActivity(activity)}</span>
                {badge && <span className="settings__badge settings__badge--error mcp-activity__badge">{badge}</span>}
              </div>
              <p className="mcp-activity__meta">
                <time dateTime={activity.calledAt}>{formatDateTimeWithZone(activity.calledAt, DATE_FORMAT)}</time>
                <span aria-hidden="true"> · </span>
                <span>{activity.clientName}</span>
                {targets && (
                  <>
                    <span aria-hidden="true"> · </span>
                    <span>{targets}</span>
                  </>
                )}
              </p>
            </li>
          )
        })}
      </ul>
    )
  }

  return (
    <div className="mcp-activity">
      <div className="mcp-activity__header">
        <h3 className="ai-connection__subheading mcp-activity__heading">AI 사용 이력</h3>
        <label className="mcp-activity__filter">
          <input
            type="checkbox"
            checked={changesOnly}
            onChange={(event) => setChangesOnly(event.target.checked)}
          />
          변경만 보기
        </label>
      </div>
      {renderItems()}
      {error && items.length > 0 && <p className="mcp-activity__error">{error}</p>}
      {hasMore && (
        <button type="button" className="mcp-activity__more" onClick={loadMore} disabled={isLoadingMore}>
          {isLoadingMore ? '불러오는 중...' : '더 보기'}
        </button>
      )}
      <p className="mcp-activity__note">최근 90일 기록만 보관하며, 제목·내용 같은 값은 저장하지 않아요.</p>
    </div>
  )
}

export default McpActivityList
