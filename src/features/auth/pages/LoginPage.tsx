import { useCallback, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { buildAuthorizeUrl, login, type AuthProvider } from '../api/auth'
import { clearLogoutMarker } from '@shared/api/authTokens'
import { useToast } from '@contexts/ToastContext'
import './LoginPage.css'
import { useEffect } from 'react'

const LoginPage = () => {
  const [activeProvider, setActiveProvider] = useState<AuthProvider | null>(null)
  const [credentials, setCredentials] = useState({ username: '', password: '' })
  const [errors, setErrors] = useState<Partial<Record<'username' | 'password' | 'form', string>>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const navigate = useNavigate()
  const { addToast } = useToast()
  const isStandalone = () =>
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (window.navigator as unknown as { standalone?: boolean })?.standalone === true

  const handleTouchFocus = (
    event: React.TouchEvent<HTMLInputElement> | React.MouseEvent<HTMLInputElement> | React.FocusEvent<HTMLInputElement>,
  ) => {
    const target = event.currentTarget
    if (!isStandalone()) return
    // PWA standalone 모드에서 포커스가 씹히는 문제를 방지
    requestAnimationFrame(() => {
      target.focus({ preventScroll: false })
      setTimeout(() => {
        target.scrollIntoView({ block: 'center', behavior: 'smooth' })
      }, 50)
    })
  }

  useEffect(() => {
    const body = document.body
    const root = document.getElementById('root')
    const prevBodyOverflow = body.style.overflow
    const prevRootOverflow = root?.style.overflow
    // Allow vertical scrolling within auth page without enabling horizontal body scroll
    body.style.overflowX = 'hidden'
    body.style.overflowY = 'auto'
    if (root) {
      root.style.overflowX = 'hidden'
      root.style.overflowY = 'auto'
    }
    return () => {
      body.style.overflow = prevBodyOverflow
      if (root && prevRootOverflow !== undefined) root.style.overflow = prevRootOverflow
    }
  }, [])

  const validate = () => {
    const nextErrors: Partial<Record<'username' | 'password', string>> = {}
    if (!credentials.username.trim()) nextErrors.username = '아이디를 입력해 주세요.'
    if (!credentials.password) nextErrors.password = '비밀번호를 입력해 주세요.'
    setErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!validate()) return
    setIsSubmitting(true)
    setErrors({})
    try {
      await login({
        username: credentials.username.trim(),
        password: credentials.password,
      })
      clearLogoutMarker()
      addToast('로그인에 성공했어요.', 'success')
      navigate('/app', { replace: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : '로그인에 실패했습니다.'
      setErrors({ form: message })
      addToast(message, 'error')
    } finally {
      setIsSubmitting(false)
    }
  }

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

        <p className="login__eyebrow">계정 로그인</p>
        <h1>아이디와 비밀번호로 바로 시작</h1>
        <p className="login__description">
          Pinit 계정으로 로그인하거나, 아래에서 소셜 로그인으로 연결할 수 있어요.
        </p>

        <form className="login__form" onSubmit={handleSubmit}>
          <label className="login__field">
            <span>아이디</span>
            <input
              value={credentials.username}
              onChange={(event) => setCredentials((prev) => ({ ...prev, username: event.target.value }))}
              placeholder="아이디를 입력하세요"
              autoComplete="username"
              onTouchEnd={handleTouchFocus}
              onTouchStart={handleTouchFocus}
              onMouseDown={handleTouchFocus}
              onFocus={handleTouchFocus}
              disabled={isSubmitting || !!activeProvider}
            />
            {errors.username && <small>{errors.username}</small>}
          </label>

          <label className="login__field">
            <span>비밀번호</span>
            <input
              type="password"
              value={credentials.password}
              onChange={(event) => setCredentials((prev) => ({ ...prev, password: event.target.value }))}
              placeholder="비밀번호를 입력하세요"
              autoComplete="current-password"
              onTouchEnd={handleTouchFocus}
              onTouchStart={handleTouchFocus}
              onMouseDown={handleTouchFocus}
              onFocus={handleTouchFocus}
              disabled={isSubmitting || !!activeProvider}
            />
            {errors.password && <small>{errors.password}</small>}
          </label>

          {errors.form && <p className="login__form-error">{errors.form}</p>}

          <div className="login__actions">
            <button
              type="submit"
              className="login__btn login__btn--primary"
              disabled={isSubmitting || !!activeProvider}
            >
              {isSubmitting ? '로그인 중...' : '로그인'}
            </button>
            <button
              type="button"
              className="login__btn login__btn--secondary"
              onClick={() => navigate('/signup')}
              disabled={isSubmitting || !!activeProvider}
            >
              계정이 없으신가요? 회원가입
            </button>
          </div>
        </form>

        <div className="login__divider">
          <span />
          <p>또는 소셜 로그인</p>
          <span />
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
        </div>

        <p className="login__helper">
          로그인하면 곧장 대시보드로 이동해 오늘의 우선순위를 확인할 수 있어요.
        </p>
      </div>
    </div>
  )
}

export default LoginPage
