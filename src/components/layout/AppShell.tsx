import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useRef } from 'react'
import TopBar from './TopBar'
import BottomTabBar from './BottomTabBar'
import MiniPlayerBar from '../schedules/MiniPlayerBar'
import { refreshAccessToken } from '../../api/auth'
import { clearAuthTokens, getAccessToken, isLoggedOut } from '../../api/authTokens'
import './AppShell.css'

const TAB_TITLES: Record<string, string> = {
  '/app/schedules': '일정',
  '/app/new': '일정 추가',
  '/app/statistics': '통계',
  '/app/settings': '설정',
}

const getPageTitle = (pathname: string): string => {
  if (pathname.includes('/edit')) {
    return '일정 수정'
  }
  if (pathname.startsWith('/app/schedules/')) {
    return '일정 상세'
  }
  return TAB_TITLES[pathname] ?? '일정'
}

/**
 * 앱의 골격(껍데기) 컴포넌트
 * 다음과 같은 것들을 포함한다.
 * - 항상 고정으로 나오는 부분
 *   - 상단 바(TopBar)
 *   - 사이드바 / 탭 바 / 하단 네비게이션
 *   - 전역 모달, 토스트, 공통 컨텍스트(provider) 등
 * - 라우터에 따라 바뀌는 내용이 들어갈 자리
 * @constructor
 */
const AppShell = () => {
  const location = useLocation()
  const navigate = useNavigate()
  const pathname = location.pathname
  const didAttemptRefresh = useRef(false)

  useEffect(() => {
    const ensureToken = async () => {
      if (didAttemptRefresh.current) return
      didAttemptRefresh.current = true
      if (isLoggedOut()) {
        clearAuthTokens()
        navigate('/login', { replace: true })
        return
      }
      const accessToken = getAccessToken()
      if (accessToken) return
      try {
        await refreshAccessToken()
      } catch (error) {
        console.warn('⚠️ 자동 토큰 재발급 실패:', error)
        clearAuthTokens()
        navigate('/login', { replace: true })
      }
    }
    ensureToken()
  }, [navigate])

  const title = getPageTitle(pathname)
  const showSettingsButton = pathname !== '/app/settings'
  const isDetailPage = pathname.startsWith('/app/schedules/') && pathname.split('/').length > 3
  const isNewPage = pathname === '/app/new'
  const showBackButton = isDetailPage || pathname === '/app/settings' || isNewPage

  return (
    <div className="app-shell">
      <TopBar
        title={title}
        showBackButton={showBackButton}
        onBack={() => navigate(-1)}
        onSettings={() => navigate('/app/settings')}
        showSettingsButton={showSettingsButton}
      />
      {/*  리액트 라우터 호출: app-shell__content */}
      <main className="app-shell__content">
        <Outlet />
      </main>
      <MiniPlayerBar />
      <BottomTabBar activePath={pathname} />
    </div>
  )
}

export default AppShell
