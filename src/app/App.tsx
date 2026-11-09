import './App.css'
import SpacesPage from '@features/spaces/SpacesPage'
import InvitationPage from '@features/spaces/InvitationPage'
import ConflictNotice from '@features/spaces/ConflictNotice'
import WorkspaceRealtime from '@features/spaces/WorkspaceRealtime'
import { useWorkspaceEvents } from '@features/spaces/store'
import '@shared/styles/workspacePalette.css'
import {
  createBrowserRouter,
  Navigate,
  Route,
  RouterProvider,
  Routes,
  useLocation,
  useNavigationType,
  type Location,
} from 'react-router-dom'
import { RouteSurface } from '@shared/routing/RouteSurface'
import {
  isInputSurface,
  isSurfacePath,
  locationHref,
  safeBackground,
  surfaceFallback,
  surfaceTitle,
} from '@shared/routing/routeSurfaceState'
import { usePresence } from '@shared/motion/usePresence'
import { registerTransitionNavigate } from '@shared/routing/viewTransitionNavigation'
import ScheduleDetailPage from '@features/schedules/pages/ScheduleDetailPage'
import { TaskMapPage } from '@features/task-map'
import { useEffect, useMemo, useState } from 'react'
import { queryStore } from '@shared/utils/queryStore'
import { getAccessToken, getTokenSubject } from '@shared/api/authTokens'
import AppShell from '@shared/components/layout/AppShell'
import { ScheduleCacheProvider } from '@contexts/ScheduleCacheContext'
import { ScheduleViewStateProvider } from '@contexts/ScheduleViewStateContext'
import { ToastProvider } from '@contexts/ToastContext'
import { TaskCacheProvider } from '@contexts/TaskCacheContext'
import {
  TimePreferencesProvider,
  useTimePreferences,
} from '@contexts/TimePreferencesContext'
import { LandingPage } from '@features/landing'
import {
  LoginPage,
  SignupPage,
  SocialCallbackPage,
  AuthGuard,
} from '@features/auth'
import {
  ScheduleCreatePage,
  ScheduleEditPage,
  SchedulesTabPage,
} from '@features/schedules'
import { TodayPage } from '@features/today'
import { PlanPage } from '@features/planner'
import DeadlineRiskPage from '@features/deadline-risk/pages/DeadlineRiskPage'
import {
  TaskListPage,
  TaskCreatePage,
  TaskEditPage,
  TaskDetailPage,
} from '@features/tasks'
import { StatisticsTabPage } from '@features/statistics'
import { SettingsPage } from '@features/settings'
import { TrashPage } from '@features/trash'
import { RoutinesPage } from '@features/routines'
import { RecurrencesPage } from '@features/recurrence'
import { OAuthConsentPage } from '@features/oauth'
import { OnboardingGuidePage } from '@features/onboarding'

const WorkspaceRoutes = () => {
  useWorkspaceEvents()
  const { zoneKey } = useTimePreferences()
  const location = useLocation()
  const background = safeBackground(location.state)
  const surface = isSurfacePath(location.pathname)
  // The last page shown in this session. A surface opened with a plain link (no background
  // state) keeps that page behind it instead of swapping in a fixed fallback page.
  const [lastPage, setLastPage] = useState<Location | null>(
    surface ? null : location,
  )
  if (!surface && lastPage !== location) setLastPage(location)
  // A surface reached by a replace from a page (the onboarding tour does this) took that page's
  // history entry. Closing it must go to that page, not one step back past it.
  const navigationType = useNavigationType()
  const [shownLocation, setShownLocation] = useState(location)
  const [replacedPage, setReplacedPage] = useState<string | null>(null)
  if (shownLocation !== location) {
    setShownLocation(location)
    setReplacedPage(
      surface && !background && navigationType === 'REPLACE'
        ? isSurfacePath(shownLocation.pathname)
          ? replacedPage
          : locationHref(shownLocation)
        : null,
    )
  }
  const fallbackPath = surfaceFallback(location.pathname)
  const fallback = useMemo<Location>(
    () => ({
      pathname: fallbackPath,
      search: '',
      hash: '',
      state: null,
      key: 'surface-base',
    }),
    [fallbackPath],
  )
  const base = surface ? (background ?? lastPage ?? fallback) : location
  // Keep the surface mounted for its exit after the route has left it.
  const shown = usePresence(surface ? location : null)
  const surfaceLocation = shown.value
  return (
    <div className="workspace-theme">
      <WorkspaceRealtime />
      <ConflictNotice />
      <Routes location={base}>
        <Route element={<AppShell />}>
          <Route index element={<Navigate to="/app/today" replace />} />
          <Route path="today" element={<TodayPage />} />
          <Route path="plan" element={<PlanPage />} />
          <Route path="deadline-risk" element={<DeadlineRiskPage />} />
          <Route path="schedules" element={<SchedulesTabPage />} />
          <Route path="tasks" element={<TaskListPage />} />
          <Route path="spaces" element={<SpacesPage />} />
          <Route path="task-map" element={<TaskMapPage />} />
          <Route path="statistics" element={<StatisticsTabPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="settings/routines" element={<RoutinesPage />} />
          <Route path="settings/recurrences" element={<RecurrencesPage />} />
          <Route path="settings/trash" element={<TrashPage />} />
          <Route path="settings/onboarding" element={<OnboardingGuidePage />} />
          <Route path="*" element={<Navigate to="/app/today" replace />} />
        </Route>
      </Routes>
      {shown.mounted && surfaceLocation && (
        <RouteSurface
          title={surfaceTitle(surfaceLocation.pathname)}
          input={isInputSurface(surfaceLocation.pathname)}
          closing={shown.closing}
          pathname={surfaceLocation.pathname}
          hasBackground={!!(safeBackground(surfaceLocation.state) ?? lastPage)}
          replacedPage={replacedPage}
        >
          {/* A new display zone remounts the surface page, like the background page (AppShell). */}
          <Routes location={surfaceLocation} key={zoneKey}>
            <Route path="schedules/new" element={<ScheduleCreatePage />} />
            <Route
              path="schedules/:scheduleId/edit"
              element={<ScheduleEditPage />}
            />
            <Route path="schedules/:scheduleId" element={<ScheduleDetailPage />} />
            <Route path="new" element={<ScheduleCreatePage />} />
            <Route path="tasks/new" element={<TaskCreatePage />} />
            <Route path="tasks/:taskId/edit" element={<TaskEditPage />} />
            <Route path="tasks/:taskId" element={<TaskDetailPage />} />
          </Routes>
        </RouteSurface>
      )}
    </div>
  )
}

const AppRoutes = () => (
  <Routes>
    <Route path="/" element={<LandingPage />} />
    <Route path="/login" element={<LoginPage />} />
    <Route path="/signup" element={<SignupPage />} />
    <Route path="/login/callback/:provider" element={<SocialCallbackPage />} />
    <Route element={<AuthGuard />}>
      <Route path="/spaces/join/:token" element={<InvitationPage />} />
      <Route path="/oauth/consent" element={<OAuthConsentPage />} />
      <Route path="/app/*" element={<WorkspaceRoutes />} />
    </Route>
  </Routes>
)

const router = createBrowserRouter([{ path: '*', element: <AppRoutes /> }])
// Tab links animate through the data router; see viewTransitionNavigation.ts for why.
registerTransitionNavigate((to) => void router.navigate(to, { viewTransition: true }))

const InitialLoadingScreen = () => {
  return (
    <div className="app-loading" role="status" aria-live="polite">
      <div className="app-loading__spinner" aria-hidden />
      <p className="app-loading__text">시간대를 불러오는 중이에요</p>
      <p className="app-loading__subtext">
        현재 시간대에 맞춰 화면을 준비하고 있어요.
      </p>
    </div>
  )
}

const AppContent = () => {
  const currentActor = () => {
    const token = getAccessToken()
    return token ? getTokenSubject(token) : null
  }
  const [actor, setActor] = useState(currentActor)
  useEffect(() => {
    const sync = () => setActor(currentActor())
    window.addEventListener('auth:changed', sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener('auth:changed', sync)
      window.removeEventListener('storage', sync)
    }
  }, [])
  const { zoneKey, isLoading } = useTimePreferences()
  // 시간대가 바뀌면(ADR-0028) 시간대에 묶인 상태를 그 자리에서 비운다. 날짜 경계가 시간대마다 다르기 때문이다.
  // - 조회 캐시(queryStore): 이 렌더에서 비운다. 구독하던 화면은 모두 아래에서 새로 마운트되므로
  //   알림 없이 지워도 이전 항목을 붙잡은 구독이 남지 않는다.
  // - 작업·일정 캐시와 일정 보기 상태: 각 Provider가 resetKey(zoneKey)를 보고 같은 렌더에서 비운다.
  // - 화면 자체: AppShell의 Outlet과 RouteSurface의 Routes만 zoneKey로 다시 마운트한다. 화면마다
  //   표시 시간대로 계산한 useState(고른 날짜 등)를 갖고 있기 때문이다. 셸(사이드바·상단 바·하단 탭·
  //   미니 플레이어)과 실시간 연결은 그대로 둔다.
  // 계정이 바뀔 때만 Provider 전체를 key로 새로 만든다.
  // 토스트는 그 밖에 두어 "시간대를 바꿨어요" 안내가 다시 그릴 때 사라지지 않게 한다.
  const [clearedFor, setClearedFor] = useState(zoneKey)
  if (clearedFor !== zoneKey) {
    setClearedFor(zoneKey)
    queryStore.clear()
  }

  if (isLoading) {
    return <InitialLoadingScreen />
  }

  return (
    <ToastProvider>
      <TaskCacheProvider key={actor ?? 'guest'} resetKey={zoneKey}>
        <ScheduleCacheProvider resetKey={zoneKey}>
          <ScheduleViewStateProvider>
            <RouterProvider router={router} />
          </ScheduleViewStateProvider>
        </ScheduleCacheProvider>
      </TaskCacheProvider>
    </ToastProvider>
  )
}

function App() {
  return (
    <TimePreferencesProvider>
      <AppContent />
    </TimePreferencesProvider>
  )
}

export default App
