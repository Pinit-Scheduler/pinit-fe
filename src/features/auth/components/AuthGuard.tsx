import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { refreshSession } from '@shared/api/authSession'
import { fetchAccount } from '@features/settings/api/account'
import { clearAuthTokens, getAccessToken, isAccessTokenExpired, isLoggedOut } from '@shared/api/authTokens'
import { ApiError } from '@shared/api/httpClient'
import { rememberReturnTo } from '../utils/returnTo'
import { resolveAuthEntry } from '../utils/authEntry'
import { decideEmailGate, emailRequirement, isEmailRegistrationPath } from '../utils/emailRequirement'
import { EMAIL_REGISTRATION_PATH } from '../utils/authPaths'
import { currentTokenSubject } from '../utils/currentTokenSubject'
import { RETRY_NOTICE_AFTER, startSessionRestore, transientMessage, type SessionRestore } from '../utils/sessionRestore'
import useNavigateAfterLogin from '../hooks/useNavigateAfterLogin'
import AuthBoot from './AuthBoot'

const readAuthEntry = () =>
  resolveAuthEntry({
    loggedOut: isLoggedOut(),
    token: getAccessToken(),
    isExpired: isAccessTokenExpired,
  })

/** 인증을 마친 회원. 토큰의 subject로 이메일 등록 필요 여부를 회원별로 기억한다. */
type Member = { subject: string | null }

const AuthGuard = () => {
  // A valid stored token renders the page in the first frame. Only a refresh or a redirect waits.
  const [member, setMember] = useState<Member | null>(() =>
    readAuthEntry() === 'ready' ? { subject: currentTokenSubject() } : null,
  )
  const navigate = useNavigate()
  const location = useLocation()
  const navigateAfterLogin = useNavigateAfterLogin()
  const readEmailRequired = () => (member ? emailRequirement.get(member.subject) : null)
  const emailRequired = useSyncExternalStore(emailRequirement.subscribe, readEmailRequired, readEmailRequired)

  // 로그인 뒤 지금 보던 화면(예: /oauth/consent?request=…)으로 돌아올 수 있게 기억한다.
  // 이메일 등록 화면은 기억하지 않는다. 다시 로그인하면 등록 필요 여부로 다시 정한다.
  const redirectToLogin = useCallback(() => {
    if (!isEmailRegistrationPath(window.location.pathname)) {
      rememberReturnTo(`${window.location.pathname}${window.location.search}`)
    }
    navigate('/login', { replace: true })
  }, [navigate])

  // Transient refresh failures in a row while there is no member yet (no answer about the session).
  const [retry, setRetry] = useState<{ failures: number; message: string } | null>(null)
  const restore = useRef<SessionRestore | null>(null)

  useEffect(() => {
    if (member) return
    let session: SessionRestore | null = null

    const ensureAuth = () => {
      const entry = readAuthEntry()
      if (entry === 'logged-out') {
        clearAuthTokens()
        redirectToLogin()
        return
      }
      if (entry === 'ready') {
        setMember({ subject: currentTokenSubject() })
        return
      }
      // Only an answered 401/403 ends the session. Without an answer the boot screen stays and retries.
      session = startSessionRestore(refreshSession, {
        onRefreshed: () => {
          setRetry(null)
          setMember({ subject: currentTokenSubject() })
        },
        onUnauthorized: () => {
          console.warn('⚠️ 로그인 세션이 끝나 로그인 페이지로 이동합니다.')
          clearAuthTokens()
          redirectToLogin()
        },
        onTransient: (failures, result) => {
          console.warn('⚠️ 로그인 상태를 확인하지 못해 다시 시도합니다:', failures)
          setRetry({ failures, message: transientMessage(result) })
        },
      })
      restore.current = session
    }

    ensureAuth()

    return () => {
      session?.stop()
      if (restore.current === session) restore.current = null
    }
  }, [member, redirectToLogin])

  // 이 회원의 이메일 등록 필요 여부를 아직 모르면(새로고침, 값이 없는 로그인 응답) 화면을 막지 않고 계정 조회로 확인한다.
  useEffect(() => {
    if (!member || emailRequirement.get(member.subject) !== null) return
    let isCancelled = false
    fetchAccount()
      .then((account) => {
        if (!isCancelled) emailRequirement.set(member.subject, account?.emailRequired === true)
      })
      .catch((error: unknown) => {
        if (isCancelled) return
        // A refresh without an answer reaches here as a network error (status 0), never as this 401.
        if (error instanceof ApiError && error.status === 401) {
          clearAuthTokens()
          redirectToLogin()
          return
        }
        // 확인하지 못해도 막지 않는다. 서버도 미등록 회원의 다른 API를 막지 않는다. 새로고침하면 다시 확인한다.
        console.warn('⚠️ 이메일 등록 여부를 확인하지 못했어요:', error)
        emailRequirement.set(member.subject, false)
      })
    return () => {
      isCancelled = true
    }
  }, [member, redirectToLogin])

  // 등록 필요 여부를 모르는 동안(확인 중, 또는 토큰이 다른 회원으로 바뀜)에는 화면을 그대로 둔다.
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

  if (!member) {
    const retrying = !!retry && retry.failures >= RETRY_NOTICE_AFTER
    return (
      <AuthBoot
        retrying={retrying}
        message={retry?.message}
        onRetry={() => restore.current?.retryNow()}
      />
    )
  }
  if (decision !== 'render') return null

  return <Outlet />
}

export default AuthGuard
