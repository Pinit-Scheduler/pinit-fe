import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useToast } from '@contexts/ToastContext'
import { StatusPanel } from '@shared/components/common'
import { clearAuthTokens, markLoggedOut } from '@shared/api/authTokens'
import { buildAuthorizeUrl } from '@features/auth/api/auth'
import { rememberReturnTo } from '@features/auth/utils/returnTo'
import {
  WITHDRAWAL_CONFIRMATION,
  isWithdrawalConfirmed,
  validatePassword,
} from '@features/auth/utils/accountRules'
import { changePassword, withdrawAccount } from '../api/account'
import useAccount from '../hooks/useAccount'
import './AccountSection.css'

type AccountSectionProps = {
  onLogout: () => void
  isLoggingOut: boolean
}

type PasswordForm = {
  currentPassword: string
  newPassword: string
  confirmPassword: string
}

const EMPTY_PASSWORD_FORM: PasswordForm = { currentPassword: '', newPassword: '', confirmPassword: '' }

// 탈퇴하면 지워지는 것(ADR-0022 §6). 사용자에게 그대로 보여 준다.
const WITHDRAWAL_DELETES = [
  '작업, 일정, 반복, 의존 관계, 태그, 통계',
  '생활 시간, 온보딩 진행, 프로필 설정',
  '일정·마감 알림, 알림 설정, 푸시 알림 구독',
  'AI 연결(MCP)과 AI 사용 이력, 모든 로그인 세션',
]

const SETTINGS_PATH = '/app/settings'

// 탈퇴하면 서버의 구독 정보는 지워지지만 브라우저의 푸시 구독은 남는다. 이미 보낸 알림이 도착하지 않게
// 브라우저 쪽 구독도 해지한다. 서버 API는 탈퇴 뒤라 부를 수 없으므로 브라우저 구독만 해지하고, 실패해도 무시한다.
const unsubscribeBrowserPush = async () => {
  try {
    const registration = await navigator.serviceWorker?.getRegistration()
    const subscription = await registration?.pushManager.getSubscription()
    await subscription?.unsubscribe()
  } catch (error) {
    console.warn('[Push] Failed to unsubscribe the browser after withdrawal:', error)
  }
}

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback

const AccountSection = ({ onLogout, isLoggingOut }: AccountSectionProps) => {
  const { addToast } = useToast()
  const navigate = useNavigate()
  const { account, isLoading, error, refetch } = useAccount()

  const [isPasswordOpen, setIsPasswordOpen] = useState(false)
  const [passwordForm, setPasswordForm] = useState<PasswordForm>(EMPTY_PASSWORD_FORM)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [isChangingPassword, setIsChangingPassword] = useState(false)

  const [isWithdrawalOpen, setIsWithdrawalOpen] = useState(false)
  const [withdrawalPassword, setWithdrawalPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [withdrawalError, setWithdrawalError] = useState<string | null>(null)
  const [isWithdrawing, setIsWithdrawing] = useState(false)

  const isSocial = account?.socialLogin ?? false
  const canSubmitWithdrawal =
    isWithdrawalConfirmed(confirmation) && (isSocial || withdrawalPassword.length > 0) && !isWithdrawing

  const closePasswordForm = () => {
    setIsPasswordOpen(false)
    setPasswordForm(EMPTY_PASSWORD_FORM)
    setPasswordError(null)
  }

  const handleChangePassword = async (event: FormEvent) => {
    event.preventDefault()
    const ruleError = validatePassword(passwordForm.newPassword)
    if (!passwordForm.currentPassword) {
      setPasswordError('현재 비밀번호를 입력해 주세요.')
      return
    }
    if (ruleError) {
      setPasswordError(ruleError)
      return
    }
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setPasswordError('새 비밀번호가 일치하지 않습니다.')
      return
    }
    setIsChangingPassword(true)
    setPasswordError(null)
    try {
      await changePassword({
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword,
      })
      closePasswordForm()
      addToast('비밀번호를 바꿨어요. 다른 기기에서는 다시 로그인해야 해요.', 'success')
    } catch (err) {
      setPasswordError(errorMessage(err, '비밀번호를 바꾸지 못했어요.'))
    } finally {
      setIsChangingPassword(false)
    }
  }

  const handleSocialReauth = () => {
    // 네이버 로그인을 다시 거친 뒤 설정 화면으로 돌아온다. 그 뒤 10분 안에 탈퇴할 수 있다.
    rememberReturnTo(SETTINGS_PATH)
    window.location.href = buildAuthorizeUrl('naver')
  }

  const handleWithdraw = async (event: FormEvent) => {
    event.preventDefault()
    if (!canSubmitWithdrawal) return
    if (!window.confirm('정말 탈퇴하시겠습니까?\n모든 데이터가 바로 지워지고 되돌릴 수 없어요.')) return
    setIsWithdrawing(true)
    setWithdrawalError(null)
    try {
      await withdrawAccount({
        password: isSocial ? null : withdrawalPassword,
        confirmation: confirmation.trim(),
      })
      await unsubscribeBrowserPush()
      clearAuthTokens()
      markLoggedOut()
      addToast('탈퇴가 끝났어요. 그동안 핀잇을 써 주셔서 고마워요.', 'info')
      navigate('/login', { replace: true })
    } catch (err) {
      setWithdrawalError(errorMessage(err, '탈퇴하지 못했어요.'))
      setIsWithdrawing(false)
    }
  }

  const renderPasswordRow = () => {
    if (isLoading) return <StatusPanel variant="loading" title="계정 정보를 불러오는 중..." />
    if (error) {
      return (
        <StatusPanel
          variant="error"
          title="계정 정보를 불러오지 못했어요."
          description={error}
          action={
            <button type="button" onClick={refetch}>
              다시 시도
            </button>
          }
        />
      )
    }
    if (isSocial) {
      return (
        <div className="settings__row">
          <div>
            <p className="settings__label">네이버 계정</p>
            <p className="settings__description">네이버로 로그인한 계정은 비밀번호가 없어요.</p>
          </div>
        </div>
      )
    }
    return (
      <div className="settings__row settings__row--stack account__block">
        <div className="account__block-header">
          <div>
            <p className="settings__label">비밀번호 변경</p>
            <p className="settings__description">
              {account?.username ? `${account.username} 계정의 ` : ''}비밀번호를 바꾸면 다른 기기는 로그아웃돼요.
            </p>
          </div>
          {!isPasswordOpen && (
            <button type="button" className="account__secondary-btn" onClick={() => setIsPasswordOpen(true)}>
              변경
            </button>
          )}
        </div>
        {isPasswordOpen && (
          <form className="account__form" onSubmit={handleChangePassword}>
            <label className="account__field">
              <span>현재 비밀번호</span>
              <input
                type="password"
                autoComplete="current-password"
                value={passwordForm.currentPassword}
                onChange={(event) => setPasswordForm((prev) => ({ ...prev, currentPassword: event.target.value }))}
              />
            </label>
            <label className="account__field">
              <span>새 비밀번호</span>
              <input
                type="password"
                autoComplete="new-password"
                placeholder="영문과 숫자를 포함해 8자 이상"
                value={passwordForm.newPassword}
                onChange={(event) => setPasswordForm((prev) => ({ ...prev, newPassword: event.target.value }))}
              />
            </label>
            <label className="account__field">
              <span>새 비밀번호 확인</span>
              <input
                type="password"
                autoComplete="new-password"
                value={passwordForm.confirmPassword}
                onChange={(event) => setPasswordForm((prev) => ({ ...prev, confirmPassword: event.target.value }))}
              />
            </label>
            {passwordError && (
              <p className="account__error" role="alert">
                {passwordError}
              </p>
            )}
            <div className="account__actions">
              <button type="button" className="account__secondary-btn" onClick={closePasswordForm}>
                취소
              </button>
              <button type="submit" className="account__primary-btn" disabled={isChangingPassword}>
                {isChangingPassword ? '바꾸는 중...' : '비밀번호 바꾸기'}
              </button>
            </div>
          </form>
        )}
      </div>
    )
  }

  const renderWithdrawal = () => (
    <div className="settings__row settings__row--stack account__block">
      <div className="account__block-header">
        <div>
          <p className="settings__label">회원 탈퇴</p>
          <p className="settings__description">계정과 모든 데이터를 지워요. 되돌릴 수 없어요.</p>
        </div>
        {!isWithdrawalOpen && (
          <button
            type="button"
            className="account__danger-outline-btn"
            onClick={() => setIsWithdrawalOpen(true)}
            disabled={isLoading || Boolean(error)}
          >
            탈퇴
          </button>
        )}
      </div>
      {isWithdrawalOpen && (
        <form className="account__form" onSubmit={handleWithdraw}>
          <div className="account__notice">
            <p>탈퇴하면 아래 데이터가 바로 지워지고 복구할 수 없어요.</p>
            <ul>
              {WITHDRAWAL_DELETES.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          {isSocial ? (
            <div className="account__reauth">
              <p className="settings__description">
                네이버 계정은 본인 확인을 위해 네이버로 다시 로그인한 뒤 10분 안에 탈퇴할 수 있어요.
              </p>
              <button type="button" className="account__secondary-btn" onClick={handleSocialReauth}>
                네이버로 다시 로그인
              </button>
            </div>
          ) : (
            <label className="account__field">
              <span>비밀번호</span>
              <input
                type="password"
                autoComplete="current-password"
                value={withdrawalPassword}
                onChange={(event) => setWithdrawalPassword(event.target.value)}
              />
            </label>
          )}
          <label className="account__field">
            <span>
              확인을 위해 <strong>{WITHDRAWAL_CONFIRMATION}</strong>를 입력해 주세요
            </span>
            <input
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              placeholder={WITHDRAWAL_CONFIRMATION}
              autoComplete="off"
            />
          </label>
          {withdrawalError && (
            <p className="account__error" role="alert">
              {withdrawalError}
            </p>
          )}
          <div className="account__actions">
            <button
              type="button"
              className="account__secondary-btn"
              onClick={() => {
                setIsWithdrawalOpen(false)
                setWithdrawalPassword('')
                setConfirmation('')
                setWithdrawalError(null)
              }}
              disabled={isWithdrawing}
            >
              취소
            </button>
            <button type="submit" className="settings__logout-btn" disabled={!canSubmitWithdrawal}>
              {isWithdrawing ? '탈퇴하는 중...' : '탈퇴하기'}
            </button>
          </div>
        </form>
      )}
    </div>
  )

  return (
    <section className="settings__card settings__card--danger" aria-label="계정">
      <h2>계정</h2>
      {renderPasswordRow()}
      <div className="settings__row settings__row--between">
        <div>
          <p className="settings__label">로그아웃</p>
          <p className="settings__description">이 기기의 로그인을 끝내요. 서버에서도 로그인 정보가 폐기돼요.</p>
        </div>
        <button type="button" className="settings__logout-btn" onClick={onLogout} disabled={isLoggingOut}>
          {isLoggingOut ? '로그아웃 중...' : '로그아웃'}
        </button>
      </div>
      {renderWithdrawal()}
    </section>
  )
}

export default AccountSection
