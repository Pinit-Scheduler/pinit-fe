import { useState, useSyncExternalStore } from 'react'
import useOnlineStatus from '@shared/hooks/useOnlineStatus'
import {
  hasInstallPrompt,
  installAvailability,
  isIosSafari,
  isStandalone,
  promptInstall,
  subscribeInstallPrompt,
} from '@shared/pwa/installPrompt'
import { NUDGE_KEYS, readFlag, writeFlag } from '@shared/utils/safeStorage'
import './AppBanners.css'

/** 연결이 끊기면 상단에 알린다. 캐시된 화면은 보이지만 새로 불러오거나 저장하지 못한다. */
export const OfflineBanner = () => {
  const isOnline = useOnlineStatus()
  if (isOnline) return null
  return (
    <div className="app-banner app-banner--offline" role="status">
      <span aria-hidden>📡</span>
      <p>오프라인이에요. 저장된 화면만 보이고, 바꾼 내용은 연결된 뒤에 다시 시도해 주세요.</p>
    </div>
  )
}

/** 홈 화면에 설치하라는 안내. 설치했거나, 브라우저가 설치를 못 하거나, 닫았으면 보이지 않는다. */
export const InstallBanner = () => {
  const hasPrompt = useSyncExternalStore(subscribeInstallPrompt, hasInstallPrompt, () => false)
  const [dismissed, setDismissed] = useState(() => readFlag(NUDGE_KEYS.installBannerDismissed))
  const availability = installAvailability({
    standalone: isStandalone(),
    hasPrompt,
    iosSafari: isIosSafari(navigator.userAgent, navigator.maxTouchPoints),
  })

  if (dismissed || availability === 'none') return null

  const dismiss = () => {
    writeFlag(NUDGE_KEYS.installBannerDismissed)
    setDismissed(true)
  }

  const install = async () => {
    const outcome = await promptInstall()
    if (outcome === 'accepted') dismiss()
  }

  return (
    <div className="app-banner app-banner--install" role="region" aria-label="앱 설치 안내">
      <span aria-hidden>📲</span>
      <p>
        {availability === 'prompt'
          ? '홈 화면에 Pinit을 추가하면 앱처럼 바로 열 수 있어요.'
          : 'Safari 공유 버튼에서 "홈 화면에 추가"를 고르면 앱처럼 열리고 일정 알림도 받을 수 있어요.'}
      </p>
      <div className="app-banner__actions">
        {availability === 'prompt' && (
          <button type="button" className="app-banner__primary" onClick={() => void install()}>
            설치
          </button>
        )}
        <button type="button" className="app-banner__close" onClick={dismiss} aria-label="설치 안내 닫기">
          ✕
        </button>
      </div>
    </div>
  )
}
