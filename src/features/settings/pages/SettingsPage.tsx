import { Link, useNavigate } from 'react-router-dom'
import { useRef, useState } from 'react'
import { tabLinkClick } from '@shared/routing/viewTransitionNavigation'
import { NUDGE_KEYS, readFlag } from '@shared/utils/safeStorage'
import { clearAuthTokens, markLoggedOut } from '@shared/api/authTokens'
import { logout as requestLogout } from '@features/auth/api/auth'
import { useToast } from '@contexts/ToastContext'
import usePushSubscription from '@shared/hooks/usePushSubscription'
import { useTimePreferences } from '@contexts/TimePreferencesContext'
import AccountSection from '../components/AccountSection'
import AiConnectionSection from '../components/AiConnectionSection'
import SavedMark from '@shared/components/motion/SavedMark'
import ThemeSection from '../components/ThemeSection'
import useNotificationPreferences from '../hooks/useNotificationPreferences'
import {
  REMINDER_MINUTE_OPTIONS,
  normalizeDeadlineTime,
  parseReminderOption,
  reminderOptionLabel,
  type NotificationPreferences,
} from '../utils/notificationPreferences'
import { DailyObjectiveSetting, TimeZoneSetting } from '../components/ProfileSettingRows'
import useProfileSettings from '../hooks/useProfileSettings'
import useSavedFlash from '../hooks/useSavedFlash'
import './SettingsPage.css'

const SettingsPage = () => {
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  // 처음 한 번만 "새 기능"을 단다. 생활 시간 화면에 들어가면 확인한 것으로 본다.
  const [showRoutinesNew] = useState(() => !readFlag(NUDGE_KEYS.routinesNewBadgeSeen))
  const [showRecurrencesNew] = useState(() => !readFlag(NUDGE_KEYS.recurrencesNewBadgeSeen))
  const navigate = useNavigate()
  const { addToast } = useToast()
  const { zoneId } = useTimePreferences()
  const {
    preferences,
    isLoading: isPreferencesLoading,
    loadError: preferencesLoadError,
    update: updatePreferences,
  } = useNotificationPreferences(zoneId)
  const isPreferencesUnavailable = isPreferencesLoading || preferencesLoadError !== null
  // 토글은 저장 중 한 번 더 눌리지 않게 ref로 잠근다. 막아서 흐리게 하면 저장할 때마다 토글이 깜빡인다.
  // select·시각 입력은 막으면 키보드 편집 중 포커스를 잃는다.
  const toggleLock = useRef(false)
  const { flash, isFlashing } = useSavedFlash()
  // 시각 입력은 이 화면에서 알림을 켰을 때만 스며든다. 화면을 다시 열 때마다 다시 움직이지 않게 한다.
  const [revealDeadlineTime, setRevealDeadlineTime] = useState(false)
  // 시각은 입력하는 동안 화면에만 두고, 입력을 마치면(blur) 저장한다.
  const [deadlineTimeDraft, setDeadlineTimeDraft] = useState<string | null>(null)
  const profileSettings = useProfileSettings()
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
      const message = error instanceof Error && error.message ? error.message : '로그아웃에 실패했어요.'
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

  /** 저장이 끝나면 그 줄에 체크를 잠깐 그린다. 실패하면 값이 되돌아가고 서버 문구를 토스트로 보인다. */
  const savePreferences = async (patch: Partial<NotificationPreferences>, row: string) => {
    try {
      await updatePreferences(patch)
      flash(row)
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : '알림 설정을 저장하지 못했어요.'
      addToast(message, 'error')
    }
  }

  const togglePreference = async (patch: Partial<NotificationPreferences>, row: string) => {
    if (toggleLock.current) return
    toggleLock.current = true
    try {
      await savePreferences(patch, row)
    } finally {
      toggleLock.current = false
    }
  }

  const commitDeadlineTime = () => {
    const time = deadlineTimeDraft === null ? null : normalizeDeadlineTime(deadlineTimeDraft)
    setDeadlineTimeDraft(null)
    if (time && time !== preferences.taskDeadlineTime) {
      savePreferences({ taskDeadlineTime: time }, 'taskDeadline')
    }
  }

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
      const message = error instanceof Error && error.message ? error.message : '푸시 알림 설정에 실패했어요.'
      addToast(message, 'error')
    }
  }

  return (
    <section className="settings">
      <header className="settings__header">
        <p className="settings__subheading">앱 기본값</p>
        <h1 className="settings__title">알림 및 기준 정보</h1>
      </header>

      <section className="settings__card" aria-label="자동 계획">
        <h2>자동 계획</h2>
        <Link
          to="/app/settings/routines"
          onClick={tabLinkClick('/app/settings/routines')}
          className="settings__row settings__row--link"
          data-onboarding-anchor="settings.routines"
        >
          <div>
            <p className="settings__label">
              생활 시간
              {showRoutinesNew && <span className="settings__badge settings__badge--new">새 기능</span>}
            </p>
            <p className="settings__description">식사·수면 시간을 알려 주면 계획이 그 시간을 비워 둬요.</p>
          </div>
          <span className="settings__chevron" aria-hidden>
            ›
          </span>
        </Link>
        <Link
          to="/app/settings/recurrences"
          onClick={tabLinkClick('/app/settings/recurrences')}
          className="settings__row settings__row--link"
          data-onboarding-anchor="settings.recurrences"
        >
          <div>
            <p className="settings__label">
              반복 관리
              {showRecurrencesNew && <span className="settings__badge settings__badge--new">새 기능</span>}
            </p>
            <p className="settings__description">주간 회의나 운동처럼 반복되는 일정·작업을 보고 고치거나 끝내요.</p>
          </div>
          <span className="settings__chevron" aria-hidden>
            ›
          </span>
        </Link>
        <DailyObjectiveSetting {...profileSettings} />
      </section>

      <section className="settings__card" aria-label="휴지통">
        <h2>휴지통</h2>
        <Link
          to="/app/settings/trash"
          onClick={tabLinkClick('/app/settings/trash')}
          className="settings__row settings__row--link"
        >
          <div>
            <p className="settings__label">휴지통</p>
            <p className="settings__description">지운 작업·일정은 30일 동안 남아요. 여기서 복구하거나 바로 영구 삭제해요.</p>
          </div>
          <span className="settings__chevron" aria-hidden>
            ›
          </span>
        </Link>
      </section>

      <section className="settings__card" aria-label="알림 설정">
        <h2>알림 설정</h2>
        {preferencesLoadError && (
          <p className="settings__description settings__description--error" role="alert">
            알림 설정을 불러오지 못했어요. 잠시 뒤 다시 열어 주세요.
          </p>
        )}
        <div className="settings__row">
          <div>
            <p className="settings__label">일정 시작 알림</p>
            <p className="settings__description">일정이 시작하는 시각에 알려 드려요.</p>
          </div>
          <div className="settings__actions">
            <SavedMark visible={isFlashing('scheduleStart')} />
            <button
              type="button"
              className={['settings__toggle', preferences.scheduleStartEnabled && 'is-active'].filter(Boolean).join(' ')}
              disabled={isPreferencesUnavailable}
              onClick={() =>
                void togglePreference({ scheduleStartEnabled: !preferences.scheduleStartEnabled }, 'scheduleStart')
              }
              aria-pressed={preferences.scheduleStartEnabled}
              aria-label="일정 시작 알림"
            >
              <span />
            </button>
          </div>
        </div>
        <div className="settings__row">
          <div>
            <p className="settings__label">일정 시작 전 알림</p>
            <p className="settings__description">시작 전에 한 번 더 알려 드려요.</p>
          </div>
          <div className="settings__actions">
            <SavedMark visible={isFlashing('scheduleReminder')} />
            <select
              className="settings__select"
              value={preferences.scheduleReminderMinutes === null ? 'off' : String(preferences.scheduleReminderMinutes)}
              disabled={isPreferencesUnavailable}
              onChange={(event) =>
                savePreferences({ scheduleReminderMinutes: parseReminderOption(event.target.value) }, 'scheduleReminder')
              }
              aria-label="일정 시작 전 알림"
            >
              <option value="off">{reminderOptionLabel(null)}</option>
              {REMINDER_MINUTE_OPTIONS.map((minutes) => (
                <option key={minutes} value={minutes}>
                  {reminderOptionLabel(minutes)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="settings__row">
          <div>
            <p className="settings__label">작업 마감일 알림</p>
            <p className="settings__description">마감일 당일, 정한 시각에 아직 끝내지 않은 작업을 한 번에 알려 드려요.</p>
          </div>
          <div className="settings__actions">
            <SavedMark visible={isFlashing('taskDeadline')} />
            {preferences.taskDeadlineEnabled && (
              <input
                type="time"
                className={revealDeadlineTime ? 'settings__time settings__time--reveal' : 'settings__time'}
                value={deadlineTimeDraft ?? preferences.taskDeadlineTime}
                disabled={isPreferencesUnavailable}
                onChange={(event) => setDeadlineTimeDraft(event.target.value)}
                onBlur={commitDeadlineTime}
                aria-label="작업 마감일 알림 시각"
              />
            )}
            <button
              type="button"
              className={['settings__toggle', preferences.taskDeadlineEnabled && 'is-active'].filter(Boolean).join(' ')}
              disabled={isPreferencesUnavailable}
              onClick={() => {
                if (toggleLock.current) return
                if (!preferences.taskDeadlineEnabled) setRevealDeadlineTime(true)
                void togglePreference({ taskDeadlineEnabled: !preferences.taskDeadlineEnabled }, 'taskDeadline')
              }}
              aria-pressed={preferences.taskDeadlineEnabled}
              aria-label="작업 마감일 알림"
            >
              <span />
            </button>
          </div>
        </div>
        <div className="settings__row settings__row--stack" data-onboarding-anchor="settings.push">
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
          <TimeZoneSetting {...profileSettings} />
          <li>
            <p className="settings__label">주간 기준</p>
            <p className="settings__value">월요일 시작 · 7일 고정</p>
          </li>
        </ul>
      </section>

      <ThemeSection />

      <AiConnectionSection />

      <section className="settings__card" aria-label="도움말">
        <h2>도움말</h2>
        <Link
          to="/app/settings/onboarding"
          onClick={tabLinkClick('/app/settings/onboarding')}
          className="settings__row settings__row--link"
          data-onboarding-anchor="settings.onboarding"
        >
          <div>
            <p className="settings__label">온보딩</p>
            <p className="settings__description">핀잇의 기능과 동작 원리, 사용 방법</p>
          </div>
          <span className="settings__chevron" aria-hidden>
            ›
          </span>
        </Link>
      </section>

      <AccountSection onLogout={handleLogout} isLoggingOut={isLoggingOut} />
    </section>
  )
}

export default SettingsPage
