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
  type Location,
} from 'react-router-dom'
import { RouteSurface } from '@shared/routing/RouteSurface'
import {
  isInputSurface,
  isSurfacePath,
  safeBackground,
  surfaceFallback,
  surfaceTitle,
} from '@shared/routing/routeSurfaceState'
import { usePresence } from '@shared/motion/usePresence'
import { registerTransitionNavigate } from '@shared/routing/viewTransitionNavigation'
import ScheduleDetailPage from '@features/schedules/pages/ScheduleDetailPage'
import { TaskMapPage } from '@features/task-map'
import { useEffect, useMemo, useState } from 'react'
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
  const location = useLocation()
  const background = safeBackground(location.state)
  const surface = isSurfacePath(location.pathname)
  // The last page shown in this session. A surface opened with a plain link (no background
  // state) keeps that page behind it instead of swapping in a fixed fallback page.
  const [lastPage, setLastPage] = useState<Location | null>(
    surface ? null : location,
  )
  if (!surface && lastPage !== location) setLastPage(location)
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
        >
          <Routes location={surfaceLocation}>
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
  const { offsetMinutes, zoneId, isLoading } = useTimePreferences()

  if (isLoading) {
    return <InitialLoadingScreen />
  }

  // 시간대가 바뀌면(ADR-0028) 캐시와 화면 상태를 새로 만든다. 날짜 경계가 시간대마다 다르기 때문이다.
  // 토스트는 그 밖에 두어 "시간대를 바꿨어요" 안내가 다시 그릴 때 사라지지 않게 한다.
  return (
    <ToastProvider>
      <TaskCacheProvider key={`${zoneId}:${actor ?? 'guest'}`}>
        <ScheduleCacheProvider>
          <ScheduleViewStateProvider key={offsetMinutes}>
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
