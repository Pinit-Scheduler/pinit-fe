import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { consumeReturnTo, resolvePostLoginTarget } from '../utils/returnTo'

/** 로그인 전 보던 화면(예: OAuth 동의 화면)으로 돌려보내고, 없으면 대시보드로 이동한다. */
const useNavigateAfterLogin = () => {
  const navigate = useNavigate()

  return useCallback(() => {
    const target = resolvePostLoginTarget(consumeReturnTo())
    if (target.fullPageLoad) {
      window.location.replace(target.path)
      return
    }
    navigate(target.path, { replace: true })
  }, [navigate])
}

export default useNavigateAfterLogin
