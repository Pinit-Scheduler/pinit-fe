import { useId } from 'react'
import type { ReactNode, Ref } from 'react'
import { EMAIL_MAX_LENGTH, sanitizeEmailCode } from '../utils/accountRules'
import { emailCodeButtonLabel, isEmailCodeSentTo, type EmailCodeFlow } from '../utils/emailCode'
import { standaloneFocusProps } from '../hooks/useAuthPageLayout'

// 가입·비밀번호 찾기·이메일 등록 화면이 함께 쓰는 이메일·인증 코드 입력란.

const describedBy = (...ids: Array<string | false | undefined>) => ids.filter(Boolean).join(' ') || undefined

type EmailCodeRequestFieldProps = {
  email: string
  onEmailChange: (email: string) => void
  inputRef: Ref<HTMLInputElement>
  error?: string
  flow: EmailCodeFlow
  waitSeconds: number
  isSending: boolean
  onRequestCode: () => void
  disabled?: boolean
  /** 코드 받기 단추를 숨기고 이메일만 받는다(비밀번호 찾기 첫 단계처럼 화면의 주 단추가 코드 받기일 때). */
  hideRequestButton?: boolean
  /** 이메일 아래에 늘 보이는 안내 */
  hint?: ReactNode
}

export const EmailCodeRequestField = ({
  email,
  onEmailChange,
  inputRef,
  error,
  flow,
  waitSeconds,
  isSending,
  onRequestCode,
  disabled = false,
  hideRequestButton = false,
  hint,
}: EmailCodeRequestFieldProps) => {
  const id = useId()
  const errorId = `${id}-error`
  const hintId = `${id}-hint`
  const statusId = `${id}-status`
  const isSent = isEmailCodeSentTo(flow, email)

  return (
    <div className="signup__field">
      <label htmlFor={id}>이메일</label>
      <div className="signup__inline">
        <input
          id={id}
          ref={inputRef}
          type="email"
          inputMode="email"
          value={email}
          onChange={(event) => onEmailChange(event.target.value)}
          placeholder="you@example.com"
          maxLength={EMAIL_MAX_LENGTH}
          autoComplete="email"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(error && errorId, isSent && statusId, hint !== undefined && hintId)}
          disabled={disabled}
          {...standaloneFocusProps}
        />
        {!hideRequestButton && (
          <button
            type="button"
            className="signup__inline-btn"
            onClick={onRequestCode}
            disabled={disabled || isSending || waitSeconds > 0}
          >
            {emailCodeButtonLabel(flow, waitSeconds, isSending)}
          </button>
        )}
      </div>
      {error && <small id={errorId}>{error}</small>}
      <p id={statusId} className="signup__notice" role="status">
        {isSent ? `${flow.sentTo} 주소로 메일을 보냈어요. 메일이 보이지 않으면 스팸함도 확인해 주세요.` : ''}
      </p>
      {hint !== undefined && (
        <p id={hintId} className="signup__hint">
          {hint}
        </p>
      )}
    </div>
  )
}

type EmailCodeInputProps = {
  code: string
  onCodeChange: (code: string) => void
  inputRef: Ref<HTMLInputElement>
  error?: string
  disabled?: boolean
}

export const EmailCodeInput = ({ code, onCodeChange, inputRef, error, disabled = false }: EmailCodeInputProps) => {
  const id = useId()
  const errorId = `${id}-error`
  const hintId = `${id}-hint`

  return (
    <div className="signup__field">
      <label htmlFor={id}>인증 코드</label>
      <input
        id={id}
        ref={inputRef}
        value={code}
        onChange={(event) => onCodeChange(sanitizeEmailCode(event.target.value))}
        placeholder="6자리 숫자"
        inputMode="numeric"
        autoComplete="one-time-code"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(error && errorId, hintId)}
        disabled={disabled}
        {...standaloneFocusProps}
      />
      {error && <small id={errorId}>{error}</small>}
      <p id={hintId} className="signup__hint">
        가장 최근 메일의 코드를 입력하세요. 코드는 10분 동안 쓸 수 있어요.
      </p>
    </div>
  )
}
