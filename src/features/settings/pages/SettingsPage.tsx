import { useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { clearAuthTokens, markLoggedOut } from '@shared/api/authTokens'
import { logout as requestLogout } from '@features/auth/api/auth'
import { useToast } from '@contexts/ToastContext'
import usePushSubscription from '@shared/hooks/usePushSubscription'
import { useTimePreferences } from '@contexts/TimePreferencesContext'
import './SettingsPage.css'

const SettingsPage = () => {
  const [isNotificationEnabled, setIsNotificationEnabled] = useState(true)
  const [isDeadlineReminderEnabled, setIsDeadlineReminderEnabled] = useState(false)
  const [isAutoStatsEnabled, setIsAutoStatsEnabled] = useState(true)
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const navigate = useNavigate()
  const { addToast } = useToast()
  const { offsetLabel, isLoading: isTimeLoading } = useTimePreferences()
  const {
    state: pushState,
    isProcessing: isPushProcessing,
    describeStatus: pushDescription,
    subscribe: subscribePush,
    unsubscribe: unsubscribePush,
  } = usePushSubscription()

  const handleLogout = async () => {
    setIsLoggingOut(true)
    try {
      try {
        await unsubscribePush()
      } catch (error) {
        console.warn('[Push] Failed to unsubscribe during logout:', error)
      }
      await requestLogout()
      clearAuthTokens()
      markLoggedOut()
      addToast('로그아웃되었습니다.', 'info')
      navigate('/login', { replace: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : '로그아웃에 실패했어요.'
      addToast(message, 'error')
    } finally {
      setIsLoggingOut(false)
    }
  }

  const pushStatusLabel = (() => {
    switch (pushState.status) {
      case 'subscribed':
        return '활성화'
      case 'blocked':
        return '권한 차단'
      case 'unsupported':
        return '미지원'
      case 'error':
        return '재시도 필요'
      default:
        return '대기중'
    }
  })()

  const pushBadgeClass = (() => {
    switch (pushState.status) {
      case 'subscribed':
        return 'settings__badge settings__badge--positive'
      case 'blocked':
        return 'settings__badge settings__badge--warning'
      case 'unsupported':
        return 'settings__badge settings__badge--muted'
      case 'error':
        return 'settings__badge settings__badge--error'
      default:
        return 'settings__badge'
    }
  })()

  const isPushEnabled = pushState.status === 'subscribed'

  const handlePushToggle = async () => {
    try {
      if (isPushEnabled) {
        await unsubscribePush()
        addToast('푸시 알림 구독이 해제되었어요.', 'info')
      } else {
        await subscribePush()
        addToast('푸시 알림 구독이 완료되었어요.', 'success')
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '푸시 알림 설정에 실패했어요.'
      addToast(message, 'error')
    }
  }

  return (
    <section className="settings">
      <header className="settings__header">
        <p className="settings__subheading">앱 기본값</p>
        <h1 className="settings__title">알림 및 기준 정보</h1>
      </header>

      <section className="settings__card" aria-label="알림 설정">
        <h2>알림 설정</h2>
        <div className="settings__row">
          <div>
            <p className="settings__label">앱 알림</p>
            <p className="settings__description">일정 시작/종료/마감 알림을 받아요.</p>
          </div>
          <button
            className={['settings__toggle', isNotificationEnabled && 'is-active'].filter(Boolean).join(' ')}
            onClick={() => setIsNotificationEnabled((prev) => !prev)}
            aria-pressed={isNotificationEnabled}
          >
            <span />
          </button>
        </div>
        <div className="settings__row">
          <div>
            <p className="settings__label">마감 30분 전 알림</p>
            <p className="settings__description">난이도가 높은 일정에 우선 적용됩니다.</p>
          </div>
          <button
            className={['settings__toggle', isDeadlineReminderEnabled && 'is-active'].filter(Boolean).join(' ')}
            onClick={() => setIsDeadlineReminderEnabled((prev) => !prev)}
            aria-pressed={isDeadlineReminderEnabled}
          >
            <span />
          </button>
        </div>
        <div className="settings__row settings__row--stack">
          <div>
            <p className="settings__label">브라우저 푸시 알림</p>
            <p className="settings__description">{pushDescription}</p>
            <span className={pushBadgeClass}>{pushStatusLabel}</span>
          </div>
          <div className="settings__actions">
            <button
              type="button"
              className={['settings__toggle', isPushEnabled && 'is-active'].filter(Boolean).join(' ')}
              disabled={isPushProcessing || pushState.status === 'unsupported' || isLoggingOut}
              onClick={handlePushToggle}
              aria-pressed={isPushEnabled}
              aria-label="브라우저 푸시 알림 설정"
            >
              <span />
            </button>
          </div>
        </div>
      </section>

      <section className="settings__card" aria-label="시간 및 통계 기준">
        <h2>시간 & 통계 기준</h2>
        <ul className="settings__list">
          <li>
            <p className="settings__label">표시 타임존</p>
            <p className="settings__value">{isTimeLoading ? '시간대를 불러오는 중...' : offsetLabel}</p>
          </li>
          <li>
            <p className="settings__label">주간 기준</p>
            <p className="settings__value">월요일 시작 · 7일 고정</p>
          </li>
          <li>
            <p className="settings__label">통계 자동 업데이트</p>
            <div className="settings__row settings__row--tight">
              <p className="settings__description">매일 00:00 기준 자동 계산</p>
              <button
                className={['settings__toggle', isAutoStatsEnabled && 'is-active'].filter(Boolean).join(' ')}
                onClick={() => setIsAutoStatsEnabled((prev) => !prev)}
                aria-pressed={isAutoStatsEnabled}
              >
                <span />
              </button>
            </div>
          </li>
        </ul>
      </section>

      <section className="settings__card" aria-label="향후 추가 예정">
        <h2>향후 추가 예정</h2>
        <p className="settings__description">
          작업 타입 라벨, 알림 방식 지정, GPT 추천 설정 등은 추후 이 영역에 확장됩니다.
        </p>
      </section>

      <section className="settings__card settings__card--danger" aria-label="계정">
        <h2>계정</h2>
        <div className="settings__row settings__row--between">
          <div>
            <p className="settings__label">로그아웃</p>
            <p className="settings__description">로그아웃하면 액세스/리프레시 토큰이 삭제됩니다.</p>
          </div>
          <button type="button" className="settings__logout-btn" onClick={handleLogout}>
            {isLoggingOut ? '로그아웃 중...' : '로그아웃'}
          </button>
        </div>
      </section>
    </section>
  )
}

export default SettingsPage
