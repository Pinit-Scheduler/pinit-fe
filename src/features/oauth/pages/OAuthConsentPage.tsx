import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { rememberReturnTo } from '@features/auth/utils/returnTo'
import { formatDateTimeWithZone } from '@shared/utils/datetime'
import { fetchAuthorizationRequest, submitAuthorizationDecision } from '../api/oauth'
import type { OAuthAuthorizationRequest } from '../types/oauth'
import {
  EXPIRED_REQUEST_MESSAGE,
  DELETE_SCOPE,
  buildConsentScopeOptions,
  getDefaultSelectedScopes,
  isNavigableRedirectUri,
  isRequestExpired,
  toConsentError,
  toDecisionScopes,
} from '../utils/consent'
import type { ConsentError } from '../utils/consent'
import './OAuthConsentPage.css'

type Phase = 'loading' | 'ready' | 'submitting' | 'redirecting' | 'error'

// vercel.json 헤더(frame-ancestors 'none')가 1차 방어이고, 헤더 없이 받은 문서에서도 동의 버튼이 framing되지 않도록 한 번 더 막는다.
const isFramed = () => {
  try {
    return window.self !== window.top
  } catch {
    return true
  }
}

const OAuthConsentPage = () => {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const requestId = searchParams.get('request')?.trim() ?? ''
  const [framed] = useState(isFramed)

  const [phase, setPhase] = useState<Phase>('loading')
  const [request, setRequest] = useState<OAuthAuthorizationRequest | null>(null)
  const [error, setError] = useState<ConsentError | null>(null)
  const [decisionError, setDecisionError] = useState<string | null>(null)
  // 사용자가 체크한 선택 scope(쓰기·삭제·모르는 권한). 필수 scope는 여기에 넣지 않는다.
  const [selectedScopes, setSelectedScopes] = useState<string[]>([])
  const [attempt, setAttempt] = useState(0)

  const goToLogin = useCallback(() => {
    rememberReturnTo(`${window.location.pathname}${window.location.search}`)
    navigate('/login', { replace: true })
  }, [navigate])

  useEffect(() => {
    if (framed || !requestId) return

    let isMounted = true
    const load = async () => {
      setPhase('loading')
      setError(null)
      try {
        const response = await fetchAuthorizationRequest(requestId)
        if (!isMounted) return
        setRequest(response)
        setSelectedScopes(getDefaultSelectedScopes(response.requestedScopes, response.optInScopes ?? []))
        setPhase('ready')
      } catch (err) {
        if (!isMounted) return
        const next = toConsentError(err)
        if (next.kind === 'unauthorized') {
          goToLogin()
          return
        }
        setError(next)
        setPhase('error')
      }
    }
    load()
    return () => {
      isMounted = false
    }
  }, [framed, requestId, attempt, goToLogin])

  const handleDecision = async (approve: boolean) => {
    if (!request || phase !== 'ready') return
    if (isRequestExpired(request.expiresAt)) {
      setError({ kind: 'expired', message: EXPIRED_REQUEST_MESSAGE })
      setPhase('error')
      return
    }

    setPhase('submitting')
    setDecisionError(null)
    try {
      const { redirectUri } = await submitAuthorizationDecision({
        requestId: request.requestId,
        approve,
        scopes: approve ? toDecisionScopes(request.requestedScopes, request.optInScopes ?? [], selectedScopes) : [],
      })
      if (!isNavigableRedirectUri(redirectUri)) {
        setDecisionError('앱으로 돌아갈 주소가 올바르지 않아요. AI 클라이언트에서 연결을 다시 시작해주세요.')
        setPhase('ready')
        return
      }
      setPhase('redirecting')
      // localhost나 다른 origin의 클라이언트 redirect URI로 전체 페이지 이동한다.
      window.location.assign(redirectUri)
    } catch (err) {
      const next = toConsentError(err)
      if (next.kind === 'unauthorized') {
        goToLogin()
        return
      }
      if (next.kind === 'expired') {
        setError(next)
        setPhase('error')
        return
      }
      setDecisionError(next.message)
      setPhase('ready')
    }
  }

  const renderBody = () => {
    if (framed) {
      return (
        <div className="consent__state" role="alert">
          <h1>이 화면은 다른 사이트 안에서 열 수 없어요</h1>
          <p>
            <a href={window.location.href} target="_blank" rel="noopener noreferrer">
              새 창에서 열기
            </a>
          </p>
        </div>
      )
    }

    if (!requestId) {
      return (
        <div className="consent__state" role="alert">
          <h1>연결 요청을 열 수 없어요</h1>
          <p>연결 요청 정보가 없어요. AI 클라이언트에서 연결을 다시 시작해주세요.</p>
        </div>
      )
    }

    if (phase === 'loading') {
      return (
        <div className="consent__state" role="status">
          <h1>연결 요청을 확인하는 중...</h1>
        </div>
      )
    }

    if (phase === 'error' && error) {
      return (
        <div className="consent__state" role="alert">
          <h1>{error.kind === 'expired' ? '연결 요청이 만료됐어요' : '연결 요청을 열 수 없어요'}</h1>
          <p>{error.message}</p>
          {error.kind !== 'expired' && (
            <button type="button" className="consent__btn consent__btn--secondary" onClick={() => setAttempt((n) => n + 1)}>
              다시 시도
            </button>
          )}
          <button type="button" className="consent__btn consent__btn--ghost" onClick={() => navigate('/app', { replace: true })}>
            Pinit으로 가기
          </button>
        </div>
      )
    }

    if (!request) return null

    if (phase === 'redirecting') {
      return (
        <div className="consent__state" role="status">
          <h1>{request.clientName}(으)로 돌아가는 중...</h1>
          <p>
            <strong>{request.redirectHost}</strong>(으)로 이동하고 있어요. 이동하지 않으면 이 창을 닫고 AI 클라이언트를 확인해주세요.
          </p>
        </div>
      )
    }

    const scopeOptions = buildConsentScopeOptions(request.requestedScopes, request.optInScopes ?? [])
    const isBusy = phase === 'submitting'
    const deleteRequested = scopeOptions.some((option) => option.scope === DELETE_SCOPE)
    const toggleScope = (scope: string, checked: boolean) =>
      setSelectedScopes((prev) => (checked ? [...new Set([...prev, scope])] : prev.filter((item) => item !== scope)))

    return (
      <>
        <p className="consent__eyebrow">AI 앱 연결 요청</p>
        <h1 className="consent__title">
          <span className="consent__client">{request.clientName}</span>이(가) 내 Pinit 계정에 접근하려고 해요
        </h1>

        <dl className="consent__facts">
          <div>
            <dt>허용하면 이동할 곳</dt>
            <dd className="consent__host">{request.redirectHost}</dd>
          </div>
          <div>
            <dt>앱 ID</dt>
            <dd className="consent__client-id">{request.clientId}</dd>
          </div>
        </dl>

        {request.localhostRedirect && (
          <div className="consent__warning" role="note">
            <strong>이 컴퓨터에서 실행 중인 앱이에요</strong>
            <p>
              허용하면 이 컴퓨터의 프로그램({request.redirectHost})이 Pinit에 접근하게 돼요. Claude Code처럼 내가 직접 시작한 앱일
              때만 계속하세요.
            </p>
          </div>
        )}

        <fieldset className="consent__scopes" disabled={isBusy}>
          <legend>허용할 권한</legend>
          {scopeOptions.map((option) => {
            const checked = option.required || selectedScopes.includes(option.scope)
            return (
              <label
                key={option.scope}
                className={['consent__scope', option.warning && 'consent__scope--caution'].filter(Boolean).join(' ')}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={option.required}
                  onChange={(event) => toggleScope(option.scope, event.target.checked)}
                />
                <span>
                  <span className={option.unknown ? 'consent__scope-label consent__scope-label--raw' : 'consent__scope-label'}>
                    {option.label}
                  </span>
                  <span className="consent__scope-meta">
                    {option.required ? '필수' : option.unknown ? '선택 · 이 화면이 모르는 권한이에요' : '선택'}
                  </span>
                  {option.warning && <span className="consent__scope-warning">{option.warning}</span>}
                </span>
              </label>
            )
          })}
        </fieldset>

        <ul className="consent__notes">
          <li>
            {deleteRequested
              ? '삭제를 체크하지 않으면 AI 앱은 일정이나 작업을 삭제할 수 없어요.'
              : 'AI 앱은 Pinit을 통해 일정이나 작업을 삭제할 수 없어요.'}
          </li>
          <li>연결은 설정 &gt; 연결된 앱에서 언제든 끊을 수 있어요.</li>
          <li>이 요청은 {formatDateTimeWithZone(request.expiresAt, 'HH:mm')}까지 유효해요.</li>
        </ul>

        {decisionError && (
          <p className="consent__error" role="alert">
            {decisionError}
          </p>
        )}

        <div className="consent__actions">
          <button
            type="button"
            className="consent__btn consent__btn--secondary"
            onClick={() => handleDecision(false)}
            disabled={isBusy}
          >
            거부
          </button>
          <button
            type="button"
            className="consent__btn consent__btn--primary"
            onClick={() => handleDecision(true)}
            disabled={isBusy}
          >
            {isBusy ? '처리 중...' : '허용'}
          </button>
        </div>
      </>
    )
  }

  return (
    <div className="consent">
      <main className="consent__card">
        <div className="consent__brand">
          <img src="/icons/icon.svg" alt="" className="consent__logo" />
          <span>Pinit</span>
        </div>
        {renderBody()}
      </main>
    </div>
  )
}

export default OAuthConsentPage
