import { useEffect, useState } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'
import { refreshAccessToken } from '../api/auth'
import { clearAuthTokens, getAccessToken, isAccessTokenExpired, isLoggedOut } from '@shared/api/authTokens'

const AuthGuard = () => {
  const [isReady, setIsReady] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    let isCancelled = false

    const ensureAuth = async () => {
      if (isLoggedOut()) {
        clearAuthTokens()
        navigate('/login', { replace: true })
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
        navigate('/login', { replace: true })
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
