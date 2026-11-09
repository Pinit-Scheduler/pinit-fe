import { useEffect, useState } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'
import { refreshAccessToken } from '../api/auth'
import { clearAuthTokens, getAccessToken, isAccessTokenExpired, isLoggedOut } from '@shared/api/authTokens'
import { rememberReturnTo } from '../utils/returnTo'
import { resolveAuthEntry } from '../utils/authEntry'
import AuthBoot from './AuthBoot'

const readAuthEntry = () =>
  resolveAuthEntry({
    loggedOut: isLoggedOut(),
    token: getAccessToken(),
    isExpired: isAccessTokenExpired,
  })

const AuthGuard = () => {
  // A valid stored token renders the page in the first frame. Only a refresh or a redirect waits.
  const [isReady, setIsReady] = useState(() => readAuthEntry() === 'ready')
  const navigate = useNavigate()

  useEffect(() => {
    if (isReady) return
    let isCancelled = false

    // 로그인 뒤 지금 보던 화면(예: /oauth/consent?request=…)으로 돌아올 수 있게 기억한다.
    const redirectToLogin = () => {
      rememberReturnTo(`${window.location.pathname}${window.location.search}`)
      navigate('/login', { replace: true })
    }

    const ensureAuth = async () => {
      const entry = readAuthEntry()
      if (entry === 'logged-out') {
        clearAuthTokens()
        redirectToLogin()
        return
      }
      if (entry === 'ready') {
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
  }, [isReady, navigate])

  if (!isReady) return <AuthBoot />

  return <Outlet />
}

export default AuthGuard
