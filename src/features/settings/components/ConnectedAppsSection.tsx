import { useState } from 'react'
import { useToast } from '@contexts/ToastContext'
import { StatusPanel } from '@shared/components/common'
import { formatDateTimeWithZone } from '@shared/utils/datetime'
import type { OAuthGrant } from '@features/oauth/types/oauth'
import { hasWriteScope } from '@features/oauth/utils/consent'
import useOAuthGrants from '../hooks/useOAuthGrants'
import './ConnectedAppsSection.css'

const DATE_FORMAT = 'YYYY.MM.DD HH:mm'

const toRevokeErrorMessage = (error: unknown) => {
  const status = error && typeof error === 'object' ? (error as { status?: unknown }).status : undefined
  if (status === 404) return '이미 연결이 끊긴 앱이에요. 목록을 새로 불러왔어요.'
  return error instanceof Error && error.message ? error.message : '연결을 끊지 못했어요.'
}

const ConnectedAppsSection = () => {
  const { addToast } = useToast()
  const { grants, isLoading, error, refetch, revoke } = useOAuthGrants()
  const [revokingId, setRevokingId] = useState<OAuthGrant['grantId'] | null>(null)

  const handleRevoke = async (grant: OAuthGrant) => {
    if (
      !window.confirm(
        `"${grant.clientName}" 앱의 연결을 끊으시겠습니까?\n이 앱은 즉시 Pinit에 접근할 수 없게 되고, 다시 쓰려면 앱에서 로그인·동의를 다시 해야 해요.`,
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

  const renderList = () => {
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
      return (
        <StatusPanel
          variant="empty"
          title="연결된 앱이 없어요."
          description="AI 클라이언트에 서버 주소를 등록하고 로그인·동의하면 여기에 표시돼요."
        />
      )
    }
    return (
      <ul className="connected-apps__list" aria-label="연결된 앱 목록">
        {grants.map((grant) => {
          const isRevoking = revokingId === grant.grantId
          return (
            <li key={grant.grantId} className="connected-apps__item">
              <div className="connected-apps__main">
                <div className="connected-apps__title">
                  <p className="settings__label">{grant.clientName}</p>
                  <span className="settings__badge">{hasWriteScope(grant.scopes) ? '보기 + 변경' : '보기만'}</span>
                </div>
                <code className="connected-apps__client-id">{grant.clientId}</code>
                <dl className="connected-apps__meta">
                  <div>
                    <dt>연결</dt>
                    <dd>{formatDateTimeWithZone(grant.createdAt, DATE_FORMAT)}</dd>
                  </div>
                  <div>
                    <dt>마지막 사용</dt>
                    <dd>{grant.lastUsedAt ? formatDateTimeWithZone(grant.lastUsedAt, DATE_FORMAT) : '사용 기록 없음'}</dd>
                  </div>
                </dl>
              </div>
              <button
                type="button"
                className="connected-apps__revoke-btn"
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
    <section className="settings__card connected-apps" aria-label="연결된 앱">
      <h2>연결된 앱</h2>
      <p className="settings__description">로그인·동의로 내 Pinit 계정에 연결한 AI 앱이에요. 연결을 끊으면 그 앱의 토큰이 모두 무효가 돼요.</p>
      {renderList()}
    </section>
  )
}

export default ConnectedAppsSection
