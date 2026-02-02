import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { exchangeSocialLogin, type AuthProvider } from '../api/auth'
import './LoginPage.css'

const SocialCallbackPage = () => {
  const { provider: rawProvider } = useParams<{ provider?: string }>()
  const provider: AuthProvider | null = rawProvider === 'naver' ? 'naver' : null
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const providerError = useMemo(
    () => (!provider ? '지원하지 않는 소셜 로그인 경로예요.' : null),
    [provider],
  )
  const [error, setError] = useState<string | null>(providerError)
  const [status, setStatus] = useState(
    provider ? 'OP에서 받은 토큰을 전달하는 중이에요...' : '오류가 발생했어요.',
  )

  const payload = useMemo(
    () => ({
      code: searchParams.get('code') || undefined,
      state: searchParams.get('state') || undefined,
      accessToken: searchParams.get('access_token') || undefined,
      error: searchParams.get('error') || undefined,
      errorDescription: searchParams.get('error_description') || undefined,
    }),
    [searchParams]
  )

  useEffect(() => {
    if (providerError || !provider) return

    let isCancelled = false

    // code/state/access_token 등을 백엔드로 전달해 토큰 교환
    exchangeSocialLogin(provider, payload)
      .then(() => {
        if (isCancelled) return
        setStatus('로그인 완료! 대시보드로 이동해요.')
        navigate('/app', { replace: true })
      })
      .catch((err) => {
        if (isCancelled) return
        const message =
          err instanceof Error
            ? err.message
            : '로그인 도중 오류가 발생했어요. 다시 시도해주세요.'
        setError(message)
        setStatus('오류가 발생했어요.')
      })

    return () => {
      isCancelled = true
    }
  }, [providerError, provider, payload, navigate])

  return (
    <div className="login login--callback">
      <div className="login__card">
        <p className="login__eyebrow">소셜 로그인 처리 중</p>
        <h1>잠시만 기다려주세요</h1>
        <p className="login__description">
          OP에서 받은 access token/code/state를 백엔드로 전달해 세션을 준비하고 있어요.
        </p>

        <div className="login__status">
          <div className="login__status-item">
            <span className="login__status-dot" />
            <div>
              <p className="login__status-label">상태</p>
              <p className="login__status-value">{status}</p>
            </div>
          </div>
          {error ? (
            <div className="login__status-item">
              <span className="login__status-dot login__status-dot--amber" />
              <div>
                <p className="login__status-label">오류</p>
                <p className="login__status-value">{error}</p>
              </div>
            </div>
          ) : null}
        </div>

        <p className="login__helper">
          브라우저에 access·refresh 토큰을 안전하게 세팅한 뒤 대시보드로 이동합니다.
        </p>
      </div>
    </div>
  )
}

export default SocialCallbackPage
