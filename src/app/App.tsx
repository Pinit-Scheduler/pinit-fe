import './App.css'
import '@shared/styles/workspacePalette.css'
import {
  createBrowserRouter,
  Navigate,
  Route,
  RouterProvider,
  Routes,
  useLocation,
} from 'react-router-dom'
import { RouteSurface } from '@shared/routing/RouteSurface'
import {
  isInputSurface,
  isSurfacePath,
  safeBackground,
  surfaceFallback,
} from '@shared/routing/routeSurfaceState'
import ScheduleDetailPage from '@features/schedules/pages/ScheduleDetailPage'
import { TaskMapPage } from '@features/task-map'
import type { ReactNode } from 'react'
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
  const location = useLocation()
  const background = safeBackground(location.state)
  const surface = isSurfacePath(location.pathname)
  const base =
    background ??
    (surface
      ? {
          ...location,
          pathname: surfaceFallback(location.pathname),
          search: '',
          hash: '',
          state: null,
          key: 'surface-base',
        }
      : location)
  const wrap = (title: string, child: ReactNode) => (
    <RouteSurface
      key={location.pathname}
      title={title}
      input={isInputSurface(location.pathname)}
    >
      {child}
    </RouteSurface>
  )
  return (
    <div className="workspace-theme">
      <Routes location={base}>
        <Route element={<AppShell />}>
          <Route index element={<Navigate to="/app/today" replace />} />
          <Route path="today" element={<TodayPage />} />
          <Route path="plan" element={<PlanPage />} />
          <Route path="deadline-risk" element={<DeadlineRiskPage />} />
          <Route path="schedules" element={<SchedulesTabPage />} />
          <Route path="tasks" element={<TaskListPage />} />
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
      {surface && (
        <Routes>
          <Route
            path="schedules/new"
            element={wrap('일정 추가', <ScheduleCreatePage />)}
          />
          <Route
            path="schedules/:scheduleId/edit"
            element={wrap('일정 수정', <ScheduleEditPage />)}
          />
          <Route
            path="schedules/:scheduleId"
            element={wrap('일정 상세', <ScheduleDetailPage />)}
          />
          <Route
            path="new"
            element={wrap('일정 추가', <ScheduleCreatePage />)}
          />
          <Route
            path="tasks/new"
            element={wrap('작업 추가', <TaskCreatePage />)}
          />
          <Route
            path="tasks/:taskId/edit"
            element={wrap('작업 수정', <TaskEditPage />)}
          />
          <Route
            path="tasks/:taskId"
            element={wrap('작업 상세', <TaskDetailPage />)}
          />
        </Routes>
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
      <Route path="/oauth/consent" element={<OAuthConsentPage />} />
      <Route path="/app/*" element={<WorkspaceRoutes />} />
    </Route>
  </Routes>
)

const router = createBrowserRouter([{ path: '*', element: <AppRoutes /> }])

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
  const { offsetMinutes, zoneId, isLoading } = useTimePreferences()

  if (isLoading) {
    return <InitialLoadingScreen />
  }

  // 시간대가 바뀌면(ADR-0028) 캐시와 화면 상태를 새로 만든다. 날짜 경계가 시간대마다 다르기 때문이다.
  // 토스트는 그 밖에 두어 "시간대를 바꿨어요" 안내가 다시 그릴 때 사라지지 않게 한다.
  return (
    <ToastProvider>
      <TaskCacheProvider key={zoneId}>
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
