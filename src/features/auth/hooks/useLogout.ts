import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { clearAuthTokens, markLoggedOut } from '@shared/api/authTokens'
import { useToast } from '@contexts/ToastContext'
import { logout as requestLogout } from '../api/auth'

/**
 * 이 기기의 푸시 구독을 먼저 해지하고(실패해도 진행) 서버 로그인을 끝낸 뒤 로그인 화면으로 간다.
 * 푸시 해지 함수는 화면이 이미 쓰는 usePushSubscription에서 받아, 구독 상태 조회가 두 번 일어나지 않게 한다.
 */
const useLogout = (unsubscribePush: () => Promise<unknown>) => {
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const navigate = useNavigate()
  const { addToast } = useToast()

  const logout = useCallback(async () => {
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
  }, [addToast, navigate, unsubscribePush])

  return { logout, isLoggingOut }
}

export default useLogout
