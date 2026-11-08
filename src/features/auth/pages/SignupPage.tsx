import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { signup } from '../api/auth'
import { requestEmailCode } from '../api/email'
import {
  NICKNAME_MAX_LENGTH,
  normalizeEmail,
  validateEmail,
  validateEmailCode,
  validateNickname,
  validatePassword,
  validateUsername,
} from '../utils/accountRules'
import { describeEmailAuthError } from '../utils/emailAuthErrors'
import { firstErrorField } from '../utils/formErrors'
import { EmailCodeInput, EmailCodeRequestField } from '../components/EmailCodeFields'
import { standaloneFocusProps, useAuthPageScroll } from '../hooks/useAuthPageLayout'
import useEmailCode from '../hooks/useEmailCode'
import { useToast } from '@contexts/ToastContext'
import './LoginPage.css'

type SignupFormState = {
  username: string
  password: string
  confirmPassword: string
  nickname: string
  email: string
  code: string
}

type SignupField = keyof SignupFormState
type SignupErrors = Partial<Record<SignupField | 'form', string>>

// 화면에 놓인 순서. 제출이 막히면 이 순서로 처음 오류가 난 입력란에 포커스를 둔다.
const FIELD_ORDER: readonly SignupField[] = ['username', 'password', 'confirmPassword', 'nickname', 'email', 'code']

const createInitialState = (): SignupFormState => ({
  username: '',
  password: '',
  confirmPassword: '',
  nickname: '',
  email: '',
  code: '',
})

const sendSignupCode = (email: string) => requestEmailCode(email, 'SIGNUP')

const SignupPage = () => {
  const [values, setValues] = useState<SignupFormState>(createInitialState)
  const [errors, setErrors] = useState<SignupErrors>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const fieldRefs = useRef<Partial<Record<SignupField, HTMLInputElement | null>>>({})
  const emailCode = useEmailCode(sendSignupCode)
  const { addToast } = useToast()
  const navigate = useNavigate()
  useAuthPageScroll()

  const bindRef = (field: SignupField) => (element: HTMLInputElement | null) => {
    fieldRefs.current[field] = element
  }

  const onChange = <K extends SignupField>(key: K, value: SignupFormState[K]) => {
    setValues((prev) => ({ ...prev, [key]: value }))
  }

  const showErrors = (nextErrors: SignupErrors) => {
    setErrors(nextErrors)
    const field = firstErrorField(FIELD_ORDER, nextErrors)
    if (field) fieldRefs.current[field]?.focus()
  }

  const showEmailError = (message: string | undefined) => {
    setErrors((prev) => ({ ...prev, email: message }))
    if (message) fieldRefs.current.email?.focus()
  }

  const handleRequestCode = async () => {
    const emailError = validateEmail(values.email)
    if (emailError) {
      showEmailError(emailError)
      return
    }
    showEmailError(undefined)
    const failure = await emailCode.request(values.email)
    if (failure) {
      showEmailError(failure.message)
      return
    }
    fieldRefs.current.code?.focus()
  }

  const validate = () => {
    const nextErrors: SignupErrors = {}
    const usernameError = validateUsername(values.username)
    const passwordError = validatePassword(values.password)
    const nicknameError = validateNickname(values.nickname)
    const emailError = validateEmail(values.email)
    const codeError = validateEmailCode(values.code)
    if (usernameError) nextErrors.username = usernameError
    if (passwordError) nextErrors.password = passwordError
    if (!values.confirmPassword) nextErrors.confirmPassword = '비밀번호를 다시 입력해 주세요.'
    if (values.password && values.confirmPassword && values.password !== values.confirmPassword) {
      nextErrors.confirmPassword = '비밀번호가 일치하지 않습니다.'
    }
    if (nicknameError) nextErrors.nickname = nicknameError
    if (emailError) nextErrors.email = emailError
    if (codeError) nextErrors.code = codeError
    showErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!validate()) return

    setIsSubmitting(true)
    try {
      await signup({
        username: values.username.trim(),
        password: values.password,
        nickname: values.nickname.trim(),
        email: normalizeEmail(values.email),
        code: values.code,
      })
      addToast('회원가입이 완료되었습니다. 로그인해 주세요.', 'success')
      navigate('/login', { replace: true })
    } catch (error) {
      const failure = describeEmailAuthError(error, 'submit')
      if (failure.requiresNewCode) {
        // 코드는 이미 쓰였다. 새 코드를 받도록 코드 입력을 비우고 이메일 쪽에 이유를 보여 준다.
        emailCode.requireNewCode()
        onChange('code', '')
        showErrors({ email: failure.message })
      } else {
        setErrors({ form: failure.message })
      }
      addToast(failure.message, 'error')
    } finally {
      setIsSubmitting(false)
    }
  }

  const errorId = (field: SignupField) => `signup-${field}-error`

  const errorProps = (field: SignupField) => ({
    'aria-invalid': errors[field] ? true : undefined,
    'aria-describedby': errors[field] ? errorId(field) : undefined,
  })

  const fieldError = (field: SignupField) =>
    errors[field] ? <small id={errorId(field)}>{errors[field]}</small> : null

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
          아이디, 비밀번호, 별명을 정하고 이메일을 인증하면 가입돼요. 이메일은 인증과 비밀번호 찾기에만 써요.
          비밀번호는 영문과 숫자를 모두 넣어 8자 이상으로 정해 주세요.
        </p>

        <form className="signup__form" onSubmit={handleSubmit} noValidate>
          <label className="signup__field">
            <span>아이디</span>
            <input
              ref={bindRef('username')}
              value={values.username}
              onChange={(event) => onChange('username', event.target.value)}
              placeholder="영문, 숫자, 밑줄(_) 4~20자"
              maxLength={20}
              autoComplete="username"
              required
              {...errorProps('username')}
              {...standaloneFocusProps}
            />
            {fieldError('username')}
          </label>

          <label className="signup__field">
            <span>비밀번호</span>
            <input
              ref={bindRef('password')}
              type="password"
              value={values.password}
              onChange={(event) => onChange('password', event.target.value)}
              placeholder="영문과 숫자를 포함해 8~64자"
              maxLength={64}
              autoComplete="new-password"
              required
              {...errorProps('password')}
              {...standaloneFocusProps}
            />
            {fieldError('password')}
          </label>

          <label className="signup__field">
            <span>비밀번호 확인</span>
            <input
              ref={bindRef('confirmPassword')}
              type="password"
              value={values.confirmPassword}
              onChange={(event) => onChange('confirmPassword', event.target.value)}
              placeholder="비밀번호를 다시 입력하세요"
              autoComplete="new-password"
              required
              {...errorProps('confirmPassword')}
              {...standaloneFocusProps}
            />
            {fieldError('confirmPassword')}
          </label>

          <label className="signup__field">
            <span>별명</span>
            <input
              ref={bindRef('nickname')}
              value={values.nickname}
              onChange={(event) => onChange('nickname', event.target.value)}
              placeholder="프로필에 표시될 별명(20자 이하)"
              maxLength={NICKNAME_MAX_LENGTH}
              autoComplete="nickname"
              required
              {...errorProps('nickname')}
              {...standaloneFocusProps}
            />
            {fieldError('nickname')}
          </label>

          <EmailCodeRequestField
            email={values.email}
            onEmailChange={(email) => onChange('email', email)}
            inputRef={bindRef('email')}
            error={errors.email}
            flow={emailCode.flow}
            waitSeconds={emailCode.waitSeconds}
            isSending={emailCode.isSending}
            onRequestCode={handleRequestCode}
            disabled={isSubmitting}
          />

          <EmailCodeInput
            code={values.code}
            onCodeChange={(code) => onChange('code', code)}
            inputRef={bindRef('code')}
            error={errors.code}
            disabled={isSubmitting}
          />

          {errors.form && (
            <p className="signup__form-error" role="alert">
              {errors.form}
            </p>
          )}

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
