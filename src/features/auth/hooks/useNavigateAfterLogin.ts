import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { consumeReturnTo, resolvePostLoginTarget } from '../utils/returnTo'
import { emailRequirement, readEmailRequired } from '../utils/emailRequirement'
import { EMAIL_REGISTRATION_PATH } from '../utils/authPaths'
import { currentTokenSubject } from '../utils/currentTokenSubject'

/**
 * 로그인 전 보던 화면(예: OAuth 동의 화면)으로 돌려보내고, 없으면 대시보드로 이동한다.
 * 이메일 등록이 필요한 회원은 먼저 등록 화면으로 보낸다. 돌아갈 경로는 등록을 마칠 때까지 남겨 둔다.
 * 로그인 응답을 넘기면 그 응답의 emailRequired를 이 회원 값으로 기억한다.
 */
const useNavigateAfterLogin = () => {
  const navigate = useNavigate()

  return useCallback(
    (loginResponse?: unknown) => {
      const subject = currentTokenSubject()
      const required = readEmailRequired(loginResponse)
      if (required !== null) emailRequirement.set(subject, required)
      if (emailRequirement.get(subject) === true) {
        navigate(EMAIL_REGISTRATION_PATH, { replace: true })
        return
      }
      const target = resolvePostLoginTarget(consumeReturnTo())
      if (target.fullPageLoad) {
        window.location.replace(target.path)
        return
      }
      navigate(target.path, { replace: true })
    },
    [navigate],
  )
}

export default useNavigateAfterLogin
