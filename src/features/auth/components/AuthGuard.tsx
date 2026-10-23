import { useEffect, useState } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'
import { refreshAccessToken } from '../api/auth'
import { clearAuthTokens, getAccessToken, isAccessTokenExpired, isLoggedOut } from '@shared/api/authTokens'
import { rememberReturnTo } from '../utils/returnTo'

const AuthGuard = () => {
  const [isReady, setIsReady] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    let isCancelled = false

    // 로그인 뒤 지금 보던 화면(예: /oauth/consent?request=…)으로 돌아올 수 있게 기억한다.
    const redirectToLogin = () => {
      rememberReturnTo(`${window.location.pathname}${window.location.search}`)
      navigate('/login', { replace: true })
    }

    const ensureAuth = async () => {
      if (isLoggedOut()) {
        clearAuthTokens()
        redirectToLogin()
        return
      }
      const token = getAccessToken()
      const shouldRefresh = !token || isAccessTokenExpired(token)
      if (!shouldRefresh) {
        setIsReady(true)
        return
      }
      try {
        await refreshAccessToken()
        if (!isCancelled) setIsReady(true)
      } catch (error) {
        if (isCancelled) return
        console.warn('⚠️ 인증 확인 실패, 로그인 페이지로 이동합니다:', error)
        clearAuthTokens()
        redirectToLogin()
      }
    }

    ensureAuth()

    return () => {
      isCancelled = true
    }
  }, [navigate])

  if (!isReady) return null

  return <Outlet />
}

export default AuthGuard
