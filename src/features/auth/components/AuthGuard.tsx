import { useEffect, useState, useSyncExternalStore } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { refreshAccessToken } from '../api/auth'
import { fetchAccount } from '@features/settings/api/account'
import { clearAuthTokens, getAccessToken, isAccessTokenExpired, isLoggedOut } from '@shared/api/authTokens'
import { ApiError } from '@shared/api/httpClient'
import { rememberReturnTo } from '../utils/returnTo'
import { decideEmailGate, emailRequirement, isEmailRegistrationPath } from '../utils/emailRequirement'
import { EMAIL_REGISTRATION_PATH } from '../utils/authPaths'
import { currentTokenSubject } from '../utils/currentTokenSubject'
import useNavigateAfterLogin from '../hooks/useNavigateAfterLogin'

// 이 회원의 이메일 등록 필요 여부를 아직 모르면(새로고침, 값이 없는 로그인 응답) 계정 조회로 확인한다.
const ensureEmailRequirement = async (subject: string | null) => {
  if (emailRequirement.get(subject) !== null) return
  try {
    const account = await fetchAccount()
    emailRequirement.set(subject, account?.emailRequired === true)
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) throw error
    // 확인하지 못해도 막지 않는다. 서버도 미등록 회원의 다른 API를 막지 않는다. 새로고침하면 다시 확인한다.
    console.warn('⚠️ 이메일 등록 여부를 확인하지 못했어요:', error)
    emailRequirement.set(subject, false)
  }
}

const AuthGuard = () => {
  // 인증을 마친 회원. 확인 전에는 아무것도 그리지 않는다.
  const [member, setMember] = useState<{ subject: string | null } | null>(null)
  const navigate = useNavigate()
  const location = useLocation()
  const navigateAfterLogin = useNavigateAfterLogin()
  const emailRequired = useSyncExternalStore(emailRequirement.subscribe, () =>
    member ? emailRequirement.get(member.subject) : null,
  )

  useEffect(() => {
    let isCancelled = false

    // 로그인 뒤 지금 보던 화면(예: /oauth/consent?request=…)으로 돌아올 수 있게 기억한다.
    // 이메일 등록 화면은 기억하지 않는다. 다시 로그인하면 등록 필요 여부로 다시 정한다.
    const redirectToLogin = () => {
      if (!isEmailRegistrationPath(window.location.pathname)) {
        rememberReturnTo(`${window.location.pathname}${window.location.search}`)
      }
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
      try {
        if (shouldRefresh) await refreshAccessToken()
        const subject = currentTokenSubject()
        await ensureEmailRequirement(subject)
        if (!isCancelled) setMember({ subject })
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

  // 인증 뒤 토큰이 사라지거나 다른 회원으로 바뀌면 값을 모른다. 그때는 이전처럼 화면을 그대로 둔다.
  const decision = member
    ? emailRequired === null
      ? 'render'
      : decideEmailGate(emailRequired, location.pathname)
    : null

  useEffect(() => {
    if (decision === 'toRegistration') {
      rememberReturnTo(`${location.pathname}${location.search}`)
      navigate(EMAIL_REGISTRATION_PATH, { replace: true })
    } else if (decision === 'leaveRegistration') {
      navigateAfterLogin()
    }
  }, [decision, location.pathname, location.search, navigate, navigateAfterLogin])

  if (decision !== 'render') return null

  return <Outlet />
}

export default AuthGuard
