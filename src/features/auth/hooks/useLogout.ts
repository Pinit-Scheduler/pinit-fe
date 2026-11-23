import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { clearAuthTokens, markLoggedOut } from '@shared/api/authTokens'
import { getRequestFailureMessage } from '@shared/api/errorMessage'
import { useToast } from '@contexts/ToastContext'
import { logout as requestLogout } from '../api/auth'
import { postToNative } from '@shared/native/nativeShell'

/**
 * 이 기기의 푸시 구독을 먼저 해지하고(실패해도 진행) 서버 로그인을 끝낸 뒤 로그인 화면으로 간다.
 * 푸시 해지 함수는 화면이 이미 쓰는 usePushSubscription에서 받아, 구독 상태 조회가 두 번 일어나지 않게 한다.
 */
const useLogout = (unsubscribePush: () => Promise<unknown>) => {
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const navigate = useNavigate()
  const { addToast } = useToast()

  const logout = useCallback(async () => {
    // 핀잇 앱 안에서는 앱이 로그아웃한다. refresh token을 앱이 쥐고 있어 서버 폐기도 앱이 해야 한다.
    // 앱이 끝내면 이 WebView는 닫히고, 실패하면 앱이 이유를 알린다.
    if (postToNative({ type: 'logout' })) return
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
      addToast('로그아웃했어요.', 'info')
      navigate('/login', { replace: true })
    } catch (error) {
      addToast(getRequestFailureMessage(error, '로그아웃하지 못했어요.'), 'error')
    } finally {
      setIsLoggingOut(false)
    }
  }, [addToast, navigate, unsubscribePush])

  return { logout, isLoggingOut }
}

export default useLogout
