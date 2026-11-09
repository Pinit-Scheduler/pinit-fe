import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { registerMyEmail, requestMyEmailCode } from '../api/email'
import { fetchAccount } from '@features/settings/api/account'
import { ApiError } from '@shared/api/httpClient'
import { normalizeEmail, validateEmail, validateEmailCode } from '../utils/accountRules'
import { describeEmailAuthError } from '../utils/emailAuthErrors'
import { emailRequirement } from '../utils/emailRequirement'
import { currentTokenSubject } from '../utils/currentTokenSubject'
import { firstErrorField } from '../utils/formErrors'
import { EmailCodeInput, EmailCodeRequestField } from '../components/EmailCodeFields'
import { useAuthPageScroll } from '../hooks/useAuthPageLayout'
import useEmailCode from '../hooks/useEmailCode'
import useLogout from '../hooks/useLogout'
import usePushSubscription from '@shared/hooks/usePushSubscription'
import { useToast } from '@contexts/ToastContext'
import './LoginPage.css'

// 이메일이 없는 기존 로컬 회원이 로그인 직후 거치는 필수 등록 화면(이메일 인증·비밀번호 찾기 설계 §8).
// 등록을 마치면 AuthGuard가 원래 가려던 화면으로 보낸다. 등록하지 않고 로그아웃할 수도 있다.

type RegistrationField = 'email' | 'code'
type RegistrationErrors = Partial<Record<RegistrationField | 'form', string>>

const FIELD_ORDER: readonly RegistrationField[] = ['email', 'code']

const EmailRegistrationPage = () => {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [errors, setErrors] = useState<RegistrationErrors>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const fieldRefs = useRef<Partial<Record<RegistrationField, HTMLInputElement | null>>>({})
  const emailCode = useEmailCode(requestMyEmailCode)
  const { unsubscribe: unsubscribePush } = usePushSubscription()
  const { logout, isLoggingOut } = useLogout(unsubscribePush)
  const { addToast } = useToast()
  useAuthPageScroll()
  const isBusy = isSubmitting || isLoggingOut

  const bindRef = (field: RegistrationField) => (element: HTMLInputElement | null) => {
    fieldRefs.current[field] = element
  }

  const showErrors = (nextErrors: RegistrationErrors) => {
    setErrors(nextErrors)
    const field = firstErrorField(FIELD_ORDER, nextErrors)
    if (field) fieldRefs.current[field]?.focus()
  }

  const handleRequestCode = async () => {
    const emailError = validateEmail(email)
    if (emailError) {
      showErrors({ email: emailError })
      return
    }
    const failure = await emailCode.request(email)
    if (failure) {
      showErrors({ email: failure.message })
      return
    }
    setErrors({})
    fieldRefs.current.code?.focus()
  }

  // 400 "이미 이메일을 등록했어요"는 앞선 등록 응답을 놓쳤거나 다른 탭에서 등록한 경우다.
  // 서버 값을 다시 읽어 등록이 끝났으면 화면을 떠나게 한다. 조회 실패는 무시한다.
  const recheckRequirement = async () => {
    const subject = currentTokenSubject()
    try {
      const account = await fetchAccount()
      if (!account.emailRequired) emailRequirement.set(subject, false)
    } catch {
      /* 화면에 남은 오류 문구로 충분하다 */
    }
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    const nextErrors: RegistrationErrors = {}
    const emailError = validateEmail(email)
    const codeError = validateEmailCode(code)
    if (emailError) nextErrors.email = emailError
    if (codeError) nextErrors.code = codeError
    showErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    setIsSubmitting(true)
    try {
      await registerMyEmail({ email: normalizeEmail(email), code })
      addToast('이메일을 등록했어요. 비밀번호를 잊으면 이 이메일로 찾을 수 있어요.', 'success')
      // AuthGuard가 이 값을 보고 원래 가려던 화면으로 보낸다.
      emailRequirement.set(currentTokenSubject(), false)
    } catch (error) {
      const failure = describeEmailAuthError(error, 'submit')
      if (failure.requiresNewCode) {
        emailCode.requireNewCode()
        setCode('')
        showErrors({ email: failure.message })
      } else {
        setErrors({ form: failure.message })
      }
      addToast(failure.message, 'error')
      setIsSubmitting(false)
      if (error instanceof ApiError && error.status === 400) void recheckRequirement()
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
            <span className="login__badge">Account</span>
          </div>
        </div>

        <p className="login__eyebrow">이메일 등록</p>
        <h1>계속하려면 이메일을 등록해 주세요</h1>
        <p className="login__description">
          비밀번호를 잊었을 때 이메일로 계정을 되찾을 수 있게 이메일을 인증해 주세요. 이메일은 인증과 비밀번호
          찾기에만 써요.
        </p>

        <form className="signup__form" onSubmit={handleSubmit} noValidate>
          <EmailCodeRequestField
            email={email}
            onEmailChange={setEmail}
            inputRef={bindRef('email')}
            error={errors.email}
            flow={emailCode.flow}
            waitSeconds={emailCode.waitSeconds}
            isSending={emailCode.isSending}
            onRequestCode={handleRequestCode}
            disabled={isBusy}
            hint="코드가 오지 않으면 스팸함을 확인하거나 다른 이메일을 사용해 보세요."
          />

          <EmailCodeInput
            code={code}
            onCodeChange={setCode}
            inputRef={bindRef('code')}
            error={errors.code}
            disabled={isBusy}
          />

          {errors.form && (
            <p className="signup__form-error" role="alert">
              {errors.form}
            </p>
          )}

          <div className="login__actions signup__actions">
            <button type="submit" className="login__btn login__btn--primary" disabled={isBusy}>
              {isSubmitting ? '등록하는 중...' : '이메일 등록'}
            </button>
            <button type="button" className="login__btn login__btn--secondary" onClick={logout} disabled={isBusy}>
              {isLoggingOut ? '로그아웃 중...' : '로그아웃'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default EmailRegistrationPage
