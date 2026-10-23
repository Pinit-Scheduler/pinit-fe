import { useState } from 'react'
import type { FormEvent } from 'react'
import { useToast } from '@contexts/ToastContext'
import { StatusPanel } from '@shared/components/common'
import { formatDateTimeWithZone } from '@shared/utils/datetime'
import usePersonalAccessTokens from '../hooks/usePersonalAccessTokens'
import type {
  PersonalAccessToken,
  PersonalAccessTokenAccess,
  PersonalAccessTokenStatus,
} from '../types/personalAccessToken'
import {
  DEFAULT_EXPIRY_DAYS,
  EXPIRY_DAY_OPTIONS,
  MAX_ACTIVE_PERSONAL_ACCESS_TOKENS,
  MAX_TOKEN_NAME_LENGTH,
  accessFromScopes,
  formatTokenHint,
  getTokenStatus,
  toCreateErrorMessage,
  toCreateRequest,
  toRevokeErrorMessage,
  validateCreateForm,
} from '../utils/personalAccessTokens'
import type { CreatePersonalAccessTokenFormErrors } from '../utils/personalAccessTokens'
import { buildClaudeCodeCommandWithToken, buildMcpJsonConfigWithToken } from '../utils/mcpConnection'
import { MCP_SERVER_URL } from '../utils/mcpServerUrl'
import CopyableCode from './CopyableCode'
import './PersonalAccessTokenSection.css'

const DATE_FORMAT = 'YYYY.MM.DD HH:mm'

const ACCESS_OPTIONS: { value: PersonalAccessTokenAccess; label: string; description: string }[] = [
  { value: 'read', label: '읽기 전용', description: '작업·일정 조회만 할 수 있어요. (mcp:read)' },
  {
    value: 'write',
    label: '읽기 + 쓰기',
    description: '조회에 더해 생성·수정·상태 변경까지 할 수 있어요. (mcp:read, mcp:write)',
  },
]

const STATUS_LABELS: Record<PersonalAccessTokenStatus, string> = {
  active: '활성',
  expired: '만료',
  revoked: '폐기됨',
}

const STATUS_BADGE_CLASSES: Record<PersonalAccessTokenStatus, string> = {
  active: 'settings__badge settings__badge--positive',
  expired: 'settings__badge settings__badge--muted',
  revoked: 'settings__badge settings__badge--error',
}

// 평문 토큰은 이 컴포넌트의 메모리 상태에만 두고, 확인 버튼이나 화면 이탈 시 사라진다.
type RevealedToken = {
  name: string
  token: string
}

const PersonalAccessTokenSection = () => {
  const { addToast } = useToast()
  const { tokens, activeCount, isLoading, error, refetch, create, revoke } = usePersonalAccessTokens()
  const [name, setName] = useState('')
  const [access, setAccess] = useState<PersonalAccessTokenAccess>('read')
  const [expiresInDays, setExpiresInDays] = useState<number>(DEFAULT_EXPIRY_DAYS)
  const [formErrors, setFormErrors] = useState<CreatePersonalAccessTokenFormErrors>({})
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [revokingId, setRevokingId] = useState<number | null>(null)
  const [revealed, setRevealed] = useState<RevealedToken | null>(null)
  const [isOpen, setIsOpen] = useState(false)

  const isLimitReached = activeCount >= MAX_ACTIVE_PERSONAL_ACCESS_TOKENS

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = { name, access, expiresInDays }
    const errors = validateCreateForm(form)
    setFormErrors(errors)
    setSubmitError(null)
    if (Object.keys(errors).length > 0) return

    setIsSubmitting(true)
    try {
      const created = await create(toCreateRequest(form))
      setRevealed({ name: created.name, token: created.token })
      setName('')
      addToast('토큰을 발급했어요. 지금 복사해두세요.', 'success')
    } catch (err) {
      setSubmitError(toCreateErrorMessage(err))
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleRevoke = async (token: PersonalAccessToken) => {
    if (!window.confirm(`"${token.name}" 토큰을 폐기하시겠습니까?\n이 토큰을 쓰는 AI 클라이언트는 즉시 연결이 끊겨요.`)) {
      return
    }
    setRevokingId(token.id)
    try {
      await revoke(token.id)
      setSubmitError(null)
      addToast('토큰을 폐기했어요.', 'info')
    } catch (err) {
      addToast(toRevokeErrorMessage(err), 'error')
    } finally {
      setRevokingId(null)
    }
  }

  const renderList = () => {
    if (isLoading && tokens.length === 0) {
      return <StatusPanel variant="loading" title="토큰 목록을 불러오는 중..." />
    }
    if (error) {
      return (
        <StatusPanel
          variant="error"
          title="토큰 목록을 불러오지 못했어요."
          description={error}
          action={
            <button type="button" onClick={refetch}>
              다시 시도
            </button>
          }
        />
      )
    }
    if (tokens.length === 0) {
      return <StatusPanel variant="empty" title="발급한 토큰이 없어요." description="위에서 첫 토큰을 만들어 보세요." />
    }
    return (
      <ul className="pat__list" aria-label="발급한 토큰 목록">
        {tokens.map((token) => {
          const status = getTokenStatus(token)
          const isRevoking = revokingId === token.id
          return (
            <li key={token.id} className={['pat__item', status !== 'active' && 'pat__item--inactive'].filter(Boolean).join(' ')}>
              <div className="pat__item-main">
                <div className="pat__item-title">
                  <p className="settings__label">{token.name}</p>
                  <span className={STATUS_BADGE_CLASSES[status]}>{STATUS_LABELS[status]}</span>
                  <span className="settings__badge">
                    {accessFromScopes(token.scopes) === 'write' ? '읽기 + 쓰기' : '읽기 전용'}
                  </span>
                </div>
                <code className="pat__prefix">{formatTokenHint(token.tokenPrefix)}</code>
                <dl className="pat__meta">
                  <div>
                    <dt>발급</dt>
                    <dd>{formatDateTimeWithZone(token.createdAt, DATE_FORMAT)}</dd>
                  </div>
                  <div>
                    <dt>{status === 'expired' ? '만료됨' : '만료'}</dt>
                    <dd>{formatDateTimeWithZone(token.expiresAt, DATE_FORMAT)}</dd>
                  </div>
                  <div>
                    <dt>마지막 사용</dt>
                    <dd>{token.lastUsedAt ? formatDateTimeWithZone(token.lastUsedAt, DATE_FORMAT) : '사용 기록 없음'}</dd>
                  </div>
                  {token.revokedAt && (
                    <div>
                      <dt>폐기</dt>
                      <dd>{formatDateTimeWithZone(token.revokedAt, DATE_FORMAT)}</dd>
                    </div>
                  )}
                </dl>
              </div>
              {status === 'active' && (
                <button
                  type="button"
                  className="pat__revoke-btn"
                  onClick={() => handleRevoke(token)}
                  disabled={isRevoking}
                  aria-label={`${token.name} 토큰 폐기`}
                >
                  {isRevoking ? '폐기 중...' : '폐기'}
                </button>
              )}
            </li>
          )
        })}
      </ul>
    )
  }

  return (
    <section className="settings__card pat" aria-label="고급: 개인 액세스 토큰">
      {/* 기본 연결은 OAuth 로그인·동의라서 PAT는 접어 둔다. 발급 폼과 평문 토큰은 펼친 상태에서만 보인다. */}
      <details className="pat__advanced" open={isOpen} onToggle={(event) => setIsOpen(event.currentTarget.open)}>
        <summary className="pat__header">
          <h2>고급: 개인 액세스 토큰</h2>
          <span
            className={isLimitReached ? 'settings__badge settings__badge--warning' : 'settings__badge'}
            aria-label={`활성 토큰 ${activeCount}개, 최대 ${MAX_ACTIVE_PERSONAL_ACCESS_TOKENS}개`}
          >
            활성 {activeCount} / {MAX_ACTIVE_PERSONAL_ACCESS_TOKENS}
          </span>
        </summary>
        <div className="pat__body">
          <p className="settings__description">
            로그인·동의 연결을 지원하지 않는 클라이언트나 자동화 스크립트용이에요. 토큰을 Authorization 헤더로 보내 연결해요. 토큰은
            비밀번호처럼 다뤄주세요.
          </p>

          {revealed && (
            <div className="pat__reveal" role="alert">
              <p className="pat__reveal-title">"{revealed.name}" 토큰이 발급됐어요</p>
              <p className="pat__reveal-warning">
                이 토큰은 지금 한 번만 보여드려요. 창을 닫거나 이동하면 다시 확인할 수 없으니 바로 복사해 안전한 곳에 보관하세요.
              </p>
              <CopyableCode label="개인 액세스 토큰" value={revealed.token} />
              <button type="button" className="pat__reveal-dismiss" onClick={() => setRevealed(null)}>
                복사했어요, 닫기
              </button>
            </div>
          )}

          <form className="pat__form" onSubmit={handleSubmit} noValidate>
            <label className="pat__field">
              <span className="settings__label">토큰 이름</span>
              <input
                className="pat__input"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="예: Claude Code (회사 노트북)"
                maxLength={MAX_TOKEN_NAME_LENGTH}
                autoComplete="off"
                aria-invalid={Boolean(formErrors.name)}
              />
              {formErrors.name && <span className="pat__error">{formErrors.name}</span>}
            </label>

            <fieldset className="pat__field pat__fieldset">
              <legend className="settings__label">권한</legend>
              {ACCESS_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  className={['pat__option', access === option.value && 'is-selected'].filter(Boolean).join(' ')}
                >
                  <input
                    type="radio"
                    name="pat-access"
                    value={option.value}
                    checked={access === option.value}
                    onChange={() => setAccess(option.value)}
                  />
                  <span>
                    <span className="pat__option-label">{option.label}</span>
                    <span className="settings__description">{option.description}</span>
                  </span>
                </label>
              ))}
            </fieldset>

            <label className="pat__field">
              <span className="settings__label">만료 기간</span>
              <select
                className="pat__input"
                value={expiresInDays}
                onChange={(event) => setExpiresInDays(Number(event.target.value))}
                aria-invalid={Boolean(formErrors.expiresInDays)}
              >
                {EXPIRY_DAY_OPTIONS.map((days) => (
                  <option key={days} value={days}>
                    {days}일{days === DEFAULT_EXPIRY_DAYS ? ' (기본)' : ''}
                  </option>
                ))}
              </select>
              {formErrors.expiresInDays && <span className="pat__error">{formErrors.expiresInDays}</span>}
            </label>

            {isLimitReached && (
              <p className="pat__notice">
                활성 토큰은 최대 {MAX_ACTIVE_PERSONAL_ACCESS_TOKENS}개까지 가질 수 있어요. 쓰지 않는 토큰을 폐기한 뒤 다시 발급해주세요.
              </p>
            )}
            {submitError && (
              <p className="pat__error" role="alert">
                {submitError}
              </p>
            )}

            <button type="submit" className="settings__action-btn" disabled={isSubmitting || isLimitReached}>
              {isSubmitting ? '발급 중...' : '토큰 발급'}
            </button>
          </form>

          <h3 className="pat__subheading">발급한 토큰</h3>
          {renderList()}

          <h3 className="pat__subheading">토큰으로 연결하기</h3>
          <p className="settings__description">
            아래 예시의 <code>&lt;PAT&gt;</code> 자리에 발급받은 토큰을 넣어주세요.
          </p>
          <CopyableCode
            label="토큰을 쓰는 Claude Code 명령"
            value={buildClaudeCodeCommandWithToken(MCP_SERVER_URL)}
            multiline
            rows={4}
          />
          <CopyableCode label="토큰을 쓰는 MCP 설정 JSON" value={buildMcpJsonConfigWithToken(MCP_SERVER_URL)} multiline />
        </div>
      </details>
    </section>
  )
}

export default PersonalAccessTokenSection
