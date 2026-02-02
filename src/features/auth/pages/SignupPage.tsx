import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { signup } from '../api/auth'
import { useToast } from '@contexts/ToastContext'
import './LoginPage.css'

type SignupFormState = {
  username: string
  password: string
  confirmPassword: string
  nickname: string
}

const createInitialState = (): SignupFormState => ({
  username: '',
  password: '',
  confirmPassword: '',
  nickname: '',
})

const SignupPage = () => {
  const [values, setValues] = useState<SignupFormState>(createInitialState)
  const [errors, setErrors] = useState<Partial<Record<keyof SignupFormState | 'form', string>>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const { addToast } = useToast()
  const navigate = useNavigate()
  const isStandalone = () =>
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (window.navigator as unknown as { standalone?: boolean })?.standalone === true
  const handleTouchFocus = (
    event: React.TouchEvent<HTMLInputElement> | React.MouseEvent<HTMLInputElement> | React.FocusEvent<HTMLInputElement>,
  ) => {
    const target = event.currentTarget
    if (!isStandalone()) return
    requestAnimationFrame(() => {
      target.focus({ preventScroll: false })
      setTimeout(() => target.scrollIntoView({ block: 'center', behavior: 'smooth' }), 50)
    })
  }

  useEffect(() => {
    const body = document.body
    const root = document.getElementById('root')
    const prevBodyOverflow = body.style.overflow
    const prevRootOverflow = root?.style.overflow
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

  const onChange = <K extends keyof SignupFormState>(key: K, value: SignupFormState[K]) => {
    setValues((prev) => ({ ...prev, [key]: value }))
  }

  const validate = () => {
    const nextErrors: Partial<Record<keyof SignupFormState | 'form', string>> = {}
    if (!values.username.trim()) nextErrors.username = '아이디를 입력해 주세요.'
    if (!values.password) nextErrors.password = '비밀번호를 입력해 주세요.'
    if (values.password.length > 0 && values.password.length < 8) {
      nextErrors.password = '비밀번호는 8자 이상이어야 합니다.'
    }
    if (!values.confirmPassword) nextErrors.confirmPassword = '비밀번호를 다시 입력해 주세요.'
    if (values.password && values.confirmPassword && values.password !== values.confirmPassword) {
      nextErrors.confirmPassword = '비밀번호가 일치하지 않습니다.'
    }
    if (!values.nickname.trim()) nextErrors.nickname = '별명을 입력해 주세요.'
    setErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!validate()) return

    setIsSubmitting(true)
    setErrors({})
    try {
      await signup({
        username: values.username.trim(),
        password: values.password,
        nickname: values.nickname.trim(),
      })
      addToast('회원가입이 완료되었습니다. 로그인해 주세요.', 'success')
      navigate('/login', { replace: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : '회원가입에 실패했습니다.'
      setErrors({ form: message })
      addToast(message, 'error')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="login">
      <div className="login__glow login__glow--primary" />
      <div className="login__glow login__glow--accent" />

      <div className="login__card">
        <div className="login__brand">
          <img src="/icons/icon.svg" alt="Pinit 로고" className="login__logo" />
          <div className="login__brand-text">
            <span className="login__brand-name">Pinit</span>
            <span className="login__badge">Sign up</span>
          </div>
        </div>

        <p className="login__eyebrow">회원가입</p>
        <h1>아이디와 비밀번호로 새 계정을 만들어요</h1>
        <p className="login__description">
          아이디, 비밀번호, 별명만으로 간단히 가입할 수 있어요. 가입 후 로그인하면 일정 관리 기능을
          바로 사용할 수 있습니다.
        </p>

        <form className="signup__form" onSubmit={handleSubmit}>
          <label className="signup__field">
            <span>아이디</span>
            <input
              value={values.username}
              onChange={(event) => onChange('username', event.target.value)}
              placeholder="아이디를 입력하세요"
              autoComplete="username"
              onTouchEnd={handleTouchFocus}
              onTouchStart={handleTouchFocus}
              onMouseDown={handleTouchFocus}
              onFocus={handleTouchFocus}
              required
            />
            {errors.username && <small>{errors.username}</small>}
          </label>

          <label className="signup__field">
            <span>비밀번호</span>
            <input
              type="password"
              value={values.password}
              onChange={(event) => onChange('password', event.target.value)}
              placeholder="8자 이상 입력하세요"
              autoComplete="new-password"
              onTouchEnd={handleTouchFocus}
              onTouchStart={handleTouchFocus}
              onMouseDown={handleTouchFocus}
              onFocus={handleTouchFocus}
              required
            />
            {errors.password && <small>{errors.password}</small>}
          </label>

          <label className="signup__field">
            <span>비밀번호 확인</span>
            <input
              type="password"
              value={values.confirmPassword}
              onChange={(event) => onChange('confirmPassword', event.target.value)}
              placeholder="비밀번호를 다시 입력하세요"
              autoComplete="new-password"
              onTouchEnd={handleTouchFocus}
              onTouchStart={handleTouchFocus}
              onMouseDown={handleTouchFocus}
              onFocus={handleTouchFocus}
              required
            />
            {errors.confirmPassword && <small>{errors.confirmPassword}</small>}
          </label>

          <label className="signup__field">
            <span>별명</span>
            <input
              value={values.nickname}
              onChange={(event) => onChange('nickname', event.target.value)}
              placeholder="프로필에 표시될 별명"
              autoComplete="nickname"
              onTouchEnd={handleTouchFocus}
              onTouchStart={handleTouchFocus}
              onMouseDown={handleTouchFocus}
              onFocus={handleTouchFocus}
              required
            />
            {errors.nickname && <small>{errors.nickname}</small>}
          </label>

          {errors.form && <p className="signup__form-error">{errors.form}</p>}

          <div className="login__actions signup__actions">
            <button type="submit" className="login__btn login__btn--primary" disabled={isSubmitting}>
              {isSubmitting ? '가입 중...' : '회원가입'}
            </button>
            <button
              type="button"
              className="login__btn login__btn--secondary"
              onClick={() => navigate('/login')}
              disabled={isSubmitting}
            >
              로그인으로 돌아가기
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default SignupPage
