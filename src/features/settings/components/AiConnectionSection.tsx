import { useState } from 'react'
import { useToast } from '@contexts/ToastContext'
import { StatusPanel } from '@shared/components/common'
import { formatDateTimeWithZone } from '@shared/utils/datetime'
import type { OAuthGrant } from '@features/oauth/types/oauth'
import { hasDeleteScope } from '@features/oauth/utils/consent'
import useOAuthGrants from '../hooks/useOAuthGrants'
import { buildClaudeCodeCommand, formatConnectionCount } from '../utils/mcpConnection'
import { MCP_SERVER_URL } from '../utils/mcpServerUrl'
import CopyableCode from './CopyableCode'
import './AiConnectionSection.css'

const DATE_FORMAT = 'YYYY.MM.DD HH:mm'

const toRevokeErrorMessage = (error: unknown) => {
  const status = error && typeof error === 'object' ? (error as { status?: unknown }).status : undefined
  if (status === 404) return '이미 연결이 끊긴 앱이에요. 목록을 새로 불러왔어요.'
  return error instanceof Error && error.message ? error.message : '연결을 끊지 못했어요.'
}

const AiConnectionSection = () => {
  const { addToast } = useToast()
  const { grants, isLoading, error, refetch, revoke } = useOAuthGrants()
  const [revokingId, setRevokingId] = useState<OAuthGrant['grantId'] | null>(null)

  const handleRevoke = async (grant: OAuthGrant) => {
    // 백엔드는 같은 앱의 활성 연결(기기)을 모두 끊는다.
    if (
      !window.confirm(
        `"${grant.clientName}" 연결을 끊으시겠습니까?\n이 앱을 연결한 모든 기기에서 즉시 Pinit에 접근할 수 없게 되고, 다시 쓰려면 앱에서 로그인·허용을 다시 해야 해요.`,
      )
    ) {
      return
    }
    setRevokingId(grant.grantId)
    try {
      await revoke(grant.grantId)
      addToast(`${grant.clientName} 연결을 끊었어요.`, 'info')
    } catch (err) {
      addToast(toRevokeErrorMessage(err), 'error')
    } finally {
      setRevokingId(null)
    }
  }

  const renderGrants = () => {
    if (isLoading && grants.length === 0) {
      return <StatusPanel variant="loading" title="연결된 앱을 불러오는 중..." />
    }
    if (error) {
      return (
        <StatusPanel
          variant="error"
          title="연결된 앱을 불러오지 못했어요."
          description={error}
          action={
            <button type="button" onClick={refetch}>
              다시 시도
            </button>
          }
        />
      )
    }
    if (grants.length === 0) {
      return <StatusPanel variant="empty" title="연결된 앱이 없어요." />
    }
    return (
      <ul className="ai-connection__list" aria-label="연결된 앱 목록">
        {grants.map((grant) => {
          const isRevoking = revokingId === grant.grantId
          const connectionLabel = formatConnectionCount(grant.connectionCount)
          return (
            <li key={grant.grantId} className="ai-connection__item">
              <div className="ai-connection__main">
                <div className="ai-connection__title">
                  <p className="settings__label">{grant.clientName}</p>
                  {connectionLabel && <span className="settings__badge">{connectionLabel}</span>}
                  {hasDeleteScope(grant.scopes ?? []) && (
                    <span className="settings__badge settings__badge--warning">삭제 허용</span>
                  )}
                </div>
                <p className="ai-connection__meta">
                  마지막 사용 {grant.lastUsedAt ? formatDateTimeWithZone(grant.lastUsedAt, DATE_FORMAT) : '기록 없음'}
                </p>
              </div>
              <button
                type="button"
                className="ai-connection__revoke-btn"
                onClick={() => handleRevoke(grant)}
                disabled={isRevoking}
                aria-label={`${grant.clientName} 연결 끊기`}
              >
                {isRevoking ? '끊는 중...' : '연결 끊기'}
              </button>
            </li>
          )
        })}
      </ul>
    )
  }

  return (
    <section className="settings__card ai-connection" aria-label="AI 연결 (MCP)">
      <h2>AI 연결 (MCP)</h2>
      <p className="settings__description">AI 앱에 아래 주소를 등록한 뒤 Pinit에 로그인하고 허용하면 연결돼요.</p>
      <CopyableCode label="MCP 서버 URL" value={MCP_SERVER_URL} />
      <ul className="ai-connection__clients">
        <li>
          <strong>Claude.ai</strong> 설정 → 커넥터 → 커스텀 커넥터 추가에 이 주소 입력 후 로그인·허용
        </li>
        <li>
          <strong>Claude Code</strong> <code>{buildClaudeCodeCommand(MCP_SERVER_URL)}</code>
        </li>
      </ul>

      <h3 className="ai-connection__subheading">연결된 앱</h3>
      {renderGrants()}
    </section>
  )
}

export default AiConnectionSection
