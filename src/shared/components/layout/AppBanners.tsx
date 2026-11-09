import WorkspaceIcon from '@shared/components/common/WorkspaceIcon'
import { useEffect, useState, useSyncExternalStore } from 'react'
import useOnlineStatus from '@shared/hooks/useOnlineStatus'
import { usePresence } from '@shared/motion/usePresence'
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

/**
 * Keeps a banner mounted through its exit and decides whether it should animate in.
 * A banner that is already there when the shell (or Today) renders arrives with the page,
 * so only one that appears later, while the person is looking, drops in.
 */
const useBannerPresence = <T,>(value: T | null) => {
  const presence = usePresence(value)
  const [arrivedWithPage, setArrivedWithPage] = useState(() => value !== null)
  if (arrivedWithPage && !presence.mounted) setArrivedWithPage(false)
  return {
    ...presence,
    motionProps: {
      'data-state': presence.closing ? 'closing' : 'open',
      'data-enter': arrivedWithPage ? undefined : '',
      'aria-hidden': presence.closing || undefined,
      inert: presence.closing || undefined,
    } as const,
  }
}

export const UpdateBanner = () => {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const notify = () => setReady(true)
    window.addEventListener('pinit:update-ready', notify)
    return () => window.removeEventListener('pinit:update-ready', notify)
  }, [])
  const banner = useBannerPresence(ready || null)
  if (!banner.mounted) return null
  return (
    <div className="app-banner app-banner--install" role="status" {...banner.motionProps}>
      <p>새 버전이 준비됐어요. 작성 중인 내용을 저장한 뒤 업데이트해 주세요.</p>
      <button
        className="workspace-button"
        onClick={() => window.location.reload()}
      >
        업데이트
      </button>
      <button aria-label="업데이트 안내 닫기" onClick={() => setReady(false)}>
        <WorkspaceIcon name="close" />
      </button>
    </div>
  )
}

/** 연결이 끊기면 상단에 알린다. 캐시된 화면은 보이지만 새로 불러오거나 저장하지 못한다. */
export const OfflineBanner = () => {
  const isOnline = useOnlineStatus()
  const banner = useBannerPresence(isOnline ? null : true)
  if (!banner.mounted) return null
  return (
    <div className="app-banner app-banner--offline" role="status" {...banner.motionProps}>
      <span aria-hidden><WorkspaceIcon name="wifiOff" /></span>
      <p>
        오프라인이에요. 저장된 화면만 보이고, 바꾼 내용은 연결된 뒤에 다시
        시도해 주세요.
      </p>
    </div>
  )
}

/** 홈 화면에 설치하라는 안내. 설치했거나, 브라우저가 설치를 못 하거나, 닫았으면 보이지 않는다. */
export const InstallBanner = () => {
  const hasPrompt = useSyncExternalStore(
    subscribeInstallPrompt,
    hasInstallPrompt,
    () => false,
  )
  const [dismissed, setDismissed] = useState(() =>
    readFlag(NUDGE_KEYS.installBannerDismissed),
  )
  const availability = installAvailability({
    standalone: isStandalone(),
    hasPrompt,
    iosSafari: isIosSafari(navigator.userAgent, navigator.maxTouchPoints),
  })
  // The last availability stays on screen while the banner fades out.
  const banner = useBannerPresence(dismissed || availability === 'none' ? null : availability)

  if (!banner.mounted || !banner.value) return null
  const shown = banner.value

  const dismiss = () => {
    writeFlag(NUDGE_KEYS.installBannerDismissed)
    setDismissed(true)
  }

  const install = async () => {
    const outcome = await promptInstall()
    if (outcome === 'accepted') dismiss()
  }

  return (
    <div
      className="app-banner app-banner--install"
      role="region"
      aria-label="앱 설치 안내"
      {...banner.motionProps}
    >
      <span aria-hidden><WorkspaceIcon name="download" /></span>
      <p>
        {shown === 'prompt'
          ? '홈 화면에 Pinit을 추가하면 앱처럼 바로 열 수 있어요.'
          : 'Safari 공유 버튼에서 "홈 화면에 추가"를 고르면 앱처럼 열리고 일정 알림도 받을 수 있어요.'}
      </p>
      <div className="app-banner__actions">
        {shown === 'prompt' && (
          <button
            type="button"
            className="app-banner__primary"
            onClick={() => void install()}
          >
            설치
          </button>
        )}
        <button
          type="button"
          className="app-banner__close"
          onClick={dismiss}
          aria-label="설치 안내 닫기"
        >
          <WorkspaceIcon name="close" />
        </button>
      </div>
    </div>
  )
}
