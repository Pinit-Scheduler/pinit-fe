import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useLayoutEffect, useRef } from 'react'
import WorkspaceSidebar from './WorkspaceSidebar'
import TopBar from './TopBar'
import BottomTabBar from './BottomTabBar'
import { InstallBanner, OfflineBanner, UpdateBanner } from './AppBanners'
import MiniPlayerBar from '@features/schedules/components/MiniPlayerBar'
import { OnboardingTourProvider } from '@features/onboarding'
import { refreshAccessToken } from '@features/auth/api/auth'
import {
  clearAuthTokens,
  getAccessToken,
  isLoggedOut,
} from '@shared/api/authTokens'
import { useMemberZoneSync } from '@features/settings/hooks/useMemberZoneSync'
import './AppShell.css'
import { SpaceContextBar, SpaceSwitcher } from '@features/spaces/SpaceChrome'
import { useSpaces } from '@features/spaces/store'
import { routeScope, scopeCrumb } from '@features/spaces/scope'
import {
  MOTION_ENTER_MS,
  prefersReducedMotion,
} from '@shared/motion/tokens'

const TAB_TITLES: Record<string, string> = {
  '/app/today': '오늘의 내 작업',
  '/app/spaces': '스페이스',
  '/app/plan': '하루 계획',
  '/app/deadline-risk': '마감 위험 예보',
  '/app/schedules': '일정',
  '/app/schedules/new': '일정 추가',
  '/app/new': '일정 추가',
  '/app/tasks': '작업',
  '/app/task-map': '작업 맵',
  '/app/statistics': '통계',
  '/app/settings': '설정',
  '/app/settings/routines': '생활 시간',
  '/app/settings/recurrences': '반복 관리',
  '/app/settings/trash': '휴지통',
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
  const contentRef = useRef<HTMLElement>(null)
  const shownPath = useRef(pathname)
  useMemberZoneSync()

  // A new page starts at the top. Without this the next page opens at the previous page's
  // scroll offset and jumps when its content arrives. Opening a surface keeps this pathname
  // (it is the background location), so the page behind a surface keeps its scroll.
  useLayoutEffect(() => {
    if (shownPath.current === pathname) return
    shownPath.current = pathname
    const content = contentRef.current
    if (!content) return
    content.scrollTop = 0
    // Tab links use a view transition (motion.css). Where the browser has none, fade the new
    // page in on its own so the swap is never a hard cut.
    if (
      !('startViewTransition' in document) &&
      !prefersReducedMotion() &&
      typeof content.animate === 'function'
    )
      content.animate(
        [
          { opacity: 0.4, transform: 'translateY(8px)' },
          { opacity: 1, transform: 'none' },
        ],
        { duration: MOTION_ENTER_MS, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
      )
  }, [pathname])
  const { selectedSpace, selectedProject, spaces, defaultSpaceId } = useSpaces()

  useEffect(() => {
    const shell = document.querySelector<HTMLElement>('.app-shell')
    if (!shell) return
    const measure = () => {
      const player = document.querySelector('.mini-player-wrapper')
      shell.style.setProperty(
        '--workspace-player-height',
        `${player?.getBoundingClientRect().height ?? 0}px`,
      )
      shell.style.setProperty(
        '--workspace-viewport-height',
        `${window.visualViewport?.height ?? window.innerHeight}px`,
      )
    }
    const resize = new ResizeObserver(measure)
    const observe = () => {
      resize.disconnect()
      const player = document.querySelector('.mini-player-wrapper')
      if (player) resize.observe(player)
      measure()
    }
    const mutation = new MutationObserver(observe)
    mutation.observe(shell, { childList: true, subtree: true })
    window.visualViewport?.addEventListener('resize', measure)
    window.addEventListener('resize', measure)
    observe()
    return () => {
      resize.disconnect()
      mutation.disconnect()
      window.visualViewport?.removeEventListener('resize', measure)
      window.removeEventListener('resize', measure)
    }
  }, [])

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
  const personalSpace =
    spaces.find((space) => space.id === defaultSpaceId) ?? null
  const scopeLabel = scopeCrumb(
    routeScope(pathname),
    routeScope(pathname) === 'personal' ? personalSpace : selectedSpace,
    selectedProject,
  )
  const showSettingsButton = !pathname.startsWith('/app/settings')
  const isScheduleDetail =
    pathname.startsWith('/app/schedules/') && pathname.split('/').length > 3
  const isTaskDetail =
    pathname.startsWith('/app/tasks/') && pathname.split('/').length > 3
  const isNewPage =
    pathname === '/app/new' ||
    pathname === '/app/schedules/new' ||
    pathname === '/app/tasks/new'
  const isSettingsPage = pathname.startsWith('/app/settings')
  const isPlanPage = pathname === '/app/plan'
  const isOnboardingGuide = pathname === '/app/settings/onboarding'
  const showBackButton =
    isScheduleDetail ||
    isTaskDetail ||
    isSettingsPage ||
    isNewPage ||
    isPlanPage ||
    isOnboardingGuide

  const handleBack = () => {
    // 온보딩 가이드는 딥링크로 열 수 있다. 앱 안에서 쌓인 history가 없으면 설정으로 간다.
    if (isOnboardingGuide) {
      const historyIndex = (window.history.state as { idx?: number } | null)
        ?.idx
      if (historyIndex === undefined || historyIndex <= 0) {
        navigate('/app/settings', { replace: true })
        return
      }
    }
    navigate(-1)
  }

  return (
    <div
      className={`app-shell${isNewPage || /\/edit$/.test(pathname) ? ' app-shell--editing' : ''}`}
    >
      <OnboardingTourProvider>
        <WorkspaceSidebar />
        <TopBar
          title={title}
          scopeLabel={scopeLabel}
          leading={<SpaceSwitcher variant="bar" />}
          showBackButton={showBackButton}
          onBack={handleBack}
          onSettings={() => navigate('/app/settings')}
          showSettingsButton={showSettingsButton}
        />
        {/*  리액트 라우터 호출: app-shell__content */}
        <main className="app-shell__content" ref={contentRef}>
          <OfflineBanner />
          <UpdateBanner />
          {pathname === '/app/today' && <InstallBanner />}
          <SpaceContextBar />
          <Outlet />
        </main>
        <MiniPlayerBar />
        <BottomTabBar activePath={pathname} />
      </OnboardingTourProvider>
    </div>
  )
}

export default AppShell
