import { useSyncExternalStore } from 'react'

const subscribe = (onChange: () => void) => {
  window.addEventListener('online', onChange)
  window.addEventListener('offline', onChange)
  return () => {
    window.removeEventListener('online', onChange)
    window.removeEventListener('offline', onChange)
  }
}

/** 브라우저가 아는 연결 상태. false면 확실히 끊긴 것이고, true여도 서버에 닿는다는 보장은 없다. */
const useOnlineStatus = () =>
  useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  )

export default useOnlineStatus
