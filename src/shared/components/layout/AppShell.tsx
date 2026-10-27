import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useRef } from 'react'
import TopBar from './TopBar'
import BottomTabBar from './BottomTabBar'
import { InstallBanner, OfflineBanner } from './AppBanners'
import MiniPlayerBar from '@features/schedules/components/MiniPlayerBar'
import { OnboardingTourProvider } from '@features/onboarding'
import { refreshAccessToken } from '@features/auth/api/auth'
import { clearAuthTokens, getAccessToken, isLoggedOut } from '@shared/api/authTokens'
import './AppShell.css'

const TAB_TITLES: Record<string, string> = {
  '/app/today': '오늘 할당된 일',
  '/app/plan': '하루 계획',
  '/app/schedules': '일정',
  '/app/schedules/new': '일정 추가',
  '/app/new': '일정 추가',
  '/app/tasks': '작업',
  '/app/statistics': '통계',
  '/app/settings': '설정',
  '/app/settings/routines': '생활 시간',
  '/app/settings/recurrences': '반복 관리',
  '/app/settings/onboarding': '온보딩',
}

const getPageTitle = (pathname: string): string => {
  if (pathname.includes('/edit')) {
    if (pathname.startsWith('/app/tasks/')) return '작업 수정'
    return '일정 수정'
  }
  if (pathname.startsWith('/app/schedules/')) {
    return '일정 상세'
  }
  if (pathname.startsWith('/app/tasks/')) {
    return '작업 상세'
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
  const showSettingsButton = !pathname.startsWith('/app/settings')
  const isScheduleDetail = pathname.startsWith('/app/schedules/') && pathname.split('/').length > 3
  const isTaskDetail = pathname.startsWith('/app/tasks/') && pathname.split('/').length > 3
  const isNewPage = pathname === '/app/new' || pathname === '/app/schedules/new' || pathname === '/app/tasks/new'
  const isSettingsPage = pathname.startsWith('/app/settings')
  const isPlanPage = pathname === '/app/plan'
  const isOnboardingGuide = pathname === '/app/settings/onboarding'
  const showBackButton = isScheduleDetail || isTaskDetail || isSettingsPage || isNewPage || isPlanPage || isOnboardingGuide

  const handleBack = () => {
    // 온보딩 가이드는 딥링크로 열 수 있다. 앱 안에서 쌓인 history가 없으면 설정으로 간다.
    if (isOnboardingGuide) {
      const historyIndex = (window.history.state as { idx?: number } | null)?.idx
      if (historyIndex === undefined || historyIndex <= 0) {
        navigate('/app/settings', { replace: true })
        return
      }
    }
    navigate(-1)
  }

  return (
    <div className="app-shell">
      <OnboardingTourProvider>
        <TopBar
          title={title}
          showBackButton={showBackButton}
          onBack={handleBack}
          onSettings={() => navigate('/app/settings')}
          showSettingsButton={showSettingsButton}
        />
        <OfflineBanner />
        {pathname === '/app/today' && <InstallBanner />}
        {/*  리액트 라우터 호출: app-shell__content */}
        <main className="app-shell__content">
          <Outlet />
        </main>
        <MiniPlayerBar />
        <BottomTabBar activePath={pathname} />
      </OnboardingTourProvider>
    </div>
  )
}

export default AppShell
