import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { requestEmailCode, resetPassword } from '../api/email'
import { validateEmail, validateEmailCode, validatePassword } from '../utils/accountRules'
import { describeEmailAuthError } from '../utils/emailAuthErrors'
import { emailCodeButtonLabel, passwordResetStep } from '../utils/emailCode'
import { firstErrorField } from '../utils/formErrors'
import { EmailCodeInput, EmailCodeRequestField } from '../components/EmailCodeFields'
import { standaloneFocusProps, useAuthPageScroll } from '../hooks/useAuthPageLayout'
import useEmailCode from '../hooks/useEmailCode'
import { useToast } from '@contexts/ToastContext'
import './LoginPage.css'

// 이메일만으로 비밀번호를 다시 정한다(이메일 인증·비밀번호 찾기 설계 §8).
// 서버는 가입하지 않은 이메일에도 같은 응답을 주므로, 화면도 "가입한 이메일이라면" 코드가 간다고만 말한다.

type ResetField = 'email' | 'code' | 'newPassword' | 'confirmPassword'
type ResetErrors = Partial<Record<ResetField | 'form', string>>

const FIELD_ORDER: readonly ResetField[] = ['email', 'code', 'newPassword', 'confirmPassword']

const sendResetCode = (email: string) => requestEmailCode(email, 'PASSWORD_RESET')

const ForgotPasswordPage = () => {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [errors, setErrors] = useState<ResetErrors>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const fieldRefs = useRef<Partial<Record<ResetField, HTMLInputElement | null>>>({})
  const emailCode = useEmailCode(sendResetCode)
  const step = passwordResetStep(emailCode.flow)
  const previousStep = useRef(step)
  const navigate = useNavigate()
  const { addToast } = useToast()
  useAuthPageScroll()

  // 단계가 바뀌면 그 단계의 첫 입력란으로 포커스를 옮긴다. 처음 열 때는 옮기지 않는다.
  useEffect(() => {
    if (previousStep.current === step) return
    previousStep.current = step
    fieldRefs.current[step === 'verify' ? 'code' : 'email']?.focus()
  }, [step])

  const bindRef = (field: ResetField) => (element: HTMLInputElement | null) => {
    fieldRefs.current[field] = element
  }

  const showErrors = (nextErrors: ResetErrors) => {
    setErrors(nextErrors)
    const field = firstErrorField(FIELD_ORDER, nextErrors)
    if (field) fieldRefs.current[field]?.focus()
  }

  const sendCode = async (target: string) => {
    const failure = await emailCode.request(target)
    if (failure) showErrors(step === 'request' ? { email: failure.message } : { form: failure.message })
    else setErrors({})
  }

  const handleRequestCode = async (event: FormEvent) => {
    event.preventDefault()
    const emailError = validateEmail(email)
    if (emailError) {
      showErrors({ email: emailError })
      return
    }
    await sendCode(email)
  }

  const handleChangeEmail = () => {
    emailCode.requireNewCode()
    setCode('')
    setErrors({})
  }

  const validateReset = () => {
    const nextErrors: ResetErrors = {}
    const codeError = validateEmailCode(code)
    const passwordError = validatePassword(newPassword)
    if (codeError) nextErrors.code = codeError
    if (passwordError) nextErrors.newPassword = passwordError
    if (!confirmPassword) nextErrors.confirmPassword = '새 비밀번호를 다시 입력해 주세요.'
    else if (newPassword !== confirmPassword) nextErrors.confirmPassword = '새 비밀번호가 일치하지 않습니다.'
    showErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  const handleReset = async (event: FormEvent) => {
    event.preventDefault()
    const sentTo = emailCode.flow.sentTo
    if (!sentTo || !validateReset()) return
    setIsSubmitting(true)
    try {
      await resetPassword({ email: sentTo, code, newPassword })
      addToast('비밀번호를 바꿨어요. 새 비밀번호로 로그인해 주세요.', 'success')
      navigate('/login', { replace: true })
    } catch (error) {
      const failure = describeEmailAuthError(error, 'submit')
      if (failure.requiresNewCode) {
        // 코드는 이미 쓰였다. 첫 단계로 돌아가 새 코드를 받게 한다. 입력한 새 비밀번호는 남겨 둔다.
        handleChangeEmail()
        setErrors({ email: failure.message })
      } else {
        setErrors({ form: failure.message })
      }
      addToast(failure.message, 'error')
    } finally {
      setIsSubmitting(false)
    }
  }

  const errorId = (field: ResetField) => `reset-${field}-error`
  const errorProps = (field: ResetField) => ({
    'aria-invalid': errors[field] ? true : undefined,
    'aria-describedby': errors[field] ? errorId(field) : undefined,
  })
  const fieldError = (field: ResetField) =>
    errors[field] ? <small id={errorId(field)}>{errors[field]}</small> : null
  const formError = errors.form ? (
    <p className="signup__form-error" role="alert">
      {errors.form}
    </p>
  ) : null

  return (
    <div className="login">
      <div className="login__glow login__glow--primary" />
      <div className="login__glow login__glow--accent" />

      <div className="login__card">
        <div className="login__brand">
          <img src="/icons/icon.svg" alt="Pinit 로고" className="login__logo" />
          <div className="login__brand-text">
            <span className="login__brand-name">Pinit</span>
            <span className="login__badge">Account</span>
          </div>
        </div>

        <p className="login__eyebrow">비밀번호 찾기</p>
        <h1>이메일로 비밀번호를 다시 정해요</h1>

        {step === 'request' ? (
          <>
            <p className="login__description">
              가입할 때 인증한 이메일을 입력하면 비밀번호 재설정 코드를 보내 드려요. 아이디가 기억나지 않아도
              괜찮아요. 메일에 아이디 일부가 함께 적혀 있어요.
            </p>
            <form className="signup__form" onSubmit={handleRequestCode} noValidate>
              <EmailCodeRequestField
                email={email}
                onEmailChange={setEmail}
                inputRef={bindRef('email')}
                error={errors.email}
                flow={emailCode.flow}
                waitSeconds={emailCode.waitSeconds}
                isSending={emailCode.isSending}
                onRequestCode={() => sendCode(email)}
                hideRequestButton
              />
              {formError}
              <div className="login__actions signup__actions">
                <button
                  type="submit"
                  className="login__btn login__btn--primary"
                  disabled={emailCode.isSending || emailCode.waitSeconds > 0}
                >
                  {emailCodeButtonLabel(emailCode.flow, emailCode.waitSeconds, emailCode.isSending)}
                </button>
                <button type="button" className="login__btn login__btn--secondary" onClick={() => navigate('/login')}>
                  로그인으로 돌아가기
                </button>
              </div>
            </form>
          </>
        ) : (
          <form className="signup__form" onSubmit={handleReset} noValidate>
            <div className="signup__sent" role="status">
              <p>
                <strong>{emailCode.flow.sentTo}</strong> 주소가 가입한 이메일이라면 코드를 보냈어요. 메일이 보이지
                않으면 스팸함도 확인해 주세요.
              </p>
              <p>메일에 적힌 아이디(일부 가림)로 어떤 계정인지 확인할 수 있어요.</p>
              <div className="signup__sent-actions">
                <button type="button" className="signup__inline-btn" onClick={handleChangeEmail} disabled={isSubmitting}>
                  다른 이메일 입력
                </button>
                <button
                  type="button"
                  className="signup__inline-btn"
                  onClick={() => emailCode.flow.sentTo && sendCode(emailCode.flow.sentTo)}
                  disabled={isSubmitting || emailCode.isSending || emailCode.waitSeconds > 0}
                >
                  {emailCodeButtonLabel(emailCode.flow, emailCode.waitSeconds, emailCode.isSending)}
                </button>
              </div>
            </div>

            <EmailCodeInput
              code={code}
              onCodeChange={setCode}
              inputRef={bindRef('code')}
              error={errors.code}
              disabled={isSubmitting}
            />

            <label className="signup__field">
              <span>새 비밀번호</span>
              <input
                ref={bindRef('newPassword')}
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                placeholder="영문과 숫자를 포함해 8~64자"
                maxLength={64}
                autoComplete="new-password"
                disabled={isSubmitting}
                {...errorProps('newPassword')}
                {...standaloneFocusProps}
              />
              {fieldError('newPassword')}
            </label>

            <label className="signup__field">
              <span>새 비밀번호 확인</span>
              <input
                ref={bindRef('confirmPassword')}
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="새 비밀번호를 다시 입력하세요"
                autoComplete="new-password"
                disabled={isSubmitting}
                {...errorProps('confirmPassword')}
                {...standaloneFocusProps}
              />
              {fieldError('confirmPassword')}
            </label>

            {formError}

            <div className="login__actions signup__actions">
              <button type="submit" className="login__btn login__btn--primary" disabled={isSubmitting}>
                {isSubmitting ? '바꾸는 중...' : '비밀번호 바꾸기'}
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
        )}
      </div>
    </div>
  )
}

export default ForgotPasswordPage
