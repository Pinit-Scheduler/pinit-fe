import { useCallback, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { buildAuthorizeUrl, getAuthBaseUrl, type AuthProvider } from '../../api/auth'
import './LoginPage.css'

const LoginPage = () => {
  const [activeProvider, setActiveProvider] = useState<AuthProvider | null>(null)
  const navigate = useNavigate()

  const authorizeBase = useMemo(
    () => `${getAuthBaseUrl()}/login/oauth2/authorize`,
    []
  )

  const handleProviderLogin = useCallback(
    (provider: AuthProvider) => {
      setActiveProvider(provider)

      // 실제 백엔드 소셜 로그인 인가 엔드포인트로 이동
      window.location.href = buildAuthorizeUrl(provider)
    },
    []
  )

  return (
    <div className="login">
      <div className="login__glow login__glow--primary" />
      <div className="login__glow login__glow--accent" />

      <div className="login__card">
        <div className="login__brand">
          <img src="/icons/icon.svg" alt="Pinit 로고" className="login__logo" />
          <div className="login__brand-text">
            <span className="login__brand-name">Pinit</span>
            <span className="login__badge">Auth</span>
          </div>
        </div>

        <p className="login__eyebrow">모바일에 맞춘 소셜 로그인</p>
        <h1>한 번의 터치로 네이버 · Google에 연결</h1>
        <p className="login__description">
          .github/openapi-auth.json을 기반으로 네이버와 Google OAuth2 플로우를 준비해두었어요.
          인증이 끝나면 /refresh, /me 엔드포인트로 세션을 안전하게 이어갑니다.
        </p>

        <div className="login__status">
          <div className="login__status-item">
            <span className="login__status-dot" />
            <div>
              <p className="login__status-label">소셜 로그인</p>
              <p className="login__status-value">
                {authorizeBase}/naver → 302 redirect
              </p>
            </div>
          </div>
          <div className="login__status-item">
            <span className="login__status-dot login__status-dot--amber" />
            <div>
              <p className="login__status-label">토큰 케어</p>
              <p className="login__status-value">/refresh 로 재발급 · /me 로 토큰 검증</p>
            </div>
          </div>
        </div>

        <div className="login__actions">
          <button
            type="button"
            className="login__btn login__btn--naver"
            onClick={() => handleProviderLogin('naver')}
            disabled={!!activeProvider}
          >
            <span className="login__icon">N</span>
            {activeProvider === 'naver' ? '네이버로 이동 중...' : '네이버로 계속하기'}
          </button>
          <button
            type="button"
            className="login__btn login__btn--google"
            onClick={() => handleProviderLogin('google')}
            disabled={!!activeProvider}
          >
            <span className="login__icon">G</span>
            {activeProvider === 'google' ? 'Google로 이동 중...' : 'Google로 계속하기'}
          </button>
          <button
            type="button"
            className="login__btn login__btn--secondary"
            onClick={() => navigate('/signup')}
            disabled={!!activeProvider}
          >
            아이디로 회원가입
          </button>
        </div>

        <p className="login__helper">
          로그인하면 곧장 대시보드로 이동해 오늘의 우선순위를 확인할 수 있어요.
        </p>
      </div>
    </div>
  )
}

export default LoginPage
