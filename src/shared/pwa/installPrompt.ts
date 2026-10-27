// 홈 화면 설치 안내. Chrome·Edge·삼성 인터넷은 beforeinstallprompt를 주고, iOS Safari는 주지 않으므로
// 공유 메뉴에서 추가하는 방법을 글로 안내한다. 이벤트는 앱이 그려지기 전에 올 수 있어 main.tsx에서 먼저 받아 둔다.

type InstallChoice = { outcome: 'accepted' | 'dismissed' }

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<InstallChoice>
}

export type InstallAvailability = 'prompt' | 'ios' | 'none'

let deferredPrompt: BeforeInstallPromptEvent | null = null
const listeners = new Set<() => void>()

const notify = () => listeners.forEach((listener) => listener())

export const listenForInstallPrompt = () => {
  if (typeof window === 'undefined') return
  window.addEventListener('beforeinstallprompt', (event) => {
    // 브라우저 기본 미니 배너 대신 앱 안의 안내에서 띄운다.
    event.preventDefault()
    deferredPrompt = event as BeforeInstallPromptEvent
    notify()
  })
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null
    notify()
  })
}

export const subscribeInstallPrompt = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const hasInstallPrompt = () => deferredPrompt !== null

/** iOS의 Safari(홈 화면 추가는 Safari 공유 메뉴에서만 된다). iPadOS는 데스크톱 UA라 터치 지원으로 가린다. */
export const isIosSafari = (userAgent: string, maxTouchPoints = 0) => {
  const isIos = /iphone|ipad|ipod/i.test(userAgent) || (/macintosh/i.test(userAgent) && maxTouchPoints > 1)
  return isIos && /safari/i.test(userAgent) && !/crios|fxios|edgios|kakaotalk|naver|instagram|fban|line\//i.test(userAgent)
}

export const isStandalone = () =>
  (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches) ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true

export const installAvailability = (state: { standalone: boolean; hasPrompt: boolean; iosSafari: boolean }): InstallAvailability => {
  if (state.standalone) return 'none'
  if (state.hasPrompt) return 'prompt'
  return state.iosSafari ? 'ios' : 'none'
}

/** 저장해 둔 설치 창을 띄운다. 한 번 쓴 이벤트는 다시 쓸 수 없어 비운다. */
export const promptInstall = async (): Promise<InstallChoice['outcome'] | 'unavailable'> => {
  const event = deferredPrompt
  if (!event) return 'unavailable'
  deferredPrompt = null
  notify()
  await event.prompt()
  return (await event.userChoice).outcome
}
